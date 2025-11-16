(function (global) {
  function isoLocalToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateFromISOLocal(isoString) {
    if (!isoString) return new Date(NaN);
    const [y, m, d] = isoString.split('-').map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return new Date(NaN);
    return new Date(y, m - 1, d);
  }

  function mondayAtNoon(date = new Date()) {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (base.getDay() + 6) % 7; // 0 = monday
    base.setDate(base.getDate() - day);
    base.setHours(12, 0, 0, 0);
    return base;
  }

  function mondayISO(date = new Date()) {
    return mondayAtNoon(date).toISOString().slice(0, 10);
  }

  function isoWeekNumber(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  function formatRangeNoNO(fromDate, toDate) {
    const from = fromDate.toLocaleDateString('no-NO', { day: 'numeric', month: 'long' });
    const sameMonth = fromDate.getMonth() === toDate.getMonth();
    const to = toDate.toLocaleDateString(
      'no-NO',
      sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' }
    );
    return `${from}–${to}`;
  }

  function getActiveWeekISO() {
    let iso = localStorage.getItem('activeWeekISO');
    if (!iso) {
      iso = mondayISO();
      localStorage.setItem('activeWeekISO', iso);
    }
    return iso;
  }

  function setActiveWeekISO(iso) {
    if (iso) {
      localStorage.setItem('activeWeekISO', iso);
    }
  }

  function resolveWeekISOForDate(date) {
    return localStorage.getItem('activeWeekISO') || mondayISO(date || new Date());
  }

  function getISOWeekFromISODate(isoDate) {
    if (!isoDate) return null;
    const [y, m, d] = isoDate.split('-').map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return null;
    return isoWeekNumber(new Date(y, m - 1, d));
  }

  function weekLabelFromISO(isoMonday) {
    const weekNo = getISOWeekFromISODate(isoMonday);
    if (!weekNo) return '';
    return `Uke ${weekNo}`;
  }

  global.dateUtils = Object.freeze({
    isoLocalToday,
    dateFromISOLocal,
    mondayAtNoon,
    mondayISO,
    isoWeekNumber,
    formatRangeNoNO,
    getActiveWeekISO,
    setActiveWeekISO,
    resolveWeekISOForDate,
    getISOWeekFromISODate,
    weekLabelFromISO,
  });
})(window);
