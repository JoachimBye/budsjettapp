(function (global) {
  const CATEGORY_SETTINGS_KEY = 'purchase_categories_v1';
  const DEFAULT_CATEGORIES = Object.freeze([
    { name: '🥕 Mat & dagligvarer', enabled: true },
    { name: '🧽 Husholdning & rengjøring', enabled: true },
    { name: '🍞 Frokost & brød', enabled: true },
    { name: '🍿 Snacks & kos', enabled: true },
    { name: '🥬 Frukt & grønt', enabled: true },
    { name: '📦 Annet', enabled: false },
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
    return sanitizeList(DEFAULT_CATEGORIES);
  }

  function loadCategorySettings() {
    try {
      const serialized = localStorage.getItem(CATEGORY_SETTINGS_KEY);
      if (!serialized) {
        const defaults = cloneDefaults();
        saveCategorySettings(defaults);
        return defaults;
      }

      const parsed = JSON.parse(serialized);
      const sanitized = sanitizeList(parsed);
      if (sanitized.length === 0) {
        const defaults = cloneDefaults();
        saveCategorySettings(defaults);
        return defaults;
      }
      return sanitized;
    } catch (err) {
      console.warn('Kunne ikke lese kategori-innstillinger, bruker defaults.', err);
      const defaults = cloneDefaults();
      saveCategorySettings(defaults);
      return defaults;
    }
  }

  function saveCategorySettings(categories) {
    const sanitized = sanitizeList(categories);
    try {
      localStorage.setItem(CATEGORY_SETTINGS_KEY, JSON.stringify(sanitized));
    } catch (err) {
      console.error('Kunne ikke lagre kategori-innstillinger', err);
    }
    return sanitized;
  }

  function getActiveCategories() {
    return loadCategorySettings().filter((cat) => cat.enabled !== false);
  }

  global.categoryService = {
    CATEGORY_SETTINGS_KEY,
    DEFAULT_CATEGORIES: cloneDefaults(),
    loadCategorySettings,
    saveCategorySettings,
    getActiveCategories,
  };
})(window);
