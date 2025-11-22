(function() {
  function animateValue(el, start, end, durationMs, formatFn) {
    if (!el) return;
    let startTs = null;
    const diff = end - start;
    const format = typeof formatFn === 'function' ? formatFn : (v) => v;

    function step(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / durationMs, 1);
      const ease = 1 - (1 - progress) * (1 - progress); // easeOutQuad
      const current = Math.round(start + diff * ease);
      el.textContent = format(current);
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = format(end);
      }
    }

    window.requestAnimationFrame(step);
  }

  function animateStrokeDashoffset(el, from, to, durationMs) {
    if (!el) return;
    el.style.transition = 'none';
    el.style.strokeDashoffset = from;
    el.getBoundingClientRect();
    el.style.transition = `stroke-dashoffset ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    requestAnimationFrame(() => {
      el.style.strokeDashoffset = to;
    });
  }

  window.uiAnimate = {
    animateValue,
    animateStrokeDashoffset,
  };
})();
