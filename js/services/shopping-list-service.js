(function (global) {
  const dateUtils = global.dateUtils || {};
  const householdContext = global.householdContext;
  const SHOPPING_CACHE_PREFIX = 'shopping_list_cache_v2';
  const MENU_CACHE_PREFIX = 'weekly_menu_cache_v1';

  const inMemoryItems = new Map(); // key: `${householdId}_${weekISO}`
  const inMemoryMenu = new Map();  // key: `${householdId}_${weekISO}`

  const cloneList = (list) =>
    Array.isArray(list) ? list.map((item) => ({ ...item })) : [];

  const ensureWeekISO = (weekISO) => {
    if (weekISO) {
      if (dateUtils.resolveWeekISOForDate && dateUtils.dateFromISOLocal) {
        return dateUtils.resolveWeekISOForDate(dateUtils.dateFromISOLocal(weekISO));
      }
      return weekISO;
    }
    if (dateUtils.getOrInitActiveWeekISO) return dateUtils.getOrInitActiveWeekISO();
    if (dateUtils.mondayISO) return dateUtils.mondayISO();
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today.toISOString().slice(0, 10);
  };

  const cacheKey = (prefix, householdId, weekISO) =>
    householdId ? `${prefix}_${householdId}_${weekISO}` : null;

  const readCache = (prefix, householdId, weekISO) => {
    const key = cacheKey(prefix, householdId, weekISO);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const writeCache = (prefix, householdId, weekISO, value) => {
    const key = cacheKey(prefix, householdId, weekISO);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('shoppingListService: kunne ikke skrive cache', err);
    }
  };

  const memoryKey = (householdId, weekISO) => `${householdId}_${weekISO}`;

  async function ensureHouseholdContext(supa, weekISO) {
    if (!supa) throw new Error('Supabase-klient mangler');
    if (!householdContext?.getHouseholdId) throw new Error('householdContext mangler');
    const householdId = await householdContext.getHouseholdId(supa);
    if (!householdId) throw new Error('Fant ikke husstand');
    return { householdId, weekISO: ensureWeekISO(weekISO) };
  }

  async function getHouseholdId(supa) {
    const ctxId = await householdContext?.getHouseholdId?.(supa);
    if (!ctxId) throw new Error('Fant ikke husstand');
    return ctxId;
  }

  async function fetchItemsFromDB(supa, householdId, weekISO) {
    const normalizedWeek = ensureWeekISO(weekISO);
    const { data, error } = await supa
      .from('shopping_list_items')
      .select('id, name, category, quantity, checked')
      .eq('household_id', householdId)
      .eq('week_start', normalizedWeek)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data : [];
  }

  async function fetchMenuFromDB(supa, householdId, weekISO) {
    const normalizedWeek = ensureWeekISO(weekISO);
    const { data, error } = await supa
      .from('weekly_menu')
      .select('day_key, dish_name')
      .eq('household_id', householdId)
      .eq('week_start', normalizedWeek);

    if (error) {
      throw error;
    }

    const menu = { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
    (data || []).forEach((row) => {
      if (row?.day_key) {
        menu[row.day_key] = row.dish_name || '';
      }
    });
    return menu;
  }

  async function loadItemsForWeek(supa, weekISO) {
    const ctx = await ensureHouseholdContext(supa, weekISO);
    const memKey = memoryKey(ctx.householdId, ctx.weekISO);

    if (inMemoryItems.has(memKey)) {
      return cloneList(inMemoryItems.get(memKey));
    }

    const cached = readCache(SHOPPING_CACHE_PREFIX, ctx.householdId, ctx.weekISO);
    if (Array.isArray(cached) && cached.length) {
      refreshItems(supa, ctx.householdId, ctx.weekISO).catch((err) => {
        console.warn('shoppingListService: bakgrunnsoppdatering feilet', err);
      });
      inMemoryItems.set(memKey, cached);
      return cloneList(cached);
    }

    try {
      const items = await fetchItemsFromDB(supa, ctx.householdId, ctx.weekISO);
      writeCache(SHOPPING_CACHE_PREFIX, ctx.householdId, ctx.weekISO, items);
      inMemoryItems.set(memKey, items);
      return items;
    } catch (err) {
      console.warn('shoppingListService: loadItemsForWeek feilet', err);
      return [];
    }
  }

  async function refreshItems(supa, householdId, weekISO) {
    const normalizedWeek = ensureWeekISO(weekISO);
    const memKey = memoryKey(householdId, normalizedWeek);
    try {
      const items = await fetchItemsFromDB(supa, householdId, normalizedWeek);
      writeCache(SHOPPING_CACHE_PREFIX, householdId, normalizedWeek, items);
      inMemoryItems.set(memKey, items);
      return items;
    } catch (err) {
      console.warn('shoppingListService: refreshItems feilet', err);
      const cached = readCache(SHOPPING_CACHE_PREFIX, householdId, normalizedWeek);
      if (Array.isArray(cached)) {
        inMemoryItems.set(memKey, cached);
        return cached;
      }
      return [];
    }
  }

  async function addItem(supa, { weekISO, name, category, quantity }) {
    const ctx = await ensureHouseholdContext(supa, weekISO);
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Navn kan ikke være tomt');
    const qty = Math.max(1, Number(quantity) || 1);

    await supa.from('shopping_list_items').insert({
      household_id: ctx.householdId,
      week_start: ctx.weekISO,
      name: cleanName,
      category: category ? String(category).trim() : null,
      quantity: qty,
    });

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function updateItemQuantity(supa, id, quantity, weekISO) {
    if (!id) throw new Error('Mangler vare-ID');
    const ctx = await ensureHouseholdContext(supa, weekISO);
    const qty = Math.max(1, Number(quantity) || 1);

    await supa
      .from('shopping_list_items')
      .update({ quantity: qty })
      .eq('household_id', ctx.householdId)
      .eq('week_start', ctx.weekISO)
      .eq('id', id);

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function toggleItemChecked(supa, id, checked, weekISO) {
    if (!id) throw new Error('Mangler vare-ID');
    const ctx = await ensureHouseholdContext(supa, weekISO);

    await supa
      .from('shopping_list_items')
      .update({ checked: !!checked })
      .eq('household_id', ctx.householdId)
      .eq('week_start', ctx.weekISO)
      .eq('id', id);

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function deleteItem(supa, id, weekISO) {
    if (!id) return loadItemsForWeek(supa, weekISO);
    const ctx = await ensureHouseholdContext(supa, weekISO);

    await supa
      .from('shopping_list_items')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('week_start', ctx.weekISO)
      .eq('id', id);

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function markAllChecked(supa, weekISO) {
    const ctx = await ensureHouseholdContext(supa, weekISO);
    await supa
      .from('shopping_list_items')
      .update({ checked: true })
      .eq('household_id', ctx.householdId)
      .eq('week_start', ctx.weekISO);

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function clearChecked(supa, weekISO) {
    const ctx = await ensureHouseholdContext(supa, weekISO);
    await supa
      .from('shopping_list_items')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('week_start', ctx.weekISO)
      .eq('checked', true);

    return refreshItems(supa, ctx.householdId, ctx.weekISO);
  }

  async function loadWeeklyMenu(supa, weekISO) {
    const ctx = await ensureHouseholdContext(supa, weekISO);
    const memKey = memoryKey(ctx.householdId, ctx.weekISO);

    if (inMemoryMenu.has(memKey)) {
      return { ...inMemoryMenu.get(memKey) };
    }

    const cached = readCache(MENU_CACHE_PREFIX, ctx.householdId, ctx.weekISO);
    if (cached) {
      refreshMenu(supa, ctx.householdId, ctx.weekISO).catch((err) => {
        console.warn('shoppingListService: bakgrunnsoppdatering meny feilet', err);
      });
      inMemoryMenu.set(memKey, cached);
      return { ...cached };
    }

    return refreshMenu(supa, ctx.householdId, ctx.weekISO);
  }

  async function refreshMenu(supa, householdId, weekISO) {
    const normalizedWeek = ensureWeekISO(weekISO);
    const memKey = memoryKey(householdId, normalizedWeek);
    try {
      const menu = await fetchMenuFromDB(supa, householdId, normalizedWeek);
      writeCache(MENU_CACHE_PREFIX, householdId, normalizedWeek, menu);
      inMemoryMenu.set(memKey, menu);
      return { ...menu };
    } catch (err) {
      console.warn('shoppingListService: refreshMenu feilet', err);
      const cached = readCache(MENU_CACHE_PREFIX, householdId, normalizedWeek);
      if (cached) {
        inMemoryMenu.set(memKey, cached);
        return { ...cached };
      }
      return { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
    }
  }

  async function saveDishForDay(supa, { weekISO, dayKey, dishName }) {
    if (!dayKey) throw new Error('Manglende dayKey');
    const ctx = await ensureHouseholdContext(supa, weekISO);
    await supa
      .from('weekly_menu')
      .upsert(
        {
          household_id: ctx.householdId,
          week_start: ctx.weekISO,
          day_key: dayKey,
          dish_name: dishName || null,
        },
        { onConflict: 'household_id,week_start,day_key' }
      );

    return refreshMenu(supa, ctx.householdId, ctx.weekISO);
  }

  global.shoppingListService = {
    getHouseholdId,
    loadItemsForWeek,
    addItem,
    updateItemQuantity,
    toggleItemChecked,
    deleteItem,
    markAllChecked,
    clearChecked,
    loadWeeklyMenu,
    saveDishForDay,
  };
})(window);
