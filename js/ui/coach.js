(function (global) {
  function create({ steps = [], storageKey } = {}) {
    if (!Array.isArray(steps) || steps.length === 0) {
      return null;
    }

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
    let previousOverflow = '';

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

    function positionFor(target) {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 8;
      const left = rect.left + window.scrollX - padding;
      const top = rect.top + window.scrollY - padding;
      const width = rect.width + padding * 2;
      const height = rect.height + padding * 2;

      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${width}px`;
      highlight.style.height = `${height}px`;
      highlight.style.opacity = 1;

      tooltip.style.left = '50%';
      tooltip.style.transform = 'translateX(-50%)';
      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = 0;

      requestAnimationFrame(() => {
        const ttRect = tooltip.getBoundingClientRect();
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const placeAbove = rect.top > viewportH / 2;
        let ttTop;
        if (placeAbove) {
          ttTop = Math.max(16, rect.top + window.scrollY - ttRect.height - 16);
        } else {
          ttTop = Math.min(
            window.scrollY + viewportH - ttRect.height - 16,
            rect.bottom + window.scrollY + 16
          );
        }
        tooltip.style.top = `${ttTop}px`;
        tooltip.style.visibility = 'visible';
        tooltip.style.opacity = 1;
      });
    }

    function goToStep(index) {
      if (index < 0 || index >= steps.length) {
        stop();
        return;
      }
      currentStep = index;
      const step = steps[currentStep] || {};
      let target = null;
      try {
        target = step.selector ? document.querySelector(step.selector) : null;
      } catch (err) {
        console.warn('coach: ugyldig selector i steg', step, err);
      }
      if (!target) {
        console.warn('coach: fant ikke element for steg', step?.id || currentStep, step?.selector);
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

      const hadHiddenOverflow = document.body.style.overflow === 'hidden';
      if (hadHiddenOverflow) {
        document.body.style.overflow = previousOverflow || '';
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      setTimeout(() => {
        if (!active) return;
        positionFor(target);
        if (hadHiddenOverflow) {
          document.body.style.overflow = 'hidden';
        }
      }, 350);
    }

    function start(startIndex = 0) {
      if (!steps.length) return;
      active = true;
      overlay.style.display = 'block';
      previousOverflow = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
      goToStep(startIndex);
      markSeen();
    }

    function stop() {
      active = false;
      overlay.style.display = 'none';
      highlight.style.opacity = 0;
      tooltip.style.opacity = 0;
      document.body.style.overflow = previousOverflow;
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
      const target = document.querySelector(step.selector);
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
