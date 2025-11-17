(function (global) {
  const ROOT_ID = 'toast-root';

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.style.position = 'fixed';
      root.style.top = '20px';
      root.style.left = '50%';
      root.style.transform = 'translateX(-50%)';
      root.style.zIndex = '10000';
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.gap = '8px';
      root.style.pointerEvents = 'none';
      document.body.appendChild(root);
    }
    return root;
  }

  function createToastElement(message, type) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.background =
      type === 'error'
        ? '#dc2626'
        : type === 'success'
        ? '#16a34a'
        : '#2563eb';
    el.style.color = '#fff';
    el.style.padding = '10px 16px';
    el.style.borderRadius = '999px';
    el.style.boxShadow = '0 10px 25px rgba(0,0,0,0.15)';
    el.style.fontSize = '14px';
    el.style.fontWeight = '600';
    el.style.pointerEvents = 'auto';
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
    return el;
  }

  function show(message, { type = 'info', timeout = 3000 } = {}) {
    const root = ensureRoot();
    const toast = createToastElement(message, type);
    root.appendChild(toast);

    const remove = () => {
      toast.style.opacity = '0';
      setTimeout(() => {
        toast.remove();
        if (root.children.length === 0) {
          root.remove();
        }
      }, 200);
    };

    if (timeout > 0) {
      setTimeout(remove, timeout);
    }

    toast.addEventListener('click', remove);
  }

  global.toast = Object.freeze({
    show,
  });
})(window);
