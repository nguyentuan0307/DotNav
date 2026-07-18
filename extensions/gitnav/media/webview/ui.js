(() => {
  const chevron = '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
  const back = '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="m10 3-5 5 5 5"/></svg>';
  const check = '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 3 3 7-7"/></svg>';

  function fit(panel, anchor, options = {}) {
    panel.style.left = '0';
    panel.style.top = '0';
    const gap = options.gap ?? 4;
    const margin = options.margin ?? 6;
    const panelRect = panel.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const preferredLeft = options.align === 'end'
      ? anchorRect.right - panelRect.width
      : anchorRect.left;
    const left = Math.max(margin, Math.min(preferredLeft, innerWidth - panelRect.width - margin));
    let top = anchorRect.bottom + gap;
    if (top + panelRect.height > innerHeight - margin && anchorRect.top - panelRect.height - gap >= margin) {
      top = anchorRect.top - panelRect.height - gap;
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(margin, Math.min(top, innerHeight - panelRect.height - margin))}px`;
  }

  function createOverlayManager() {
    let active;
    const close = (restoreFocus = false) => {
      if (!active) return;
      const current = active;
      active = undefined;
      current.panel.classList.remove('open');
      current.trigger?.setAttribute('aria-expanded', 'false');
      current.onClose?.();
      if (restoreFocus) current.trigger?.focus();
    };
    const open = (panel, trigger, options = {}) => {
      if (active?.panel !== panel) close(false);
      panel.classList.add('open');
      trigger?.setAttribute('aria-expanded', 'true');
      active = { panel, trigger, onClose: options.onClose };
      fit(panel, trigger, options);
      options.focus?.focus();
    };
    const toggle = (panel, trigger, options = {}) => {
      if (active?.panel === panel) close(true);
      else open(panel, trigger, options);
    };
    document.addEventListener('pointerdown', event => {
      if (!active || active.panel.contains(event.target) || active.trigger?.contains(event.target)) return;
      close(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && active) {
        event.preventDefault();
        close(true);
      }
    });
    window.addEventListener('blur', () => close(false));
    window.addEventListener('resize', () => close(false));
    return { open, close, toggle, fit, get active() { return active; } };
  }

  function navigateList(container, event) {
    const items = [...container.querySelectorAll('.ui-list-item:not([disabled])')];
    if (!items.length) return false;
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return false;
    event.preventDefault();
    items[next]?.focus();
    return true;
  }

  window.GitNavUi = Object.freeze({
    icons: Object.freeze({ chevron, back, check }),
    createOverlayManager,
    navigateList,
    fit
  });
})();
