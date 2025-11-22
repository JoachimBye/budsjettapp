(function (global) {
  const CATEGORY_SETTINGS_KEY = 'purchase_categories_v1';
  const CATEGORY_CACHE_PREFIX = 'purchase_categories_cache_v2';
  const DEFAULT_CATEGORIES = Object.freeze([
    { name: '🥕 Mat & dagligvarer', enabled: true, sort_order: 0 },
    { name: '🧽 Husholdning & rengjøring', enabled: true, sort_order: 1 },
    { name: '🍞 Frokost & brød', enabled: true, sort_order: 2 },
    { name: '🍿 Snacks & kos', enabled: true, sort_order: 3 },
    { name: '🥬 Frukt & grønt', enabled: true, sort_order: 4 },
    { name: '📦 Annet', enabled: false, sort_order: 5 },
  ]);

  const householdContext = global.householdContext;
  let inMemoryCategories = [];
  let inMemoryHouseholdId = null;

  const cloneList = (list) =>
    Array.isArray(list) ? list.map((item) => ({ ...item })) : [];

  function sanitizeCategory(raw, fallbackOrder = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return null;
    const sortOrder = Number.isFinite(raw.sort_order) ? raw.sort_order : fallbackOrder;
    return {
      id: raw.id ?? null,
      name,
      enabled: raw.enabled !== false,
      sort_order: sortOrder,
    };
  }

  function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item, idx) => sanitizeCategory(item, idx))
      .filter(Boolean);
  }

  function cloneDefaults() {
    return sanitizeList(DEFAULT_CATEGORIES);
  }

  function persistLegacyLocal(categories) {
    try {
      localStorage.setItem(CATEGORY_SETTINGS_KEY, JSON.stringify(categories));
    } catch (err) {
      console.warn('Kunne ikke lagre kategori-cache lokalt', err);
    }
  }

  function readLegacyLocal() {
    try {
      const raw = localStorage.getItem(CATEGORY_SETTINGS_KEY);
      if (!raw) return [];
      return sanitizeList(JSON.parse(raw));
    } catch (err) {
      console.warn('Kunne ikke lese legacy-kategorier', err);
      return [];
    }
  }

  function updateInMemory(list, householdId = null) {
    inMemoryCategories = cloneList(list);
    if (householdId) {
      inMemoryHouseholdId = householdId;
    }
  }

  function cacheKey(householdId) {
    return householdId ? `${CATEGORY_CACHE_PREFIX}_${householdId}` : null;
  }

  function persistHouseholdCache(householdId, categories) {
    const key = cacheKey(householdId);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(categories));
    } catch (err) {
      console.warn('Kunne ikke skrive kategori-cache for husstand', err);
    }
  }

  function readHouseholdCache(householdId) {
    const key = cacheKey(householdId);
    if (!key) return [];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      return sanitizeList(JSON.parse(raw));
    } catch (err) {
      console.warn('Kunne ikke lese kategori-cache for husstand', err);
      return [];
    }
  }

  function loadLegacyFallback() {
    const legacy = readLegacyLocal();
    if (legacy.length) {
      updateInMemory(legacy);
      return legacy;
    }
    const defaults = cloneDefaults();
    persistLegacyLocal(defaults);
    updateInMemory(defaults);
    return defaults;
  }

  async function resolveHouseholdId(supa) {
    if (!supa || !householdContext?.getHouseholdId) return null;
    try {
      return await householdContext.getHouseholdId(supa);
    } catch (err) {
      console.warn('categoryService: kunne ikke hente householdId', err);
      return null;
    }
  }

  async function fetchCategoriesFromDB(supa, householdId) {
    try {
      const { data, error } = await supa
        .from('household_categories')
        .select('id, name, enabled, sort_order')
        .eq('household_id', householdId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        console.warn('categoryService: klarte ikke hente kategorier', error);
        return null;
      }

      return sanitizeList(data);
    } catch (err) {
      console.warn('categoryService: nettverksfeil ved henting av kategorier', err);
      return null;
    }
  }

  async function seedCategoriesForHousehold(supa, householdId) {
    const legacy = readLegacyLocal();
    const source = legacy.length ? legacy : cloneDefaults();
    const payload = source.map((cat, idx) => ({
      household_id: householdId,
      name: cat.name,
      enabled: cat.enabled !== false,
      sort_order: Number.isFinite(cat.sort_order) ? cat.sort_order : idx,
    }));

    try {
      const { data, error } = await supa
        .from('household_categories')
        .insert(payload)
        .select('id, name, enabled, sort_order');

      if (error) {
        console.warn('categoryService: kunne ikke seede kategorier', error);
        return source;
      }

      return sanitizeList(data);
    } catch (err) {
      console.warn('categoryService: nettverksfeil ved seeding av kategorier', err);
      return source;
    }
  }

  async function refreshCategories(supa, householdId) {
    if (!householdId || !supa) {
      return loadLegacyFallback();
    }

    const remote = await fetchCategoriesFromDB(supa, householdId);
    if (Array.isArray(remote)) {
      let result = remote;
      if (remote.length === 0) {
        result = await seedCategoriesForHousehold(supa, householdId);
      }
      persistHouseholdCache(householdId, result);
      updateInMemory(result, householdId);
      return result;
    }

    const cached = readHouseholdCache(householdId);
    if (cached.length) {
      updateInMemory(cached, householdId);
      return cached;
    }

    return loadLegacyFallback();
  }

  async function loadCategorySettingsFromDB(supa, options = {}) {
    const householdId = await resolveHouseholdId(supa);
    if (!householdId) {
      return loadLegacyFallback();
    }

    if (inMemoryCategories.length && inMemoryHouseholdId === householdId) {
      return cloneList(inMemoryCategories);
    }

    const cached = readHouseholdCache(householdId);
    if (cached.length) {
      updateInMemory(cached, householdId);
      if (options.refresh !== false) {
        refreshCategories(supa, householdId).catch((err) => {
          console.warn('categoryService: bakgrunnsoppdatering feilet', err);
        });
      }
      return cloneList(cached);
    }

    const fresh = await refreshCategories(supa, householdId);
    return cloneList(fresh);
  }

  function loadCategorySettings(supa, options = {}) {
    if (!supa) {
      if (!inMemoryCategories.length) {
        return loadLegacyFallback();
      }
      return cloneList(inMemoryCategories);
    }
    return loadCategorySettingsFromDB(supa, options);
  }

  function saveCategorySettings(categories) {
    const sanitized = sanitizeList(categories);
    persistLegacyLocal(sanitized);
    updateInMemory(sanitized, inMemoryHouseholdId);
    return sanitized;
  }

  function getActiveCategories(list) {
    const source = Array.isArray(list) ? list : inMemoryCategories;
    return cloneList(source).filter((cat) => cat.enabled !== false);
  }

  async function resolveHouseholdContext(supa) {
    const householdId = await resolveHouseholdId(supa);
    if (!householdId) {
      throw new Error('Fant ikke husstand for bruker');
    }
    return { householdId };
  }

  async function getNextSortOrder(supa, householdId) {
    try {
      const { data, error } = await supa
        .from('household_categories')
        .select('sort_order')
        .eq('household_id', householdId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data && Number.isFinite(data.sort_order)) {
        return Number(data.sort_order) + 1;
      }
    } catch (err) {
      console.warn('categoryService: kunne ikke hente sort_order', err);
    }
    return inMemoryCategories.length
      ? Math.max(...inMemoryCategories.map((cat) => Number(cat.sort_order) || 0)) + 1
      : 0;
  }

  async function addCategory(supa, name, options = {}) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      throw new Error('Navn kan ikke være tomt');
    }
    const { householdId } = await resolveHouseholdContext(supa);
    const sortOrder = Number.isFinite(options.sort_order)
      ? options.sort_order
      : await getNextSortOrder(supa, householdId);

    const payload = {
      household_id: householdId,
      name: cleanName,
      enabled: options.enabled !== false,
      sort_order: sortOrder,
    };

    const { error } = await supa
      .from('household_categories')
      .insert(payload);

    if (error) {
      throw error;
    }

    return refreshCategories(supa, householdId);
  }

  async function updateCategoryName(supa, id, newName) {
    const cleanName = typeof newName === 'string' ? newName.trim() : '';
    if (!cleanName) {
      throw new Error('Navn kan ikke være tomt');
    }
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_categories')
      .update({ name: cleanName })
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) {
      throw error;
    }

    return refreshCategories(supa, householdId);
  }

  async function toggleCategoryEnabled(supa, id, enabled) {
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_categories')
      .update({ enabled: !!enabled })
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) {
      throw error;
    }

    return refreshCategories(supa, householdId);
  }

  async function deleteCategory(supa, id) {
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_categories')
      .delete()
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) {
      throw error;
    }

    return refreshCategories(supa, householdId);
  }

  async function reorderCategories(supa, orderedItems) {
    if (!Array.isArray(orderedItems) || orderedItems.length === 0) {
      return loadCategorySettings(supa);
    }
    const rows = orderedItems
      .map((entry, idx) => {
        if (!entry) return null;
        const id = typeof entry === 'string' ? entry : entry.id;
        if (!id) return null;
        const sortOrder = Number.isFinite(entry.sort_order) ? entry.sort_order : idx;
        return { id, sort_order: sortOrder };
      })
      .filter(Boolean);

    if (!rows.length) {
      return loadCategorySettings(supa);
    }

    const { householdId } = await resolveHouseholdContext(supa);
    const payload = rows.map((row) => ({
      id: row.id,
      household_id: householdId,
      sort_order: row.sort_order,
    }));

    const { error } = await supa
      .from('household_categories')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      throw error;
    }

    return refreshCategories(supa, householdId);
  }

  global.categoryService = {
    CATEGORY_SETTINGS_KEY,
    DEFAULT_CATEGORIES: cloneDefaults(),
    loadCategorySettings,
    saveCategorySettings,
    getActiveCategories,
    addCategory,
    updateCategoryName,
    toggleCategoryEnabled,
    reorderCategories,
    deleteCategory,
  };
})(window);
