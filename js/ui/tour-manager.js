(function initTourManager() {
  const STORAGE_KEY = 'tours_state';

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Kunne ikke lagre tour-state', err);
    }
  }

  function hasSeenTour(tourId, version) {
    if (!tourId) return false;
    const state = readState();
    const entry = state[tourId];
    if (!entry || entry.completed !== true) return false;
    return entry.version === version;
  }

  function markTourSeen(tourId, version) {
    if (!tourId) return;
    const state = readState();
    state[tourId] = {
      version,
      completed: true,
      completedAt: Math.floor(Date.now() / 1000)
    };
    writeState(state);
  }

  function waitFor(selector, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      if (!selector) {
        reject(new Error('Selector mangler'));
        return;
      }
      const start = performance.now();
      const check = () => {
        const node = document.querySelector(selector);
        if (node) {
          resolve(node);
          return;
        }
        if (performance.now() - start >= timeoutMs) {
          reject(new Error(`Fant ikke element for selector: ${selector}`));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function startTourIfNeeded({ tourId, version, steps, options } = {}) {
    if (!tourId || !Array.isArray(steps) || steps.length === 0) return;
    if (hasSeenTour(tourId, version)) return;

    const driverFactory = window.driver?.js?.driver;
    if (typeof driverFactory !== 'function') return;

    const mergedOptions = {
      overlayColor: 'rgba(0,0,0,0.55)',
      showProgress: true,
      nextBtnText: 'Neste',
      prevBtnText: 'Tilbake',
      doneBtnText: 'Ferdig',
      ...options,
      steps
    };

    const userOnDestroyed = mergedOptions.onDestroyed;
    mergedOptions.onDestroyed = (...args) => {
      try {
        markTourSeen(tourId, version);
      } catch (err) {
        console.warn('Kunne ikke markere tour som sett', err);
      }
      if (typeof userOnDestroyed === 'function') {
        try {
          userOnDestroyed(...args);
        } catch (err) {
          console.error('onDestroyed feilet', err);
        }
      }
    };

    const driverInstance = driverFactory(mergedOptions);
    try {
      driverInstance.drive();
    } catch (err) {
      console.error('Driver.js tour feilet', err);
    }
  }

  window.tourManager = {
    hasSeenTour,
    markTourSeen,
    startTourIfNeeded,
    waitFor
  };
})();
