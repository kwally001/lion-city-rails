/* Lion City Rails: board rendering (SVG), pan and zoom. */
(function (g) {
'use strict';
const M = MAPDATA, E = Engine;
const W = M.W, H = M.H;
const NS = 'http://www.w3.org/2000/svg';
const LINES = [
  { code: 'NS', name: 'North-South Line' }, { code: 'EW', name: 'East-West Line' },
  { code: 'NE', name: 'North East Line' }, { code: 'CC', name: 'Circle Line' },
  { code: 'DT', name: 'Downtown Line' }, { code: 'TE', name: 'Thomson-East Coast Line' },
  { code: 'JR', name: 'Jurong Region Line' }, { code: 'LRT', name: 'LRT' }
];
const GL = [
  '<circle r="3.8"/>',
  '<path d="M0-4.6L4.4 3.2-4.4 3.2Z"/>',
  '<rect x="-3.5" y="-3.5" width="7" height="7"/>',
  '<path d="M0-4.8L4.8 0 0 4.8-4.8 0Z"/>',
  '<path d="M-1.4-4.6h2.8v3.2h3.2v2.8h-3.2v3.2h-2.8v-3.2h-3.2v-2.8h3.2z"/>',
  '<path d="M-1.4-4.6h2.8v3.2h3.2v2.8h-3.2v3.2h-2.8v-3.2h-3.2v-2.8h3.2z" transform="rotate(45)"/>',
  '<circle r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  '<rect x="-4.6" y="-1.5" width="9.2" height="3"/>'
];
const STAR = '<path d="M0-5.8L1.7-1.7 5.8 0 1.7 1.7 0 5.8-1.7 1.7-5.8 0-1.7-1.7Z"/>';
const glyphSVG = ci => '<svg class="gl" viewBox="-6 -6 12 12" aria-hidden="true">' + (ci === 8 ? STAR : GL[ci]) + '</svg>';

const svg = document.getElementById('map');
let geom = [], handlers = {}, routeEls = [], nodeEls = {}, flagEls = {};
let view = { x: 0, y: 0, w: W, h: H };
let moved = false, ignoreClickUntil = 0;

const NR = n => n.tags.indexOf('key') >= 0 ? 15 : 10.5;
const f1 = v => Math.round(v * 10) / 10;

function splitName(n) {
  if (n.length <= 13 || n.indexOf(' ') < 0) return [n];
  const mid = n.length / 2; let best = -1, bd = 99;
  for (let i = 0; i < n.length; i++) if (n[i] === ' ' && Math.abs(i - mid) < bd) { bd = Math.abs(i - mid); best = i; }
  return [n.slice(0, best), n.slice(best + 1)];
}

function buildRoutes() {
  let out = '';
  M.routes.forEach((r, i) => {
    const a = E.NODES[r.a], b = E.NODES[r.b];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const gap = r.lanes === 2 ? 11 : 0, off = (r.lane - (r.lanes - 1) / 2) * gap;
    const sA = NR(a) + 5, sB = NR(b) + 5, seg = L - sA - sB, cl = seg / r.len;
    const w = Math.max(12, cl - 4.5), h = r.lanes === 2 ? 9.5 : 11.5;
    const x1 = a.x + ux * sA + nx * off, y1 = a.y + uy * sA + ny * off;
    const x2 = b.x - ux * sB + nx * off, y2 = b.y - uy * sB + ny * off;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const cars = [];
    for (let k = 0; k < r.len; k++) { const t = (k + 0.5) * cl; cars.push({ cx: f1(x1 + ux * t), cy: f1(y1 + uy * t) }); }
    const mid = Math.floor(r.len / 2);
    geom[i] = { x1, y1, x2, y2, cars, mid, ang, w, h };
    const ci = r.color === 'grey' ? -1 : M.colors.indexOf(r.color);
    const ferry = r.flags === 'F1';
    let s = `<g class="route${ferry ? ' ferry' : ''}" data-ri="${i}" data-color="${r.color}" tabindex="0" role="button" aria-label="${esc(a.name)} to ${esc(b.name)}, ${r.len} cars, ${r.color === 'grey' ? 'any colour' : LINES[ci].name}${ferry ? ', needs an Express card' : ''}">`;
    s += `<path class="hit" d="M${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}"/>`;
    cars.forEach((c, k) => { s += `<rect class="car" x="${-w / 2}" y="${-h / 2}" width="${f1(w)}" height="${h}" rx="3" transform="translate(${c.cx} ${c.cy}) rotate(${f1(ang)})"/>`; });
    if (ferry) s += `<g class="mark wildmark" transform="translate(${cars[0].cx} ${cars[0].cy})">${STAR}</g>`;
    s += `<text class="seat" x="${cars[mid].cx}" y="${cars[mid].cy}" text-anchor="middle" dominant-baseline="central"></text>`;
    s += '</g>';
    out += s;
  });
  return out;
}
function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function labelFor(n) {
  const r = NR(n);
  const lines = splitName(n.name).map(t => ({ t, c: 'nm' }));
  if (n.sub) lines.push({ t: n.sub, c: 'sub' });
  const lh = 13.5, cnt = lines.length; let x = n.x, y = n.y, anchor = 'middle', y0;
  if (n.lp === 'n') y0 = n.y - r - 8 - (cnt - 1) * lh;
  else if (n.lp === 's') y0 = n.y + r + 15;
  else if (n.lp.length === 2) {
    const up = n.lp[0] === 'n', right = n.lp[1] === 'e';
    y0 = up ? n.y - r + 1 - (cnt - 1) * lh - 4 : n.y + r + 11;
    x = n.x + (right ? r + 2 : -(r + 2)); anchor = right ? 'start' : 'end';
  }
  else { y0 = n.y - (cnt - 1) * lh / 2 + 4; if (n.lp === 'e') { x = n.x + r + 8; anchor = 'start'; } else { x = n.x - r - 8; anchor = 'end'; } }
  let s = `<text class="lbl" data-id="${n.id}" text-anchor="${anchor}">`;
  lines.forEach((l, k) => { s += `<tspan class="${l.c}" x="${f1(x)}" y="${f1(y0 + k * lh)}">${esc(l.t)}</tspan>`; });
  return s + '</text>';
}

function build() {
  let s = Scenery.base(M.terrain, W, H);
  s += Scenery.landmarks();
  s += Scenery.labels();
  s += '<g class="routes">' + buildRoutes() + '</g>';
  s += '<g class="nodes">';
  M.nodes.forEach(n => {
    const key = n.tags.indexOf('key') >= 0, cus = n.tags.indexOf('custom') >= 0, r = NR(n);
    s += `<g class="node${key ? ' key' : ''}${cus ? ' custom' : ''}" data-id="${n.id}" transform="translate(${n.x} ${n.y})">`;
    s += `<circle class="flag" r="${r + 7}"/>`;
    s += `<circle class="ring" r="${r}"/>`;
    if (cus) s += '<circle class="core" r="3.6"/>';
    s += '</g>';
  });
  s += '</g><g class="labels">' + M.nodes.map(labelFor).join('') + '</g>';
  svg.innerHTML = s;
  routeEls = Array.from(svg.querySelectorAll('.route'));
  svg.querySelectorAll('.node').forEach(el => { nodeEls[el.dataset.id] = el; });
}

/* ---------- pan / zoom ---------- */
function applyView() { svg.setAttribute('viewBox', `${f1(view.x)} ${f1(view.y)} ${f1(view.w)} ${f1(view.h)}`); }
const asp = () => { const r = svg.getBoundingClientRect(); return r.width > 0 ? r.height / r.width : H / W; };
const maxW = () => Math.max(W, H / asp());
function clampView() {
  view.w = Math.min(maxW(), Math.max(W / 6, view.w)); view.h = view.w * asp();
  view.x = view.w >= W ? (W - view.w) / 2 : Math.max(0, Math.min(W - view.w, view.x));
  view.y = view.h >= H ? (H - view.h) / 2 : Math.max(0, Math.min(H - view.h, view.y));
}
function toSvg(cx, cy) { const r = svg.getBoundingClientRect(); return { x: view.x + (cx - r.left) / r.width * view.w, y: view.y + (cy - r.top) / r.height * view.h }; }
function zoomAt(px, py, f) {
  const nw = Math.min(maxW(), Math.max(W / 6, view.w * f)), k = nw / view.w;
  view.x = px - (px - view.x) * k; view.y = py - (py - view.y) * k; view.w = nw; view.h = nw * asp(); clampView(); applyView();
}
function zoomBtn(f) { zoomAt(view.x + view.w / 2, view.y + view.h / 2, f); }
function fit() {
  const narrow = svg.getBoundingClientRect().width < 700;
  if (narrow) { view.w = W * 0.62; view.h = view.w * asp(); view.x = W * 0.5 - view.w / 2 + 40; view.y = H * 0.52 - view.h / 2; }
  else { view.w = maxW(); view.h = view.w * asp(); view.x = (W - view.w) / 2; view.y = (H - view.h) / 2; }
  clampView(); applyView();
}
const ptrs = new Map(); let drag = null, pinch = null;
svg.addEventListener('pointerdown', e => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = false;
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; }
});
svg.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    const c = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
    const target = Math.min(maxW(), Math.max(W / 6, pinch.w * pinch.d / Math.max(d, 1)));
    zoomAt(c.x, c.y, target / view.w); moved = true; return;
  }
  if (drag && ptrs.size === 1) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) > 6) { moved = true; try { svg.setPointerCapture(e.pointerId); } catch (er) {} }
    if (moved) {
      const r = svg.getBoundingClientRect();
      view.x = drag.vx - dx * view.w / r.width; view.y = drag.vy - dy * view.h / r.height; clampView(); applyView();
    }
  }
});
function endPtr(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) { drag = null; if (moved) ignoreClickUntil = Date.now() + 80; }
  if (ptrs.size === 1) { const p = [...ptrs.values()][0]; drag = { x: p.x, y: p.y, vx: view.x, vy: view.y }; }
}
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', endPtr);
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const p = toSvg(e.clientX, e.clientY);
  zoomAt(p.x, p.y, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
}, { passive: false });
svg.addEventListener('click', e => {
  if (Date.now() < ignoreClickUntil) return;
  const r = e.target.closest('.route');
  if (r && handlers.onRoute) handlers.onRoute(+r.dataset.ri);
});
svg.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('route')) { e.preventDefault(); handlers.onRoute && handlers.onRoute(+e.target.dataset.ri); }
});
function hoverTarget(e) { const r = e.target.closest && e.target.closest('.route'); return r ? +r.dataset.ri : null; }
svg.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') { const ri = hoverTarget(e); if (handlers.onHover) handlers.onHover(ri); } });
svg.addEventListener('pointerleave', () => { handlers.onHover && handlers.onHover(null); });
svg.addEventListener('focusin', e => { const ri = hoverTarget(e); if (ri != null && handlers.onHover) handlers.onHover(ri); });
svg.addEventListener('focusout', () => { handlers.onHover && handlers.onHover(null); });

