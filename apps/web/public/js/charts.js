let uid = 0;

function smooth(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const niceMax = v => {
  const raw = v / 4, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 7.5, 10].find(s => s * mag >= raw) * mag * 4;
};

/* Mehrreihiges Flächen-/Liniendiagramm mit Hover-Tooltip */
export function areaChart(el, { labels, series, format = v => v, height = 260 }) {
  const id = 'a' + uid++;
  const W = el.clientWidth || 600, H = height;
  const pad = { l: 46, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(...series.flatMap(s => s.data))) || 1;
  const n = labels.length;
  const x = i => pad.l + i * (W - pad.l - pad.r) / (n - 1);
  const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / max);

  const ticks = [0, 1, 2, 3, 4].map(t => max / 4 * t);
  const grid = ticks.map(t => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${format(t)}</text>`).join('');
  const xl = labels.map((l, i) => `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${l}</text>`).join('');

  const defs = series.map((s, k) => `<linearGradient id="${id}g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.35"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient>`).join('');
  const paths = series.map((s, k) => {
    const pts = s.data.map((v, i) => [x(i), y(v)]);
    const line = smooth(pts);
    return `<path d="${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${id}g${k})"/><path d="${line}" fill="none" style="stroke:${s.color}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join('');

  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${grid}${xl}${paths}
    <line id="${id}v" y1="${pad.t}" y2="${H - pad.b}" style="stroke:var(--muted)" stroke-dasharray="3 3" opacity="0"/>
    ${series.map((s, k) => `<circle id="${id}c${k}" r="5" style="fill:var(--surface);stroke:${s.color}" stroke-width="2.5" opacity="0"/>`).join('')}
    <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" id="${id}r"/></svg><div class="chart-tip" id="${id}t"></div>`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), vline = svg.querySelector(`#${id}v`);
  const circles = series.map((_, k) => svg.querySelector(`#${id}c${k}`));
  const show = on => { tip.style.opacity = vline.style.opacity = on ? 1 : 0; circles.forEach(c => c.style.opacity = on ? 1 : 0); };
  svg.querySelector(`#${id}r`).addEventListener('mousemove', e => {
    const box = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - box.left - pad.l) / ((W - pad.l - pad.r) / (n - 1)))));
    vline.setAttribute('x1', x(i)); vline.setAttribute('x2', x(i));
    series.forEach((s, k) => { circles[k].setAttribute('cx', x(i)); circles[k].setAttribute('cy', y(s.data[i])); });
    tip.innerHTML = `<b>${labels[i]}</b>${series.map(s => `<div><span style="color:${s.color}">●</span> ${s.name}: ${format(s.data[i], true)}</div>`).join('')}`;
    tip.style.left = x(i) + 'px';
    tip.style.top = Math.min(...series.map(s => y(s.data[i]))) + 'px';
    show(true);
  });
  svg.addEventListener('mouseleave', () => show(false));
}

/* Donut mit Hover-Fokus und Legende */
export function donut(el, { items, format = v => v }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const R = 70, C = 2 * Math.PI * R, gap = 3;
  let acc = 0;
  const segs = items.map((it, i) => {
    const len = it.value / total * C;
    const s = `<circle class="seg" data-i="${i}" cx="90" cy="90" r="${R}" fill="none" style="stroke:${it.color};transition:stroke-width .15s" stroke-width="20" stroke-dasharray="${Math.max(len - gap, 0)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 90 90)" stroke-linecap="round"/>`;
    acc += len;
    return s;
  }).join('');
  el.innerHTML = `<div class="donut-wrap"><svg width="180" height="180" viewBox="0 0 180 180">${segs}
    <text id="dv" x="90" y="88" text-anchor="middle" style="fill:var(--text);font-size:20px;font-weight:700">${format(total)}</text>
    <text id="dl" x="90" y="108" text-anchor="middle" class="axis">Gesamt</text></svg>
    <div class="donut-legend">${items.map((it, i) => `<div class="item" data-i="${i}" style="--c:${it.color}"><i></i><span>${it.name}</span><span>${Math.round(it.value / total * 100)} %</span></div>`).join('')}</div></div>`;
  const dv = el.querySelector('#dv'), dl = el.querySelector('#dl');
  const focus = i => {
    el.querySelectorAll('.seg').forEach(c => { c.setAttribute('stroke-width', i == null ? 20 : (+c.dataset.i === i ? 26 : 16)); c.style.opacity = i == null || +c.dataset.i === i ? 1 : .45; });
    dv.textContent = format(i == null ? total : items[i].value);
    dl.textContent = i == null ? 'Gesamt' : items[i].name;
  };
  el.querySelectorAll('[data-i]').forEach(n => { n.addEventListener('mouseenter', () => focus(+n.dataset.i)); n.addEventListener('mouseleave', () => focus(null)); });
}

/* Radiale Auslastung */
export function gauge(el, { value, color }) {
  const R = 44, C = 2 * Math.PI * R, v = Math.min(value, 100);
  const col = color || (value >= 100 ? 'var(--bad)' : value >= 85 ? 'var(--warn)' : 'var(--ok)');
  el.innerHTML = `<svg width="112" height="112" viewBox="0 0 112 112"><circle cx="56" cy="56" r="${R}" fill="none" style="stroke:var(--surface-2)" stroke-width="11"/>
    <circle cx="56" cy="56" r="${R}" fill="none" style="stroke:${col};transition:stroke-dashoffset .8s ease" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 56 56)"/>
    <text x="56" y="62" text-anchor="middle" style="fill:var(--text);font-size:20px;font-weight:700">${value}%</text></svg>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('circle:nth-child(2)').setAttribute('stroke-dashoffset', C * (1 - v / 100))));
}

/* Mini-Verlauf für KPI-Karten */
export function sparkline(el, { data, color = 'var(--primary)' }) {
  const id = 's' + uid++, W = el.clientWidth || 200, H = 44;
  const lo = Math.min(...data), hi = Math.max(...data);
  const pts = data.map((v, i) => [i * W / (data.length - 1), H - 4 - (v - lo) / ((hi - lo) || 1) * (H - 12)]);
  const line = smooth(pts);
  el.innerHTML = `<svg width="${W}" height="${H}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.3"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>
    <path d="${line} L${W},${H} L0,${H} Z" fill="url(#${id})"/><path d="${line}" fill="none" style="stroke:${color}" stroke-width="2" stroke-linecap="round"/></svg>`;
}
