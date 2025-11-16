(function (global) {
  const STORE_SETTINGS_KEY = 'purchase_stores_v1';
  const DEFAULT_STORES = Object.freeze([
    { name: 'Kiwi', enabled: true },
    { name: 'Rema 1000', enabled: true },
    { name: 'Coop Extra', enabled: true },
    { name: 'Meny', enabled: true },
    { name: 'Spar', enabled: true },
    { name: 'Joker', enabled: false },
    { name: 'Bunnpris', enabled: false },
  ]);

  function sanitizeList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((raw) => {
        const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
        return name
          ? {
              name,
              enabled: raw?.enabled !== false,
            }
          : null;
      })
      .filter(Boolean);
  }

  function cloneDefaults() {
    return sanitizeList(DEFAULT_STORES);
  }

  function loadStoreSettings() {
    try {
      const serialized = localStorage.getItem(STORE_SETTINGS_KEY);
      if (!serialized) {
        const defaults = cloneDefaults();
        saveStoreSettings(defaults);
        return defaults;
      }

      const parsed = JSON.parse(serialized);
      const sanitized = sanitizeList(parsed);
      if (sanitized.length === 0) {
        const defaults = cloneDefaults();
        saveStoreSettings(defaults);
        return defaults;
      }
      return sanitized;
    } catch (err) {
      console.warn('Kunne ikke lese butikk-innstillinger, bruker defaults.', err);
      const defaults = cloneDefaults();
      saveStoreSettings(defaults);
      return defaults;
    }
  }

  function saveStoreSettings(stores) {
    const sanitized = sanitizeList(stores);
    try {
      localStorage.setItem(STORE_SETTINGS_KEY, JSON.stringify(sanitized));
    } catch (err) {
      console.error('Kunne ikke lagre butikk-innstillinger', err);
    }
    return sanitized;
  }

  function getActiveStores() {
    return loadStoreSettings().filter((store) => store.enabled !== false);
  }

  global.storeService = {
    STORE_SETTINGS_KEY,
    DEFAULT_STORES: cloneDefaults(),
    loadStoreSettings,
    saveStoreSettings,
    getActiveStores,
  };
})(window);
