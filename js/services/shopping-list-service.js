(function (global) {
  const dateUtils = global.dateUtils || {};
  const SHOPPING_CACHE_PREFIX = 'shopping_list_cache_v2';
  const MENU_CACHE_PREFIX = 'weekly_menu_cache_v1';
  const LEGACY_LIST_PREFIX = 'shoppingList_';
  const LEGACY_MENU_PREFIX = 'weeklyMenu_';

  let cachedHouseholdContext = { userId: null, householdId: null };

  const cloneList = (list) =>
    Array.isArray(list) ? list.map((item) => ({ ...item })) : [];

  const ensureWeekISO = (weekISO) => {
    if (typeof weekISO === 'string' && weekISO) return weekISO;
    if (dateUtils?.getActiveWeekISO) return dateUtils.getActiveWeekISO();
    if (dateUtils?.mondayISO) return dateUtils.mondayISO();
    return new Date().toISOString().slice(0, 10);
  };

  const legacyListKey = (weekISO) => `${LEGACY_LIST_PREFIX}${weekISO}`;
  const cacheKey = (prefix, householdId, weekISO) =>
    householdId ? `${prefix}_${householdId}_${weekISO}` : null;

  const fetchSession = async (supa) => {
    if (!supa) return null;
    try {
      const { data } = await supa.auth.getSession();
      return data?.session || null;
    } catch (err) {
      console.warn('shoppingListService: kunne ikke hente session', err);
      return null;
    }
  };

  const getCachedHouseholdId = (session) => {
    if (!session?.user?.id) return null;
    if (cachedHouseholdContext.userId === session.user.id) {
      return cachedHouseholdContext.householdId || null;
    }
    return null;
  };

  const cacheHouseholdId = (session, householdId) => {
    if (!session?.user?.id || !householdId) return;
    cachedHouseholdContext = {
      userId: session.user.id,
      householdId,
    };
  };

  const fetchHouseholdId = async (supa, session) => {
    if (!supa || !session) return null;
    const cached = getCachedHouseholdId(session);
    if (cached) return cached;

    try {
      if (typeof supa.rpc === 'function') {
        const { data, error } = await supa.rpc('get_my_household_id');
        if (!error && data) {
          cacheHouseholdId(session, data);
          return data;
        }
      }
    } catch (err) {
      console.warn('shoppingListService: get_my_household_id feilet', err);
    }

    try {
      const { data, error } = await supa
        .from('members')
        .select('household_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!error && data?.household_id) {
        cacheHouseholdId(session, data.household_id);
        return data.household_id;
      }
    } catch (err) {
      console.warn('shoppingListService: kunne ikke hente household_id', err);
    }

    return null;
  };

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

  const readLegacyList = (weekISO) => {
    try {
      const raw = localStorage.getItem(legacyListKey(weekISO));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const flattened = [];
      parsed.forEach((entry) => {
        if (entry && Array.isArray(entry.items)) {
          entry.items.forEach((item) => {
            if (!item) return;
            const name = String(item.name || '').trim();
            if (!name) return;
            flattened.push({
              name,
              category: String(item.category || entry.name || '').trim() || null,
              quantity: Math.max(1, Number(item.quantity) || 1),
              checked: !!item.checked,
            });
          });
        } else if (entry && typeof entry === 'object') {
          const name = String(entry.name || '').trim();
          if (!name) return;
          flattened.push({
            name,
            category: String(entry.category || '').trim() || null,
            quantity: Math.max(1, Number(entry.quantity) || 1),
            checked: !!entry.checked,
          });
        }
      });
      return flattened;
    } catch (err) {
      console.warn('shoppingListService: kunne ikke lese legacy-handleliste', err);
      return [];
    }
  };

  const readLegacyMenu = (weekISO) => {
    try {
      const raw = localStorage.getItem(`${LEGACY_MENU_PREFIX}${weekISO}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const fetchItemsFromDB = async (supa, householdId, weekISO) => {
    const { data, error } = await supa
      .from('shopping_list_items')
      .select('id, name, category, quantity, checked')
      .eq('household_id', householdId)
      .eq('week_start', weekISO)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data : [];
  };

  const fetchMenuFromDB = async (supa, householdId, weekISO) => {
    const { data, error } = await supa
      .from('weekly_menu')
      .select('day_key, dish_name')
      .eq('household_id', householdId)
      .eq('week_start', weekISO);

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
  };

  const ensureHouseholdContext = async (supa, weekISO) => {
    if (!supa) throw new Error('Supabase-klient mangler');
    const session = await fetchSession(supa);
    if (!session) throw new Error('Ikke innlogget');
    const householdId = await fetchHouseholdId(supa, session);
    if (!householdId) throw new Error('Fant ikke husstand');
    return { session, householdId, weekISO: ensureWeekISO(weekISO) };
  };

  async function getHouseholdId(supa) {
    const session = await fetchSession(supa);
    if (!session) {
      throw new Error('Ikke innlogget');
    }
    const householdId = await fetchHouseholdId(supa, session);
    if (!householdId) {
      throw new Error('Fant ikke husstand');
    }
    return householdId;
  }

  async function loadItemsForWeek(supa, weekISO) {
    const ctx = await ensureHouseholdContext(supa, weekISO);

    try {
      let items = await fetchItemsFromDB(supa, ctx.householdId, ctx.weekISO);
      if (!items.length) {
        const legacy = readLegacyList(ctx.weekISO);
        if (legacy.length) {
          const payload = legacy.map((item) => ({
            household_id: ctx.householdId,
            week_start: ctx.weekISO,
            name: item.name,
            category: item.category || null,
            quantity: item.quantity || 1,
            checked: item.checked === true,
          }));
          try {
            await supa.from('shopping_list_items').insert(payload);
            items = await fetchItemsFromDB(supa, ctx.householdId, ctx.weekISO);
          } catch (err) {
            console.warn('shoppingListService: kunne ikke migrere legacy-data', err);
            items = legacy.map((item, idx) => ({
              id: `local_${idx}`,
              ...item,
            }));
          }
        }
      }
      writeCache(SHOPPING_CACHE_PREFIX, ctx.householdId, ctx.weekISO, items);
      return items;
    } catch (err) {
      console.warn('shoppingListService: loadItemsForWeek feilet, bruker cache', err);
      const cached = readCache(SHOPPING_CACHE_PREFIX, ctx.householdId, ctx.weekISO);
      if (Array.isArray(cached)) return cached;
      const legacy = readLegacyList(ctx.weekISO);
      return legacy.map((item, idx) => ({ id: `local_${idx}`, ...item }));
    }
  }

  async function refreshItems(supa, householdId, weekISO) {
    try {
      const items = await fetchItemsFromDB(supa, householdId, weekISO);
      writeCache(SHOPPING_CACHE_PREFIX, householdId, weekISO, items);
      return items;
    } catch (err) {
      console.warn('shoppingListService: refreshItems feilet', err);
      const cached = readCache(SHOPPING_CACHE_PREFIX, householdId, weekISO);
      return Array.isArray(cached) ? cached : [];
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
    try {
      let menu = await fetchMenuFromDB(supa, ctx.householdId, ctx.weekISO);
      const hasDish = Object.values(menu).some((dish) => !!dish);
      if (!hasDish) {
        const legacy = readLegacyMenu(ctx.weekISO);
        if (legacy) {
          const payload = Object.entries(legacy).map(([day_key, dish_name]) => ({
            household_id: ctx.householdId,
            week_start: ctx.weekISO,
            day_key,
            dish_name,
          }));
          if (payload.length) {
            try {
              await supa.from('weekly_menu').upsert(payload, {
                onConflict: 'household_id,week_start,day_key',
              });
              menu = await fetchMenuFromDB(supa, ctx.householdId, ctx.weekISO);
            } catch (err) {
              console.warn('shoppingListService: kunne ikke migrere meny', err);
            }
          }
        }
      }
      writeCache(MENU_CACHE_PREFIX, ctx.householdId, ctx.weekISO, menu);
      return menu;
    } catch (err) {
      console.warn('shoppingListService: loadWeeklyMenu feilet, bruker cache', err);
      const cached = readCache(MENU_CACHE_PREFIX, ctx.householdId, ctx.weekISO);
      if (cached) return cached;
      return readLegacyMenu(ctx.weekISO) || {};
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

    return loadWeeklyMenu(supa, ctx.weekISO);
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
