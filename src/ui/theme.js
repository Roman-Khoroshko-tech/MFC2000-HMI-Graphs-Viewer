(() => {
  const root = document.documentElement;
  const key = 'rk-theme';
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let selected;

  try {
    selected = localStorage.getItem(key);
  } catch {
    // Storage can be disabled, particularly for local files.
  }

  function render() {
    const theme = ['light', 'dark'].includes(selected) ? selected : preference.matches ? 'dark' : 'light';
    root.dataset.theme = theme;
    document.querySelectorAll('[data-et-theme]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  render();
  document.addEventListener('DOMContentLoaded', render);
  preference.addEventListener('change', render);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      selected = event.newValue;
      render();
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-et-theme]')) return;
    selected = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(key, selected);
    } catch {
      // The current page still retains the selection.
    }
    render();
  });
})();

