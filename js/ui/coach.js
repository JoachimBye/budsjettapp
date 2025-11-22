(function (global) {
  function create({ steps = [], storageKey } = {}) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return null;
    }

    const waitForElement = (selector, timeoutMs = 2000) =>
      new Promise((resolve) => {
        if (!selector) {
          resolve(null);
          return;
        }

        const started = Date.now();
        const poll = () => {
          let el = null;
          try {
            el = document.querySelector(selector);
          } catch (err) {
            console.warn('Coach: ugyldig selector i steg', selector, err);
            resolve(null);
            return;
          }

          if (el) {
            resolve(el);
            return;
          }
          if (Date.now() - started >= timeoutMs) {
            resolve(null);
            return;
          }
          setTimeout(poll, 100);
        };
        poll();
      });

    const overlay = document.getElementById('coachOverlay');
    const highlight = document.getElementById('coachHighlight');
    const tooltip = document.getElementById('coachTooltip');
    const titleEl = document.getElementById('coachTitle');
    const textEl = document.getElementById('coachText');
    const stepLabelEl = document.getElementById('coachStepLabel');
    const skipBtn = document.getElementById('coachSkipBtn');
    const prevBtn = document.getElementById('coachPrevBtn');
    const nextBtn = document.getElementById('coachNextBtn');

    if (!overlay || !highlight || !tooltip || !titleEl || !textEl || !stepLabelEl) {
      console.warn('coach: mangler nødvendig DOM-struktur');
      return null;
    }

    let active = false;
    let currentStep = 0;
    let positionTimeoutId = null;

    const hasSeen = () => {
      if (!storageKey) return false;
      try {
        return localStorage.getItem(storageKey) === '1';
      } catch {
        return false;
      }
    };

    const markSeen = () => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, '1');
      } catch {
        // ignore
      }
    };

    const clearPositionTimeout = () => {
      if (positionTimeoutId) {
        clearTimeout(positionTimeoutId);
        positionTimeoutId = null;
      }
    };

    function positionFor(target) {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 8;
      const viewportW = window.innerWidth || document.documentElement.clientWidth;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;

      const left = rect.left + window.scrollX - padding;
      const top = rect.top + window.scrollY - padding;
      const width = rect.width + padding * 2;
      const height = rect.height + padding * 2;

      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${width}px`;
      highlight.style.height = `${height}px`;
      highlight.style.opacity = 1;

      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = 0;
      tooltip.style.transform = 'none';

      requestAnimationFrame(() => {
        const ttRect = tooltip.getBoundingClientRect();
        const placeBelow = rect.top < 200;
        const minLeft = window.scrollX + 8;
        const maxLeft = window.scrollX + viewportW - ttRect.width - 8;
        const centeredLeft = rect.left + window.scrollX + rect.width / 2 - ttRect.width / 2;
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, centeredLeft));

        let ttTop = placeBelow
          ? rect.bottom + window.scrollY + 16
          : rect.top + window.scrollY - ttRect.height - 16;
        const minTop = window.scrollY + 8;
        const maxTop = window.scrollY + viewportH - ttRect.height - 8;
        ttTop = Math.max(minTop, Math.min(maxTop, ttTop));

        tooltip.style.left = `${clampedLeft}px`;
        tooltip.style.top = `${ttTop}px`;
        tooltip.style.visibility = 'visible';
        tooltip.style.opacity = 1;
      });
    }

    async function goToStep(index) {
      if (index < 0 || index >= steps.length) {
        stop();
        return;
      }

      clearPositionTimeout();
      highlight.style.opacity = 0;
      tooltip.style.opacity = 0;

      currentStep = index;
      const step = steps[currentStep] || {};
      const target = await waitForElement(step.selector, 2000);
      if (!active) return;

      if (!target) {
        console.warn('Coach: fant ikke element for steg', index, step?.selector);
        goToStep(currentStep + 1);
        return;
      }

      titleEl.textContent = step.title || '';
      textEl.textContent = step.text || '';
      stepLabelEl.textContent = `Steg ${currentStep + 1} av ${steps.length}`;
      if (prevBtn) prevBtn.disabled = currentStep === 0;
      if (nextBtn) {
        nextBtn.textContent = currentStep === steps.length - 1 ? 'Ferdig' : 'Neste';
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

      const stepAtSchedule = currentStep;
      positionTimeoutId = setTimeout(() => {
        if (!active) return;
        if (stepAtSchedule !== currentStep) return;
        if (!document.body.contains(target)) return;
        positionFor(target);
      }, 400);
    }

    function start(startIndex = 0) {
      if (!steps.length || hasSeen()) return;
      active = true;
      overlay.style.display = 'block';
      goToStep(startIndex);
    }

    function stop() {
      clearPositionTimeout();
      active = false;
      overlay.style.display = 'none';
      highlight.style.opacity = 0;
      tooltip.style.opacity = 0;
      tooltip.style.visibility = 'hidden';
      markSeen();
    }

    const handleSkip = (evt) => {
      evt?.stopPropagation();
      stop();
    };
    skipBtn?.addEventListener('click', handleSkip);
    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) {
        stop();
      }
    });
    prevBtn?.addEventListener('click', (evt) => {
      evt?.stopPropagation();
      if (currentStep > 0) {
        goToStep(currentStep - 1);
      }
    });
    nextBtn?.addEventListener('click', (evt) => {
      evt?.stopPropagation();
      if (currentStep < steps.length - 1) {
        goToStep(currentStep + 1);
      } else {
        stop();
      }
    });
    window.addEventListener('resize', () => {
      if (!active) return;
      const step = steps[currentStep];
      if (!step?.selector) return;
      let target = null;
      try {
        target = document.querySelector(step.selector);
      } catch {
        return;
      }
      if (target) positionFor(target);
    });
    document.addEventListener('keydown', (evt) => {
      if (!active) return;
      if (evt.key === 'Escape') {
        stop();
      }
    });

    return {
      start,
      stop,
      next: () => goToStep(currentStep + 1),
      prev: () => goToStep(currentStep - 1),
      goToStep,
      hasSeen,
      markSeen,
    };
  }

  global.coach = {
    create,
  };
})(window);
