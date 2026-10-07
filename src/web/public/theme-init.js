// Runs before first paint (spec section 24). Keep it tiny and dependency-free.
(function () {
  var root = document.documentElement;
  var theme = 'system';
  var reading = 'comfortable';
  try {
    theme = localStorage.getItem('moss:theme') || 'system';
    var ui = JSON.parse(localStorage.getItem('moss:ui') || '{}');
    if (ui && ui.readingSize === 'large') reading = 'large';
  } catch {
    // Storage unavailable: fall back to the system theme.
  }
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-reading', reading);
})();
