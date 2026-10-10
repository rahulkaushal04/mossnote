// Runs before first paint. Keep it tiny and dependency-free.
(function () {
  var root = document.documentElement;
  var theme = 'system';
  var reading = 'comfortable';
  var tint = 'moss';
  try {
    theme = localStorage.getItem('moss:theme') || 'system';
    // Only names the stylesheet knows; anything else stays on the app's own moss.
    if (localStorage.getItem('moss:tint') === 'plum') tint = 'plum';
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
  root.setAttribute('data-tint', tint);
  var meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = dark ? '#141816' : '#f7f5f0';
  document.head.appendChild(meta);
})();