/* ---------- state paint ---------- */
function update(s, ctx) {
  ctx = ctx || {};
  routeEls.forEach((el, i) => {
    const o = s ? s.routes[i] : -1, c = el.classList;
    c.toggle('owned', o >= 0);
    c.toggle('can', !!(ctx.can && ctx.can.has(i)));
    c.toggle('sel', ctx.sel === i);
    c.toggle('last', ctx.last === i);
    c.toggle('hlp', !!(ctx.hlEdges && ctx.hlEdges.has(i)));
    c.toggle('dim', !!(ctx.sel != null && ctx.sel !== i));
    if (o >= 0) {
      el.style.setProperty('--pc', `var(--p${o + 1})`); el.style.setProperty('--pt', `var(--pt${o + 1})`);
      el.querySelector('.seat').textContent = o + 1;
    } else { el.style.removeProperty('--pc'); el.style.removeProperty('--pt'); el.querySelector('.seat').textContent = ''; }
    const r = M.routes[i], ci = r.color === 'grey' ? -1 : M.colors.indexOf(r.color);
    el.style.setProperty('--rc', ci >= 0 ? `var(--c-${r.color})` : 'var(--grey-line)');
  });
  Object.keys(nodeEls).forEach(id => {
    nodeEls[id].classList.toggle('tk', !!(ctx.tkNodes && ctx.tkNodes.has(id)));
    nodeEls[id].classList.toggle('hl', !!(ctx.hlNodes && ctx.hlNodes.has(id)));
  });
}
function focusOn(ids) {
  const pts = ids.map(id => E.NODES[id]).filter(Boolean); if (!pts.length) return;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const need = Math.max((Math.max(...xs) - Math.min(...xs)) + 260, ((Math.max(...ys) - Math.min(...ys)) + 200) * W / H);
  view.w = Math.min(maxW(), Math.max(W * 0.45, need)); view.h = view.w * asp(); view.x = cx - view.w / 2; view.y = cy - view.h / 2; clampView(); applyView();
}

function init(h) { handlers = h || {}; build(); fit(); window.addEventListener('resize', () => { clampView(); applyView(); }); }
g.MapView = { init, update, zoomBtn, fit, focusOn, glyphSVG, LINES, esc };
})(typeof globalThis !== 'undefined' ? globalThis : window);
