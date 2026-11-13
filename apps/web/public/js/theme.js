(function () {
  var get = function (k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  var t = get('bm-theme', 'system');
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.accent = get('bm-accent', 'indigo');
  // Darstellung V2 schon vor dem ersten Bild, sonst blitzt V1 auf; das eigene Bild folgt nach der Anmeldung (app.js)
  var ui = get('bm-ui', null);
  var root = document.documentElement;
  // Designs V3 und V4: Navigation oben und eigene Farben (theme-v3.css); V4 bringt zusätzlich das Glas von V2 mit
  if (ui && ui.look) {
    root.dataset.look = ui.look;
    root.dataset.shell = 'top';
  }
  if (ui && ui.bg) {
    root.dataset.ui = 'v2';
    root.dataset.bg = ui.bg === 'custom' ? 'none' : ui.bg;
    root.style.setProperty('--v2-blur', ui.blur + 'px');
    root.style.setProperty('--v2-alpha', String(ui.opacity / 100));
    root.style.setProperty('--v2-dim', String(ui.dim / 100));
    if (ui.lite) root.setAttribute('data-ui-lite', '');
  }
})();
