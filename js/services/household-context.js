(function () {
  const state = {
    householdId: null,
    resolving: false,
    waiters: [],
  };

  async function resolveHouseholdIdInternal(supa) {
    if (!supa) return null;

    try {
      if (typeof supa.rpc === 'function') {
        const { data, error } = await supa.rpc('get_my_household_id');
        if (!error && data) return data;
      }
    } catch (e) {
      console.warn('RPC get_my_household_id failed', e);
    }

    try {
      const { data: { session } } = await supa.auth.getSession();
      if (!session) return null;

      const { data: member, error: memberErr } = await supa
        .from('members')
        .select('household_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!memberErr && member?.household_id) {
        return member.household_id;
      }
    } catch (e) {
      console.warn('members fallback failed', e);
    }

    return null;
  }

  async function getHouseholdId(supa) {
    if (state.householdId) return state.householdId;

    if (state.resolving) {
      return new Promise((resolve, reject) => {
        state.waiters.push({ resolve, reject });
      });
    }

    state.resolving = true;
    try {
      const id = await resolveHouseholdIdInternal(supa);
      state.householdId = id;
      state.waiters.forEach((w) => w.resolve(id));
      state.waiters = [];
      return id;
    } catch (err) {
      state.waiters.forEach((w) => w.reject(err));
      state.waiters = [];
      throw err;
    } finally {
      state.resolving = false;
    }
  }

  function clearCache() {
    state.householdId = null;
  }

  window.householdContext = Object.freeze({
    getHouseholdId,
    clearCache,
  });
})();
