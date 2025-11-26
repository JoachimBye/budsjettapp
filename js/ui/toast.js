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
    const isSuccess = type === 'success';
    const isError = type === 'error';

    const icon = document.createElement('span');
    icon.textContent = isSuccess ? '✅' : '';
    icon.style.display = isSuccess ? 'inline-block' : 'none';
    icon.style.fontSize = '16px';

    const text = document.createElement('span');
    text.textContent = message;

    el.appendChild(icon);
    el.appendChild(text);

    el.style.background = isSuccess
      ? 'rgba(255,255,255,0.94)'
      : isError
      ? '#dc2626'
      : '#2563eb';
    el.style.color = isSuccess ? '#1c1c1e' : '#fff';
    el.style.padding = '10px 16px';
    el.style.borderRadius = '999px';
    el.style.boxShadow = isSuccess
      ? '0 18px 45px rgba(0, 0, 0, 0.18)'
      : '0 10px 25px rgba(0,0,0,0.15)';
    el.style.fontSize = '14px';
    el.style.fontWeight = '600';
    el.style.pointerEvents = 'auto';
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s ease';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.gap = isSuccess ? '8px' : '0';
    if (isSuccess) {
      el.style.border = '1px solid rgba(76,175,80,0.18)';
    }
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
