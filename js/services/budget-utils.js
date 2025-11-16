(function (global) {
  function parseAmount(value) {
    if (typeof value === 'number') {
      return isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/[^\d.,-]/g, '').replace(',', '.');
      const parsed = parseFloat(normalized);
      return isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function safeSumPurchases(arr) {
    if (!Array.isArray(arr)) return 0;
    return arr.reduce((sum, item) => {
      if (item == null) return sum;
      if (typeof item === 'number' || typeof item === 'string') {
        return sum + parseAmount(item);
      }
      if (typeof item === 'object') {
        const keys = ['amount', 'sum', 'price', 'value', 'kostnad'];
        for (const key of keys) {
          if (key in item) {
            return sum + parseAmount(item[key]);
          }
        }
      }
      return sum;
    }, 0);
  }

  global.budgetUtils = {
    ...(global.budgetUtils || {}),
    safeSumPurchases,
  };
})(window);
