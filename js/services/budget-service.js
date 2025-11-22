(function (global) {
  const DEFAULT_WEEKLY_BUDGET = 3000;
  const budgetUtils = global.budgetUtils || {};
  const dateUtils = global.dateUtils || {};
  const householdContext = global.householdContext;

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

  const ensureWeekISO = (weekISO) => {
    if (weekISO) {
      if (dateUtils.resolveWeekISOForDate && dateUtils.dateFromISOLocal) {
        return dateUtils.resolveWeekISOForDate(dateUtils.dateFromISOLocal(weekISO));
      }
      return weekISO;
    }
    if (dateUtils.getOrInitActiveWeekISO) {
      return dateUtils.getOrInitActiveWeekISO();
    }
    if (dateUtils.mondayISO) {
      return dateUtils.mondayISO();
    }
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today.toISOString().slice(0, 10);
  };

  const fetchBudgetForWeek = async (supa, householdId, weekISO) => {
    const normalizedWeek = ensureWeekISO(weekISO);
    if (!supa || !householdId) {
      console.warn('fetchBudgetForWeek: supa eller householdId mangler');
      return readWeeklyBudgetLocal(normalizedWeek, DEFAULT_WEEKLY_BUDGET);
    }

    try {
      const { data: budgetRow, error: budgetError } = await supa
        .from('household_budgets')
        .select('amount')
        .eq('household_id', householdId)
        .eq('week_start', normalizedWeek)
        .maybeSingle();

      if (!budgetError && budgetRow && typeof budgetRow.amount === 'number') {
        persistWeeklyBudget(normalizedWeek, budgetRow.amount);
        return budgetRow.amount;
      }

      let defaultAmount = DEFAULT_WEEKLY_BUDGET;
      try {
        const { data: household, error: householdErr } = await supa
          .from('households')
          .select('default_weekly_budget')
          .eq('id', householdId)
          .maybeSingle();

        if (!householdErr && typeof household?.default_weekly_budget === 'number') {
          defaultAmount = household.default_weekly_budget;
        } else if (householdErr) {
          console.warn('Klarte ikke hente default_weekly_budget fra households', householdErr);
        }
      } catch (err) {
        console.warn('Feil ved henting av households.default_weekly_budget', err);
      }

      try {
        const { error: upsertError } = await supa
          .from('household_budgets')
          .upsert(
            {
              household_id: householdId,
              week_start: normalizedWeek,
              amount: defaultAmount,
            },
            { onConflict: 'household_id,week_start' }
          );

        if (upsertError) {
          console.warn('Klarte ikke opprette budsjett for uke', upsertError);
        }
      } catch (err) {
        console.warn('Feil ved upsert av budsjett', err);
      }

      persistWeeklyBudget(normalizedWeek, defaultAmount);
      return defaultAmount;
    } catch (err) {
      console.warn('Klarte ikke hente/lagre budsjett fra Supabase', err);
      return readWeeklyBudgetLocal(normalizedWeek, DEFAULT_WEEKLY_BUDGET);
    }
  };

  const fetchPurchasesForWeek = async (
    supa,
    householdId,
    weekISO,
    selectColumns = 'amount, category'
  ) => {
    const normalizedWeek = ensureWeekISO(weekISO);
    if (!supa || !householdId) {
      console.warn('fetchPurchasesForWeek: supa eller householdId mangler');
      return [];
    }
    try {
      const { data, error } = await supa
        .from('purchases')
        .select(selectColumns)
        .eq('household_id', householdId)
        .eq('week_start', normalizedWeek);

      if (error) {
        console.warn('Klarte ikke hente purchases fra Supabase', error);
        return [];
      }

      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('Nettverksfeil ved henting av purchases', err);
      return [];
    }
  };

  async function deletePurchaseById(supa, purchaseId) {
    if (!supa || !purchaseId) {
      console.warn('deletePurchaseById: mangler supa eller purchaseId');
      return { error: 'Missing supa or id' };
    }

    try {
      const { error } = await supa
        .from('purchases')
        .delete()
        .eq('id', purchaseId);

      if (error) {
        console.warn('Klarte ikke slette purchase', error);
        return { error };
      }

      return { error: null };
    } catch (err) {
      console.warn('Uventet feil i deletePurchaseById', err);
      return { error: err };
    }
  }

  async function fetchWeeklySummary(supa, householdId, weekISO) {
    const normalizedWeek = ensureWeekISO(weekISO);
    if (!supa || !householdId || typeof supa.rpc !== 'function') return null;
    try {
      const { data, error } = await supa.rpc('get_weekly_summary', {
        p_household_id: householdId,
        p_week_start: normalizedWeek,
      });
      if (error || !data) return null;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;

      const budget = Number(row.budget);
      const spent = Number(row.spent);
      return {
        weekISO: normalizedWeek,
        budget: Number.isFinite(budget) ? budget : null,
        spent: Number.isFinite(spent) ? spent : 0,
      };
    } catch (err) {
      console.warn('fetchWeeklySummary RPC feilet', err);
      return null;
    }
  }

  async function loadWeekSummary(supa, weekISO, options = {}) {
    const activeISO = ensureWeekISO(weekISO);
    const includePurchases = options.includePurchases !== false;

    let budget = readWeeklyBudgetLocal(activeISO, DEFAULT_WEEKLY_BUDGET);
    let purchases = includePurchases ? readLocalPurchases(activeISO) : [];
    let spent = includePurchases ? safeSum(purchases) : 0;

    if (supa && options.skipRemote !== true) {
      try {
        const householdId = await householdContext?.getHouseholdId?.(supa);
        if (!householdId) {
          console.warn('Fant ikke householdId – hopper over remote oppslag');
        } else {
          let rpcSummary = null;
          if (options.useWeeklySummaryRpc !== false) {
            rpcSummary = await fetchWeeklySummary(supa, householdId, activeISO);
          }

          if (rpcSummary && Number.isFinite(rpcSummary.budget)) {
            budget = rpcSummary.budget;
            spent = Number.isFinite(rpcSummary.spent) ? rpcSummary.spent : spent;
            persistWeeklyBudget(activeISO, budget);
          }

          if (!rpcSummary || includePurchases) {
            const remoteBudget = await fetchBudgetForWeek(supa, householdId, activeISO);
            if (Number.isFinite(remoteBudget)) {
              budget = remoteBudget;
              persistWeeklyBudget(activeISO, remoteBudget);
            }

            if (includePurchases) {
              const remotePurchases = await fetchPurchasesForWeek(
                supa,
                householdId,
                activeISO,
                options.selectPurchases || 'amount, category'
              );
              if (Array.isArray(remotePurchases) && remotePurchases.length) {
                purchases = remotePurchases;
                spent = safeSum(remotePurchases);
                persistPurchases(activeISO, remotePurchases);
              } else if (!rpcSummary) {
                spent = safeSum(purchases);
              }
            }
          }
        }
      } catch (err) {
        console.warn('loadWeekSummary: fallback til lokal cache', err);
      }
    }

    const remaining = (Number(budget) || 0) - (Number(spent) || 0);
    localStorage.setItem('activeWeekISO', activeISO);
    persistWeeklyBudget(activeISO, Number(budget) || 0);

    return {
      weekISO: activeISO,
      budget: Number(budget) || 0,
      spent: Number(spent) || 0,
      remaining,
      purchases,
    };
  }

  global.budgetService = Object.freeze({
    loadWeekSummary,
    readWeeklyBudgetLocal,
    fetchBudgetForWeek,
    fetchWeeklySummary,
    fetchPurchasesForWeek,
    deletePurchaseById,
  });
})(window);
