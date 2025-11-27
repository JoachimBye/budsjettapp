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
      this.startDelayTimeoutId = null;
      this.repositionRafId = null;
      this.startDelayMs =
        typeof options.startDelayMs === 'number' && options.startDelayMs >= 0
          ? options.startDelayMs
          : 400;
      this.positionDelayMs =
        typeof options.positionDelayMs === 'number' && options.positionDelayMs >= 0
          ? options.positionDelayMs
          : 700;

      this.boundHandleOverlayClick = this.handleOverlayClick.bind(this);
      this.boundHandleKeydown = this.handleKeydown.bind(this);
      this.boundHandleResize = this.handleResize.bind(this);
      this.boundHandleScroll = this.handleScroll.bind(this);
      this.boundHandleNext = this.handleNext.bind(this);
      this.boundHandlePrev = this.handlePrev.bind(this);
      this.boundHandleSkip = this.handleSkip.bind(this);
      this._prevBodyOverflow = '';
    }

    startTour({ pageId, version = 1, steps = [] } = {}) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return;
      }
      if (this.active) {
        this.finish(false);
      }
      this.pageId = pageId || this.pageId;
      this.version = version;
      this.steps = steps.filter(
        (s) => s && typeof s.selector === 'string' && s.selector.trim().length > 0
      );
      if (!this.steps.length) {
        return;
      }
      this.currentStepIndex = 0;
      this.currentTarget = null;

      if (this.hasSeenCurrentVersion()) {
        return;
      }

      this.ensureDom();
      this.attachListeners();

      try {
        this._prevBodyOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
      } catch (e) {
        console.warn('CoachEngine: could not lock body scroll', e);
      }

      this.active = true;
      this.showOverlay();

      this.clearStartDelay();
      this.startDelayTimeoutId = window.setTimeout(() => {
        if (!this.active) return;
        this.goToStep(0);
      }, this.startDelayMs);
    }

    hasSeenCurrentVersion() {
      if (!this.pageId) return false;
      const state = readCoachState();
      const storedVersion = state[this.pageId]?.version || 0;
      return storedVersion >= (this.version || 0);
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
        'z-index: 9998',
        'display: none',
        'opacity: 0',
        'transition: opacity 0.25s ease',
        'pointer-events: auto',
        'overflow: visible',
        'background: transparent',
      ].join(';');

      const highlight = document.createElement('div');
      highlight.id = 'coachHighlight';
      highlight.className = 'coach-v2-highlight';
      highlight.style.cssText = [
        'position: absolute',
        'border-radius: 14px',
        'box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55)',
        'z-index: 9999',
        'pointer-events: none',
        'transition: all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'opacity: 0',
        'background: transparent',
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
        'padding: 18px 20px 16px',
        'color: #111827',
        'opacity: 0',
        'display: flex',
        'flex-direction: column',
        'gap: 14px',
        'z-index: 10000',
        'transition: opacity 0.25s ease',
        'visibility: hidden',
      ].join(';');

      const body = document.createElement('div');
      body.className = 'coach-body';
      body.style.cssText = ['display: flex', 'flex-direction: column', 'gap: 8px'].join(';');

      const stepLabelEl = document.createElement('div');
      stepLabelEl.id = 'coachStepLabel';
      stepLabelEl.className = 'coach-step-label';
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
      titleEl.className = 'coach-title';
      titleEl.style.cssText = [
        'margin: 0',
        'font-size: 18px',
        'font-weight: 800',
        'color: #0f172a',
      ].join(';');

      const textEl = document.createElement('p');
      textEl.id = 'coachText';
      textEl.className = 'coach-text';
      textEl.style.cssText = [
        'margin: 4px 0 0',
        'font-size: 15px',
        'line-height: 1.6',
        'color: #4b5563',
      ].join(';');

      body.appendChild(stepLabelEl);
      body.appendChild(titleEl);
      body.appendChild(textEl);

      const footer = document.createElement('div');
      footer.className = 'coach-footer';
      footer.style.cssText = [
        'display: flex',
        'align-items: center',
        'gap: 10px',
        'margin-top: 4px',
        'flex-wrap: wrap',
      ].join(';');

      const skipBtn = this.buildButton('Hopp over', 'ghost');
      skipBtn.id = 'coachSkipBtn';
      const spacer = document.createElement('div');
      spacer.className = 'coach-footer-spacer';
      spacer.style.cssText = ['flex: 1 1 auto', 'min-width: 8px'].join(';');
      const prevBtn = this.buildButton('Forrige', 'secondary');
      prevBtn.id = 'coachPrevBtn';
      const nextBtn = this.buildButton('Neste', 'primary');
      nextBtn.id = 'coachNextBtn';

      footer.appendChild(skipBtn);
      footer.appendChild(spacer);
      footer.appendChild(prevBtn);
      footer.appendChild(nextBtn);

      tooltip.appendChild(body);
      tooltip.appendChild(footer);

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
        'display: inline-flex',
        'align-items: center',
        'justify-content: center',
        'min-height: 38px',
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

    clearStartDelay() {
      if (this.startDelayTimeoutId) {
        clearTimeout(this.startDelayTimeoutId);
        this.startDelayTimeoutId = null;
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
      this.currentTarget = null;

      const step = this.steps[index];
      if (!step) {
        this.finish(false);
        return;
      }

      // Empty tooltip while we wait to avoid stale content flashes
      if (this.elements.tooltip) {
        this.elements.tooltip.style.visibility = 'hidden';
        this.elements.tooltip.style.opacity = '0';
      }
      if (this.elements.highlight) {
        this.elements.highlight.style.opacity = '0';
      }

      if (typeof step.waitCondition === 'function') {
        const ok = await waitForCondition(step.waitCondition, 3000, 130);
        if (!ok) {
          console.warn('CoachEngine: waitCondition timeout for step', step.id || index);
          this.goToStep(index + 1);
          return;
        }
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
        this.goToStep(index + 1);
        return;
      }

      this.currentTarget = target;
      this.updateTooltipContent(step);
      this.updateButtons();

      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch (e) {
        console.warn('CoachEngine: scrollIntoView failed', e);
      }

      const scheduledStep = this.currentStepIndex;
      this.clearPositionTimeout();
      this.positionTimeoutId = window.setTimeout(() => {
        if (!this.active || scheduledStep !== this.currentStepIndex) return;
        this.positionElements(target, step);
      }, this.positionDelayMs);
    }

    next() {
      this.goToStep(this.currentStepIndex + 1);
    }

    prev() {
      this.goToStep(this.currentStepIndex - 1);
    }

    skip() {
      this.finish(true);
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

      const padding = 8;
      const rect = target.getBoundingClientRect();
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

      const hLeft = rect.left + scrollX - padding;
      const hTop = rect.top + scrollY - padding;
      const hWidth = rect.width + padding * 2;
      const hHeight = rect.height + padding * 2;

      this.elements.highlight.style.width = `${hWidth}px`;
      this.elements.highlight.style.height = `${hHeight}px`;
      this.elements.highlight.style.left = `${hLeft}px`;
      this.elements.highlight.style.top = `${hTop}px`;
      this.elements.highlight.style.opacity = '1';

      this.elements.tooltip.style.visibility = 'hidden';
      this.elements.tooltip.style.opacity = '0';

      requestAnimationFrame(() => {
        if (!this.active || !this.elements.tooltip || !this.elements.highlight) return;
        const ttRect = this.elements.tooltip.getBoundingClientRect();
        const placement = this.getPlacement(step, rect, ttRect);

        const viewportW = window.innerWidth || document.documentElement.clientWidth;
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const minLeft = scrollX + 12;
        const maxLeft = scrollX + viewportW - ttRect.width - 12;
        const centeredLeft = rect.left + scrollX + rect.width / 2 - ttRect.width / 2;
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, centeredLeft));

        let tooltipTop = placement === 'top'
          ? rect.top + scrollY - ttRect.height - 18
          : rect.bottom + scrollY + 18;

        const minTop = scrollY + 12;
        const maxTop = scrollY + viewportH - ttRect.height - 12;
        tooltipTop = Math.max(minTop, Math.min(maxTop, tooltipTop));

        this.elements.tooltip.style.left = `${clampedLeft}px`;
        this.elements.tooltip.style.top = `${tooltipTop}px`;
        this.elements.tooltip.style.visibility = 'visible';
        this.elements.tooltip.style.opacity = '1';
      });
    }

    getPlacement(step, rect, ttRect) {
      if (step && (step.placement === 'top' || step.placement === 'bottom')) {
        return step.placement;
      }
      const ttHeight = ttRect?.height || 0;
      const hasSpaceAbove = rect.top > ttHeight + 32;
      if (hasSpaceAbove && rect.top > 200) return 'top';
      return 'bottom';
    }

    handleNext(evt) {
      evt?.stopPropagation();
      this.next();
    }

    handlePrev(evt) {
      evt?.stopPropagation();
      this.prev();
    }

    handleSkip(evt) {
      evt?.stopPropagation();
      this.skip();
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
        this.next();
      }
      if (evt.key === 'ArrowLeft') {
        this.prev();
      }
    }

    handleResize() {
      this.repositionCurrentStep();
    }

    handleScroll() {
      this.repositionCurrentStep();
    }

    repositionCurrentStep() {
      if (this.repositionRafId) return;
      this.repositionRafId = window.requestAnimationFrame(() => {
        this.repositionRafId = null;
        if (!this.active || !this.currentTarget) return;
        if (this.positionTimeoutId) return; // let scheduled positioning finish after scroll
        if (!document.body.contains(this.currentTarget)) {
          this.goToStep(this.currentStepIndex);
          return;
        }
        this.positionElements(this.currentTarget, this.steps[this.currentStepIndex] || {});
      });
    }

    finish(markSeen = true) {
      this.clearPositionTimeout();
      this.clearStartDelay();
      if (this.repositionRafId) {
        cancelAnimationFrame(this.repositionRafId);
        this.repositionRafId = null;
      }
      this.active = false;

      try {
        document.body.style.overflow = this._prevBodyOverflow || '';
      } catch (e) {
        console.warn('CoachEngine: could not restore body scroll', e);
      }

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
