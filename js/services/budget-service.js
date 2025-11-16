(function (global) {
  const DEFAULT_WEEKLY_BUDGET = 3000;
  const budgetUtils = global.budgetUtils || {};
  const dateUtils = global.dateUtils || {};

  const safeSum = (list) => {
    if (budgetUtils.safeSumPurchases) {
      return budgetUtils.safeSumPurchases(list);
    }
    return Array.isArray(list)
      ? list.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0)
      : 0;
  };

  const readJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };

  const readWeeklyBudgetLocal = (weekISO, fallback = DEFAULT_WEEKLY_BUDGET) => {
    const specific = parseInt(localStorage.getItem(`weeklyBudget_${weekISO}`) || '', 10);
    if (!Number.isNaN(specific) && specific > 0) return specific;
    const globalBudget = parseInt(localStorage.getItem('weeklyBudget') || '', 10);
    if (!Number.isNaN(globalBudget) && globalBudget > 0) return globalBudget;
    return fallback;
  };

  const persistWeeklyBudget = (weekISO, amount) => {
    if (!weekISO || !Number.isFinite(amount)) return;
    localStorage.setItem(`weeklyBudget_${weekISO}`, String(amount));
    localStorage.setItem('weeklyBudget', String(amount));
    localStorage.setItem('budget_total', String(amount));
  };

  const readLocalPurchases = (weekISO) => {
    const list = readJSON(`purchases_${weekISO}`, []);
    return Array.isArray(list) ? list : [];
  };

  const persistPurchases = (weekISO, purchases) => {
    try {
      localStorage.setItem(`purchases_${weekISO}`, JSON.stringify(purchases));
    } catch (err) {
      console.warn('Kunne ikke lagre purchases til localStorage', err);
    }
  };

  const fetchSession = async (supa) => {
    if (!supa) return null;
    try {
      const { data } = await supa.auth.getSession();
      return data?.session || null;
    } catch (err) {
      console.warn('Klarte ikke hente Supabase-session', err);
      return null;
    }
  };

  const fetchBudgetForWeek = async (supa, session, weekISO) => {
    if (!supa || !session) return null;
    try {
      const { data: budgetRow, error } = await supa
        .from('household_budgets')
        .select('amount')
        .eq('user_id', session.user.id)
        .eq('week_start', weekISO)
        .maybeSingle();

      if (!error && budgetRow && typeof budgetRow.amount === 'number') {
        return budgetRow.amount;
      }

      const { data: member, error: memberErr } = await supa
        .from('members')
        .select('household_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (memberErr || !member?.household_id) {
        return null;
      }

      const { data: household, error: householdErr } = await supa
        .from('households')
        .select('default_weekly_budget')
        .eq('id', member.household_id)
        .maybeSingle();

      if (!householdErr && typeof household?.default_weekly_budget === 'number') {
        return household.default_weekly_budget;
      }
    } catch (err) {
      console.warn('Klarte ikke hente budsjett fra Supabase', err);
    }
    return null;
  };

  const fetchPurchasesForWeek = async (supa, weekISO, selectColumns = 'amount, category') => {
    if (!supa) return null;
    try {
      const { data, error } = await supa
        .from('purchases')
        .select(selectColumns)
        .eq('week_start', weekISO);

      if (error) {
        console.warn('Klarte ikke hente purchases fra Supabase', error);
        return null;
      }

      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('Nettverksfeil ved henting av purchases', err);
      return null;
    }
  };

  async function loadWeekSummary(supa, weekISO, options = {}) {
    const activeISO =
      weekISO ||
      (dateUtils.getActiveWeekISO
        ? dateUtils.getActiveWeekISO()
        : (dateUtils.mondayISO ? dateUtils.mondayISO() : new Date().toISOString().slice(0, 10)));

    const defaultBudget = options.defaultBudget ?? DEFAULT_WEEKLY_BUDGET;
    let budget = readWeeklyBudgetLocal(activeISO, defaultBudget);
    let purchases = readLocalPurchases(activeISO);

    let session = null;
    if (options.skipRemote !== true) {
      session = await fetchSession(supa);
    }

    if (session && options.skipRemote !== true) {
      const remoteBudget = await fetchBudgetForWeek(supa, session, activeISO);
      if (typeof remoteBudget === 'number' && remoteBudget > 0) {
        budget = remoteBudget;
        persistWeeklyBudget(activeISO, remoteBudget);
      }

      if (options.includePurchases !== false) {
        const remotePurchases = await fetchPurchasesForWeek(
          supa,
          activeISO,
          options.selectPurchases || 'amount, category'
        );
        if (Array.isArray(remotePurchases)) {
          purchases = remotePurchases;
          persistPurchases(activeISO, purchases);
        }
      }
    }

    const spent = safeSum(purchases);
    const remaining = (Number(budget) || 0) - spent;

    localStorage.setItem('activeWeekISO', activeISO);
    persistWeeklyBudget(activeISO, Number(budget) || 0);

    return {
      weekISO: activeISO,
      budget: Number(budget) || 0,
      spent,
      remaining,
      purchases,
    };
  }

  global.budgetService = Object.freeze({
    loadWeekSummary,
    readWeeklyBudgetLocal,
  });
})(window);
