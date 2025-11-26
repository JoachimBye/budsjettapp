(function (global) {
  const STORAGE_KEY_V2 = 'coach_state_v2';

  function readCoachState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_V2);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (err) {
      console.warn('CoachEngine: Kunne ikke lese coach_state_v2', err);
    }
    return {};
  }

  function writeCoachState(pageId, version) {
    if (!pageId) return;
    const state = readCoachState();
    state[pageId] = { version, seenAt: Date.now() };
    try {
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
    } catch (err) {
      console.warn('CoachEngine: Kunne ikke skrive coach_state_v2', err);
    }
  }

  async function waitForCondition(predicateFn, timeoutMs = 2000, intervalMs = 100) {
    const start = Date.now();
    return new Promise((resolve) => {
      function tick() {
        try {
          if (predicateFn()) return resolve(true);
        } catch (e) {
          // Ignorer og prøv igjen
        }
        if (Date.now() - start >= timeoutMs) return resolve(false);
        setTimeout(tick, intervalMs);
      }
      tick();
    });
  }

  class CoachEngine {
    constructor(options = {}) {
      this.options = options;
      this.steps = [];
      this.pageId = null;
      this.version = null;
      this.active = false;
      this.currentStepIndex = 0;
      this.currentTarget = null;
      this.positionTimeoutId = null;
      this.elements = {
        overlay: null,
        highlight: null,
        tooltip: null,
        titleEl: null,
        textEl: null,
        stepLabelEl: null,
        prevBtn: null,
        nextBtn: null,
        skipBtn: null,
      };
      this.listenersAttached = false;

      this.boundHandleOverlayClick = this.handleOverlayClick.bind(this);
      this.boundHandleKeydown = this.handleKeydown.bind(this);
      this.boundHandleResize = this.handleResize.bind(this);
      this.boundHandleScroll = this.handleScroll.bind(this);
      this.boundHandleNext = this.handleNext.bind(this);
      this.boundHandlePrev = this.handlePrev.bind(this);
      this.boundHandleSkip = this.handleSkip.bind(this);
    }

    startTour({ pageId, version = 1, steps = [] } = {}) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return;
      }
      this.pageId = pageId || this.pageId;
      this.version = version;
      this.steps = steps;

      if (this.hasSeenCurrentVersion()) {
        return;
      }

      this.ensureDom();
      this.attachListeners();
      this.active = true;
      this.showOverlay();
      this.goToStep(0);
    }

    hasSeenCurrentVersion() {
      if (!this.pageId) return false;
      const state = readCoachState();
      return state[this.pageId]?.version === this.version;
    }

    markSeen() {
      if (!this.pageId) return;
      writeCoachState(this.pageId, this.version);
    }

    reset(pageId = null) {
      if (pageId) {
        const state = readCoachState();
        delete state[pageId];
        try {
          localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
        } catch (err) {
          console.warn('CoachEngine: Kunne ikke resette state for side', err);
        }
        return;
      }
      try {
        localStorage.removeItem(STORAGE_KEY_V2);
      } catch (err) {
        console.warn('CoachEngine: Kunne ikke fjerne coach_state_v2', err);
      }
    }

    ensureDom() {
      if (this.elements.overlay && document.body.contains(this.elements.overlay)) {
        return;
      }

      const overlay = document.createElement('div');
      overlay.id = 'coachOverlay';
      overlay.className = 'coach-v2-overlay';
      overlay.style.cssText = [
        'position: fixed',
        'inset: 0',
        'background: rgba(17, 24, 39, 0.55)',
        'backdrop-filter: blur(2px)',
        'z-index: 9998',
        'display: none',
        'opacity: 0',
        'transition: opacity 0.2s ease',
      ].join(';');

      const highlight = document.createElement('div');
      highlight.id = 'coachHighlight';
      highlight.className = 'coach-v2-highlight';
      highlight.style.cssText = [
        'position: absolute',
        'border-radius: 24px',
        'background: #ffffff',
        'box-shadow: 0 22px 60px rgba(0, 0, 0, 0.14)',
        'transition: all 0.35s ease-out',
        'opacity: 0',
        'pointer-events: none',
        'transform: translate3d(0,0,0)',
      ].join(';');

      const tooltip = document.createElement('div');
      tooltip.id = 'coachTooltip';
      tooltip.className = 'coach-v2-tooltip';
      tooltip.style.cssText = [
        'position: absolute',
        'max-width: 380px',
        'width: min(380px, calc(100vw - 32px))',
        'background: #ffffff',
        'border-radius: 20px',
        'box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15)',
        'padding: 16px 18px 14px',
        'color: #111827',
        'opacity: 0',
        'display: flex',
        'flex-direction: column',
        'gap: 10px',
        'z-index: 10000',
        'transition: opacity 0.25s ease',
      ].join(';');

      const stepLabelEl = document.createElement('div');
      stepLabelEl.id = 'coachStepLabel';
      stepLabelEl.style.cssText = [
        'font-size: 12px',
        'font-weight: 700',
        'letter-spacing: 0.06em',
        'text-transform: uppercase',
        'color: #6b7280',
        'margin: 0',
      ].join(';');

      const titleEl = document.createElement('h3');
      titleEl.id = 'coachTitle';
      titleEl.style.cssText = [
        'margin: 0',
        'font-size: 18px',
        'font-weight: 800',
        'color: #0f172a',
      ].join(';');

      const textEl = document.createElement('p');
      textEl.id = 'coachText';
      textEl.style.cssText = [
        'margin: 4px 0 0',
        'font-size: 15px',
        'line-height: 1.6',
        'color: #4b5563',
      ].join(';');

      const buttons = document.createElement('div');
      buttons.className = 'coach-v2-buttons';
      buttons.style.cssText = [
        'display: flex',
        'gap: 10px',
        'margin-top: 6px',
        'justify-content: flex-end',
        'flex-wrap: wrap',
      ].join(';');

      const skipBtn = this.buildButton('Hopp over', 'ghost');
      skipBtn.id = 'coachSkipBtn';
      const prevBtn = this.buildButton('Tilbake', 'secondary');
      prevBtn.id = 'coachPrevBtn';
      const nextBtn = this.buildButton('Neste', 'primary');
      nextBtn.id = 'coachNextBtn';

      tooltip.appendChild(stepLabelEl);
      tooltip.appendChild(titleEl);
      tooltip.appendChild(textEl);
      buttons.appendChild(skipBtn);
      buttons.appendChild(prevBtn);
      buttons.appendChild(nextBtn);
      tooltip.appendChild(buttons);

      tooltip.addEventListener('click', (evt) => evt.stopPropagation());

      overlay.appendChild(highlight);
      overlay.appendChild(tooltip);
      document.body.appendChild(overlay);

      this.elements = {
        overlay,
        highlight,
        tooltip,
        titleEl,
        textEl,
        stepLabelEl,
        prevBtn,
        nextBtn,
        skipBtn,
      };
    }

    buildButton(label, variant = 'primary') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;

      const base = [
        'border: none',
        'border-radius: 999px',
        'font-weight: 700',
        'padding: 10px 16px',
        'cursor: pointer',
        'transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease',
        'font-size: 14px',
        'line-height: 1',
      ];

      if (variant === 'secondary') {
        base.push(
          'background: #f3f4f6',
          'color: #111827',
          'box-shadow: inset 0 1px 0 rgba(255,255,255,0.6)'
        );
      } else if (variant === 'ghost') {
        base.push('background: transparent', 'color: #4b5563');
      } else {
        base.push(
          'background: linear-gradient(135deg, #0f5132, #0ea76b)',
          'color: #ffffff',
          'box-shadow: 0 12px 30px rgba(16, 185, 129, 0.25)'
        );
      }

      btn.style.cssText = base.join(';');
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-1px)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
      });

      return btn;
    }

    attachListeners() {
      if (this.listenersAttached || !this.elements.overlay) return;
      this.listenersAttached = true;

      this.elements.overlay.addEventListener('click', this.boundHandleOverlayClick);
      this.elements.nextBtn?.addEventListener('click', this.boundHandleNext);
      this.elements.prevBtn?.addEventListener('click', this.boundHandlePrev);
      this.elements.skipBtn?.addEventListener('click', this.boundHandleSkip);

      window.addEventListener('keydown', this.boundHandleKeydown);
      window.addEventListener('resize', this.boundHandleResize);
      window.addEventListener('scroll', this.boundHandleScroll, true);
    }

    teardownListeners() {
      if (!this.listenersAttached) return;
      this.listenersAttached = false;

      this.elements.overlay?.removeEventListener('click', this.boundHandleOverlayClick);
      this.elements.nextBtn?.removeEventListener('click', this.boundHandleNext);
      this.elements.prevBtn?.removeEventListener('click', this.boundHandlePrev);
      this.elements.skipBtn?.removeEventListener('click', this.boundHandleSkip);

      window.removeEventListener('keydown', this.boundHandleKeydown);
      window.removeEventListener('resize', this.boundHandleResize);
      window.removeEventListener('scroll', this.boundHandleScroll, true);
    }

    showOverlay() {
      if (!this.elements.overlay) return;
      this.elements.overlay.style.display = 'block';
      requestAnimationFrame(() => {
        if (this.elements.overlay) {
          this.elements.overlay.style.opacity = '1';
        }
      });
    }

    clearPositionTimeout() {
      if (this.positionTimeoutId) {
        clearTimeout(this.positionTimeoutId);
        this.positionTimeoutId = null;
      }
    }

    async goToStep(index) {
      if (!this.active) return;
      if (!Array.isArray(this.steps) || this.steps.length === 0) {
        this.finish(false);
        return;
      }

      if (index < 0) index = 0;
      if (index >= this.steps.length) {
        this.finish(true);
        return;
      }

      this.clearPositionTimeout();
      this.currentStepIndex = index;

      const step = this.steps[this.currentStepIndex] || {};
      const { waitCondition } = step;

      if (typeof waitCondition === 'function') {
        await waitForCondition(waitCondition);
      }

      let target = null;
      if (step.selector) {
        try {
          target = document.querySelector(step.selector);
        } catch (err) {
          console.warn('CoachEngine: Ugyldig selector', step.selector, err);
        }
      }

      if (!this.active) return;

      if (!target) {
        console.warn('CoachEngine: Fant ikke element for steg', step.id || step.selector || index);
        this.goToStep(this.currentStepIndex + 1);
        return;
      }

      this.currentTarget = target;
      this.updateTooltipContent(step);
      this.updateButtons();

      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        // Ignorer scroll-feil
      }

      const scheduledStep = this.currentStepIndex;
      this.positionTimeoutId = window.setTimeout(() => {
        if (!this.active || scheduledStep !== this.currentStepIndex) return;
        this.positionElements(target, step);
      }, 380);
    }

    updateTooltipContent(step) {
      if (this.elements.titleEl) {
        this.elements.titleEl.textContent = step.title || '';
      }
      if (this.elements.textEl) {
        this.elements.textEl.textContent = step.text || '';
      }
      if (this.elements.stepLabelEl) {
        this.elements.stepLabelEl.textContent = `Steg ${this.currentStepIndex + 1} av ${this.steps.length}`;
      }
    }

    updateButtons() {
      if (this.elements.prevBtn) {
        this.elements.prevBtn.disabled = this.currentStepIndex === 0;
        this.elements.prevBtn.style.opacity = this.elements.prevBtn.disabled ? '0.6' : '1';
        this.elements.prevBtn.style.cursor = this.elements.prevBtn.disabled ? 'not-allowed' : 'pointer';
      }
      if (this.elements.nextBtn) {
        this.elements.nextBtn.textContent =
          this.currentStepIndex === this.steps.length - 1 ? 'Ferdig' : 'Neste';
      }
    }

    positionElements(target, step) {
      if (!this.elements.overlay || !this.elements.highlight || !this.elements.tooltip) return;
      if (!document.body.contains(target)) {
        this.goToStep(this.currentStepIndex + 1);
        return;
      }

      const padding = 12;
      const rect = target.getBoundingClientRect();
      const left = rect.left + window.scrollX - padding;
      const top = rect.top + window.scrollY - padding;
      const width = rect.width + padding * 2;
      const height = rect.height + padding * 2;

      this.elements.highlight.style.left = `${left}px`;
      this.elements.highlight.style.top = `${top}px`;
      this.elements.highlight.style.width = `${width}px`;
      this.elements.highlight.style.height = `${height}px`;
      this.elements.highlight.style.opacity = '1';

      this.elements.tooltip.style.visibility = 'hidden';
      this.elements.tooltip.style.opacity = '0';

      requestAnimationFrame(() => {
        const ttRect = this.elements.tooltip.getBoundingClientRect();
        const placement = this.getPlacement(step, rect, ttRect);

        const viewportW = window.innerWidth || document.documentElement.clientWidth;
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const minLeft = window.scrollX + 12;
        const maxLeft = window.scrollX + viewportW - ttRect.width - 12;
        const centeredLeft = rect.left + window.scrollX + rect.width / 2 - ttRect.width / 2;
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, centeredLeft));

        let tooltipTop = placement === 'top'
          ? rect.top + window.scrollY - ttRect.height - 18
          : rect.bottom + window.scrollY + 18;

        const minTop = window.scrollY + 12;
        const maxTop = window.scrollY + viewportH - ttRect.height - 12;
        tooltipTop = Math.max(minTop, Math.min(maxTop, tooltipTop));

        this.elements.tooltip.style.left = `${clampedLeft}px`;
        this.elements.tooltip.style.top = `${tooltipTop}px`;
        this.elements.tooltip.style.visibility = 'visible';
        this.elements.tooltip.style.opacity = '1';
      });
    }

    getPlacement(step, rect, ttRect) {
      if (step.placement === 'top' || step.placement === 'bottom') {
        return step.placement;
      }
      const hasSpaceAbove = rect.top > ttRect.height + 32;
      if (hasSpaceAbove && rect.top > 200) return 'top';
      return 'bottom';
    }

    handleNext(evt) {
      evt?.stopPropagation();
      this.goToStep(this.currentStepIndex + 1);
    }

    handlePrev(evt) {
      evt?.stopPropagation();
      this.goToStep(this.currentStepIndex - 1);
    }

    handleSkip(evt) {
      evt?.stopPropagation();
      this.finish(true);
    }

    handleOverlayClick(evt) {
      if (evt.target === this.elements.overlay) {
        this.finish(true);
      }
    }

    handleKeydown(evt) {
      if (!this.active) return;
      if (evt.key === 'Escape') {
        this.finish(true);
      }
      if (evt.key === 'ArrowRight') {
        this.goToStep(this.currentStepIndex + 1);
      }
      if (evt.key === 'ArrowLeft') {
        this.goToStep(this.currentStepIndex - 1);
      }
    }

    handleResize() {
      this.repositionCurrentStep();
    }

    handleScroll() {
      this.repositionCurrentStep();
    }

    repositionCurrentStep() {
      if (!this.active || !this.currentTarget) return;
      if (!document.body.contains(this.currentTarget)) {
        this.goToStep(this.currentStepIndex);
        return;
      }
      this.positionElements(this.currentTarget, this.steps[this.currentStepIndex] || {});
    }

    finish(markSeen = true) {
      this.clearPositionTimeout();
      this.active = false;
      if (markSeen) {
        this.markSeen();
      }
      this.teardownListeners();

      if (this.elements.overlay) {
        this.elements.overlay.style.opacity = '0';
        setTimeout(() => this.teardownDom(), 200);
      } else {
        this.teardownDom();
      }
    }

    teardownDom() {
      this.elements.overlay?.remove();
      this.elements.highlight?.remove();
      this.elements.tooltip?.remove();
      this.elements = {
        overlay: null,
        highlight: null,
        tooltip: null,
        titleEl: null,
        textEl: null,
        stepLabelEl: null,
        prevBtn: null,
        nextBtn: null,
        skipBtn: null,
      };
      this.currentTarget = null;
    }
  }

  // ------------- Legacy Coach v1 (beholdt for andre sider inntil videre) -------------
  function createLegacyCoach({ steps = [], storageKey } = {}) {
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

  global.CoachEngine = CoachEngine;
  global.coach = global.coach || {};
  global.coach.create = global.coach.create || createLegacyCoach;
  global.coach.waitForCondition = waitForCondition;
})(window);
