(function (global) {
  const STORE_SETTINGS_KEY = 'purchase_stores_v1';
  const STORE_CACHE_PREFIX = 'purchase_stores_cache_v2';
  const DEFAULT_STORES = Object.freeze([
    { name: 'Kiwi', enabled: true },
    { name: 'Rema 1000', enabled: true },
    { name: 'Coop Extra', enabled: true },
    { name: 'Meny', enabled: true },
    { name: 'Spar', enabled: true },
    { name: 'Joker', enabled: false },
    { name: 'Bunnpris', enabled: false },
  ]);

  const householdContext = global.householdContext;
  let inMemoryStores = [];
  let storeHouseholdId = null;

  const cloneList = (list) =>
    Array.isArray(list) ? list.map((item) => ({ ...item })) : [];

  function sanitizeStore(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) return null;
    return {
      id: raw.id ?? null,
      name,
      enabled: raw.enabled !== false,
    };
  }

  function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(sanitizeStore).filter(Boolean);
  }

  function cloneDefaults() {
    return sanitizeList(DEFAULT_STORES);
  }

  function persistLegacyLocal(stores) {
    try {
      localStorage.setItem(STORE_SETTINGS_KEY, JSON.stringify(stores));
    } catch (err) {
      console.warn('Kunne ikke lagre butikk-cache lokalt', err);
    }
  }

  function readLegacyLocal() {
    try {
      const raw = localStorage.getItem(STORE_SETTINGS_KEY);
      if (!raw) return [];
      return sanitizeList(JSON.parse(raw));
    } catch (err) {
      console.warn('Kunne ikke lese legacy-butikker', err);
      return [];
    }
  }

  function updateInMemory(list, householdId = null) {
    inMemoryStores = cloneList(list);
    if (householdId) {
      storeHouseholdId = householdId;
    }
  }

  function cacheKey(householdId) {
    return householdId ? `${STORE_CACHE_PREFIX}_${householdId}` : null;
  }

  function persistHouseholdCache(householdId, stores) {
    const key = cacheKey(householdId);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(stores));
    } catch (err) {
      console.warn('Kunne ikke skrive butikk-cache', err);
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
      console.warn('Kunne ikke lese butikk-cache', err);
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
      console.warn('storeService: kunne ikke hente householdId', err);
      return null;
    }
  }

  async function fetchStoresFromDB(supa, householdId) {
    try {
      const { data, error } = await supa
        .from('household_stores')
        .select('id, name, enabled')
        .eq('household_id', householdId)
        .order('name', { ascending: true });

      if (error) {
        console.warn('storeService: klarte ikke hente butikker', error);
        return null;
      }

      return sanitizeList(data);
    } catch (err) {
      console.warn('storeService: nettverksfeil ved henting av butikker', err);
      return null;
    }
  }

  async function seedStoresForHousehold(supa, householdId) {
    const legacy = readLegacyLocal();
    const source = legacy.length ? legacy : cloneDefaults();
    const payload = source.map((store) => ({
      household_id: householdId,
      name: store.name,
      enabled: store.enabled !== false,
    }));

    try {
      const { data, error } = await supa
        .from('household_stores')
        .insert(payload)
        .select('id, name, enabled');

      if (error) {
        console.warn('storeService: kunne ikke seede butikker', error);
        return source;
      }
      return sanitizeList(data);
    } catch (err) {
      console.warn('storeService: nettverksfeil ved seeding av butikker', err);
      return source;
    }
  }

  async function refreshStores(supa, householdId) {
    if (!supa || !householdId) return loadLegacyFallback();

    const remote = await fetchStoresFromDB(supa, householdId);
    if (Array.isArray(remote)) {
      let result = remote;
      if (remote.length === 0) {
        result = await seedStoresForHousehold(supa, householdId);
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

  async function loadStoreSettingsFromDB(supa, options = {}) {
    const householdId = await resolveHouseholdId(supa);
    if (!householdId) {
      return loadLegacyFallback();
    }

    if (inMemoryStores.length && storeHouseholdId === householdId) {
      return cloneList(inMemoryStores);
    }

    const cached = readHouseholdCache(householdId);
    if (cached.length) {
      updateInMemory(cached, householdId);
      if (options.refresh !== false) {
        refreshStores(supa, householdId).catch((err) => {
          console.warn('storeService: bakgrunnsoppdatering feilet', err);
        });
      }
      return cloneList(cached);
    }

    const fresh = await refreshStores(supa, householdId);
    return cloneList(fresh);
  }

  function loadStoreSettings(supa, options = {}) {
    if (!supa) {
      if (!inMemoryStores.length) {
        return loadLegacyFallback();
      }
      return cloneList(inMemoryStores);
    }
    return loadStoreSettingsFromDB(supa, options);
  }

  function saveStoreSettings(stores) {
    const sanitized = sanitizeList(stores);
    persistLegacyLocal(sanitized);
    updateInMemory(sanitized, storeHouseholdId);
    return sanitized;
  }

  function getActiveStores(list) {
    const source = Array.isArray(list) ? list : inMemoryStores;
    return cloneList(source).filter((store) => store.enabled !== false);
  }

  async function resolveHouseholdContext(supa) {
    const householdId = await resolveHouseholdId(supa);
    if (!householdId) throw new Error('Fant ikke husstand');
    return { householdId };
  }

  async function addStore(supa, name, options = {}) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) throw new Error('Navn kan ikke være tomt');
    const { householdId } = await resolveHouseholdContext(supa);

    const payload = {
      household_id: householdId,
      name: cleanName,
      enabled: options.enabled !== false,
    };

    const { error } = await supa.from('household_stores').insert(payload);
    if (error) throw error;
    return refreshStores(supa, householdId);
  }

  async function toggleStoreEnabled(supa, id, enabled) {
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_stores')
      .update({ enabled: !!enabled })
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) throw error;
    return refreshStores(supa, householdId);
  }

  async function updateStoreName(supa, id, newName) {
    const cleanName = typeof newName === 'string' ? newName.trim() : '';
    if (!cleanName) throw new Error('Navn kan ikke være tomt');
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_stores')
      .update({ name: cleanName })
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) throw error;
    return refreshStores(supa, householdId);
  }

  async function deleteStore(supa, id) {
    const { householdId } = await resolveHouseholdContext(supa);
    const { error } = await supa
      .from('household_stores')
      .delete()
      .eq('household_id', householdId)
      .eq('id', id);

    if (error) throw error;
    return refreshStores(supa, householdId);
  }

  global.storeService = {
    STORE_SETTINGS_KEY,
    DEFAULT_STORES: cloneDefaults(),
    loadStoreSettings,
    saveStoreSettings,
    getActiveStores,
    addStore,
    toggleStoreEnabled,
    updateStoreName,
    deleteStore,
  };
})(window);
