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

  let inMemoryStores = [];
  let storeHouseholdId = null;
  let cachedHouseholdContext = { userId: null, householdId: null };

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

  const fetchSession = async (supa) => {
    if (!supa) return null;
    try {
      const { data } = await supa.auth.getSession();
      return data?.session || null;
    } catch (err) {
      console.warn('storeService: kunne ikke hente session', err);
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
        const { data: rpcData, error: rpcError } = await supa.rpc('get_my_household_id');
        if (!rpcError && rpcData) {
          cacheHouseholdId(session, rpcData);
          return rpcData;
        }
      }
    } catch (rpcErr) {
      console.warn('storeService: get_my_household_id feilet', rpcErr);
    }

    try {
      const { data: member, error } = await supa
        .from('members')
        .select('household_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!error && member?.household_id) {
        cacheHouseholdId(session, member.household_id);
        return member.household_id;
      }
    } catch (err) {
      console.warn('storeService: kunne ikke hente household_id', err);
    }

    return null;
  };

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
    const remote = await fetchStoresFromDB(supa, householdId);
    if (Array.isArray(remote)) {
      persistHouseholdCache(householdId, remote);
      updateInMemory(remote, householdId);
      return remote;
    }
    const cached = readHouseholdCache(householdId);
    if (cached.length) {
      updateInMemory(cached, householdId);
      return cached;
    }
    return loadLegacyFallback();
  }

  async function loadStoreSettingsFromDB(supa) {
    const session = await fetchSession(supa);
    if (!session) {
      return loadLegacyFallback();
    }
    const householdId = await fetchHouseholdId(supa, session);
    if (!householdId) {
      return loadLegacyFallback();
    }

    let stores = await fetchStoresFromDB(supa, householdId);
    if (Array.isArray(stores)) {
      if (stores.length === 0) {
        stores = await seedStoresForHousehold(supa, householdId);
      }
      persistHouseholdCache(householdId, stores);
      updateInMemory(stores, householdId);
      return stores;
    }

    const cached = readHouseholdCache(householdId);
    if (cached.length) {
      updateInMemory(cached, householdId);
      return cached;
    }

    return loadLegacyFallback();
  }

  function loadStoreSettings(supa) {
    if (!supa) {
      if (!inMemoryStores.length) {
        return loadLegacyFallback();
      }
      return cloneList(inMemoryStores);
    }
    return loadStoreSettingsFromDB(supa);
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
    const session = await fetchSession(supa);
    if (!session) throw new Error('Ikke innlogget');
    const householdId = await fetchHouseholdId(supa, session);
    if (!householdId) throw new Error('Fant ikke husstand');
    return { session, householdId };
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
