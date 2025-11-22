(function() {
  function easeOutExpo(x) {
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  }

  function animateValue(el, start, end, durationMs, formatFn) {
    if (!el) return;
    const format = typeof formatFn === 'function' ? formatFn : (v) => Math.round(v);

    if (start === end) {
      el.textContent = format(end);
      return;
    }

    let startTs = null;
    const diff = end - start;

    function step(ts) {
      if (!startTs) startTs = ts;
      const progress = durationMs > 0 ? Math.min((ts - startTs) / durationMs, 1) : 1;
      const eased = easeOutExpo(progress);
      const current = start + diff * eased;
      el.textContent = format(current);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = format(end);
      }
    }

    window.requestAnimationFrame(step);
  }

  window.uiAnimate = {
    animateValue,
  };
})();
