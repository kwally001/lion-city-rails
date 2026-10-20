/* Lion City Rails: painted scenery. Everything on the board that is not a station or a route lives here:
   sea, shores, land, forests, trees, ships and the landmark drawings, all in one cartoon-map style. */
(function (g) {
'use strict';
const OL = 'currentColor';
const f1 = v => Math.round(v * 10) / 10;

/* ---------- reusable bits ---------- */
const DEFS = `<defs>
<g id="t0"><ellipse cx=".7" cy="1.9" rx="4.6" ry="1.4" class="tsh"/><rect x="-.9" y="-2.6" width="1.8" height="4.6" rx=".5" class="ttk"/><circle cx="0" cy="-5.4" r="5.2" class="tcr"/><circle cx="-1.8" cy="-6.9" r="1.9" class="thl"/></g>
<g id="t1"><ellipse cx=".7" cy="1.9" rx="4.2" ry="1.3" class="tsh"/><rect x="-.8" y="-1.8" width="1.6" height="3.6" class="ttk"/><path d="M0-15 4.8-6.4H-4.8Z" class="tcr"/><path d="M0-10.4 6-1.4H-6Z" class="tcr"/><path d="M-1.5-9.8 0-12.6" class="thlp"/></g>
<g id="t2"><ellipse cx="1" cy="1.9" rx="4" ry="1.2" class="tsh"/><path d="M0 2C.4-3 1.8-7 3.2-10.4" class="ptk"/><g class="pfr"><path d="M3.2-10.4C-.6-15.6-6.6-14-9-8.6 -5-11.4-1-11.2 3.2-10.4Z"/><path d="M3.2-10.4C6.6-16.4 12.6-14.6 14.4-9 10.6-11.6 6.8-11.4 3.2-10.4Z"/><path d="M3.2-10.4C1.6-17.4 6-18.6 7-13.6 5.8-12.2 4.4-11.2 3.2-10.4Z"/><path d="M3.2-10.4C-3-10.4-7.4-7-8-3.4-5-6.6-1.4-8.6 3.2-10.4Z"/><path d="M3.2-10.4C8-9.6 12-6.6 12.6-3 9.6-6 6.4-8 3.2-10.4Z"/></g></g>
<path id="wv" d="M-9 0q2.3-4.4 4.5 0t4.5 0 4.5 0 4.5 0"/>
<g id="shipC"><path d="M-34 6Q-46 5-60 9" class="wake"/><path d="M-30 7Q-40 7-50 12" class="wake"/><path d="M-19 1H19L14.5 7.4H-14.5Z" fill="#2d4466" stroke="${OL}" stroke-width="1.2" stroke-linejoin="round"/><rect x="-16" y="-3.6" width="6" height="4.6" fill="#e2573b" stroke="${OL}" stroke-width=".8"/><rect x="-10" y="-3.6" width="6" height="4.6" fill="#f3b836" stroke="${OL}" stroke-width=".8"/><rect x="-4" y="-3.6" width="6" height="4.6" fill="#3a8fd0" stroke="${OL}" stroke-width=".8"/><rect x="-13" y="-8.2" width="6" height="4.6" fill="#45a85a" stroke="${OL}" stroke-width=".8"/><rect x="-7" y="-8.2" width="6" height="4.6" fill="#e2573b" stroke="${OL}" stroke-width=".8"/><rect x="8" y="-7" width="7" height="8" fill="#f4f1e8" stroke="${OL}" stroke-width="1"/><rect x="9.6" y="-5.4" width="4" height="2" fill="#4a7aa8"/></g>
<g id="shipT"><path d="M-32 6Q-44 5-58 9" class="wake"/><path d="M-20 1.4H20L15 7.6H-15Z" fill="#8e3b2f" stroke="${OL}" stroke-width="1.2" stroke-linejoin="round"/><rect x="-18" y="-2" width="26" height="3.4" fill="#aab4b8" stroke="${OL}" stroke-width=".9"/><path d="M-14-2V-4.6M-6-2V-4.6M2-2V-4.6" stroke="${OL}" stroke-width="1"/><rect x="9" y="-7" width="7" height="8.4" fill="#f4f1e8" stroke="${OL}" stroke-width="1"/></g>
<g id="shipS"><path d="M-18 4Q-26 3-34 6" class="wake"/><path d="M-9 3H9L6 7H-6Z" fill="#c9893f" stroke="${OL}" stroke-width="1.1" stroke-linejoin="round"/><path d="M0 2V-14" stroke="${OL}" stroke-width="1.2"/><path d="M1-13 8 1H1Z" fill="#fff" stroke="${OL}" stroke-width="1"/><path d="M-1-10-7 1H-1Z" fill="#f4e6c6" stroke="${OL}" stroke-width="1"/></g>
</defs>`;

const SHIPS = [
  { id: 'shipC', x: 560, y: 768, r: -4, s: 1 }, { id: 'shipT', x: 905, y: 742, r: -18, s: 1 },
  { id: 'shipC', x: 1010, y: 640, r: 160, s: .95 }, { id: 'shipS', x: 168, y: 640, r: 0, s: 1.05 },
  { id: 'shipT', x: 1170, y: 520, r: -70, s: .95 }, { id: 'shipS', x: 905, y: 612, r: 0, s: .9 },
  { id: 'shipC', x: 210, y: 755, r: 8, s: .9 }
];

/* ---------- landmark drawings (local coordinates, drawn on the terrain so they read as part of the map) ---------- */
const mug = () => `<path d="M11-6h6a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5h-6" fill="none" stroke="${OL}" stroke-width="6.4" stroke-linecap="round"/>`
  + '<path d="M11-6h6a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5h-6" fill="none" stroke="#d8e6ee" stroke-width="3" stroke-linecap="round"/>'
  + `<path d="M-12.5-12h25L11 19.4a3 3 0 0 1-3 2.7H-8a3 3 0 0 1-3-2.7Z" fill="#f5a912" stroke="${OL}" stroke-width="1.8" stroke-linejoin="round"/>`
  + '<path d="M-6.5-5V16M-.5-5V17M5.5-5V16" stroke="#ffd25e" stroke-width="2.2" stroke-linecap="round" opacity=".9"/>'
  + '<circle cx="-3" cy="9" r="1.2" fill="#ffeaa8"/><circle cx="3" cy="13" r="1" fill="#ffeaa8"/><circle cx="-7.4" cy="14" r=".9" fill="#ffeaa8"/><circle cx="2" cy="3" r=".9" fill="#ffeaa8"/>'
  + `<g fill="none" stroke="${OL}" stroke-width="3.6" stroke-linejoin="round"><circle cx="-8.5" cy="-13" r="5.2"/><circle cx="-2" cy="-17.6" r="6"/><circle cx="6.4" cy="-15.8" r="5.6"/><circle cx="11.6" cy="-10.8" r="4"/><rect x="-13" y="-14" width="26" height="6.4" rx="2.4"/></g>`
  + '<g fill="#fff"><circle cx="-8.5" cy="-13" r="5.2"/><circle cx="-2" cy="-17.6" r="6"/><circle cx="6.4" cy="-15.8" r="5.6"/><circle cx="11.6" cy="-10.8" r="4"/><rect x="-13" y="-14" width="26" height="6.4" rx="2.4"/></g>';

const fig = (x, y, shirt, shorts, dir, k) => `<g transform="translate(${x} ${y})${dir < 0 ? ' scale(-1 1)' : ''}${k ? ' scale(' + k + ')' : ''}">`
  + '<path d="M-1.4 4.6-2.8 9.4M1.4 4.6 3.6 8.6" stroke="#f0c7a0" stroke-width="1.7" stroke-linecap="round"/>'
  + '<path d="M-3 .2-5 3.4M3 .2 5 3" stroke="#f0c7a0" stroke-width="1.3" stroke-linecap="round"/>'
  + `<rect x="-2.7" y="-1.4" width="5.4" height="6" rx="1.4" fill="${shirt}" stroke="${OL}" stroke-width=".9"/>`
  + `<rect x="-2.7" y="3.4" width="5.4" height="2.6" rx="1" fill="${shorts}" stroke="${OL}" stroke-width=".7"/>`
  + `<circle cy="-4.2" r="2.3" fill="#f0c7a0" stroke="${OL}" stroke-width=".9"/></g>`;

const PLANE_BODY = 'M0-29C3.2-27 4.2-18 4.2-9V16l-.8 5 5.8 5.4v3.2L0 27.6l-9.2 2v-3.2L-3.4 21l-.8-5V-9C-4.2-18-3.2-27 0-29Z';
const PLANE_WINGS = 'M4-6 29 11.5v6L4 9.5ZM-4-6-29 11.5v6L-4 9.5Z';

const ART = {
  /* Ang Mo Kio: a beer garden on a grassy patch */
  beer: () => '<path d="M-35 6C-39-9-18-21 0-20S35-13 36 3 25 21 2 21-31 19-35 6Z" class="patch"/>'
    + '<path d="M-24 15 -22 11M-18 17-16 13M20 17 22 13M26 12 28 8M-30 4-28 0" class="tuft"/>'
    + '<ellipse cx="0" cy="16" rx="22" ry="5" class="gsh"/>'
    + '<path d="M-14 9l-3.4 9M14 9l3.4 9" stroke="#7a4f2a" stroke-width="2.6" stroke-linecap="round"/>'
    + `<ellipse cx="0" cy="7" rx="23" ry="7.6" fill="#c58f55" stroke="${OL}" stroke-width="1.5"/><ellipse cx="0" cy="6" rx="18" ry="4.8" fill="#d8a96f"/>`
    + `<g transform="translate(-4 -9) scale(.8)">${mug()}</g><g transform="translate(14 3) rotate(12) scale(.46)">${mug()}</g>`
    + '<use href="#t0" transform="translate(-27 -9) scale(1.1)"/><use href="#t1" transform="translate(30 -7) scale(1.05)"/>',

  /* Changi: an airliner lifting off over the water, with its shadow and a dotted climb-out */
  plane: rot => { const r = rot * Math.PI / 180, bx = -Math.sin(r), by = Math.cos(r), px = by, py = -bx, P = (d, o) => `${f1(bx * d + px * o)} ${f1(by * d + py * o)}`;
    return `<path d="M${P(32, 0)}Q${P(60, -9)} ${P(84, 0)}T${P(130, 4)}" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-dasharray=".1 6.5" opacity=".9"/>`
    + `<g transform="translate(10 15) rotate(${rot})" fill="rgba(6,38,58,.26)"><path d="${PLANE_WINGS}"/><path d="${PLANE_BODY}"/></g>`
    + `<g transform="rotate(${rot})" stroke="#12306b" stroke-width="1.3" stroke-linejoin="round">`
    + `<path d="${PLANE_WINGS}" fill="#e3e9ef"/>`
    + '<path d="M24.6 9.6 29 11.5v6l-6.4-2.2ZM-24.6 9.6-29 11.5v6l6.4-2.2Z" fill="#12306b"/>'
    + `<path d="${PLANE_BODY}" fill="#f4f7fa"/>`
    + '<path d="M3.7 19.6 9.2 26.4v3.2L0 27.6l-9.2 2v-3.2l5.5-6.8Z" fill="#12306b"/>'
    + '<ellipse cx="13.6" cy="6.6" rx="2.8" ry="4.7" fill="#f2b81c"/><ellipse cx="-13.6" cy="6.6" rx="2.8" ry="4.7" fill="#f2b81c"/>'
    + '<path d="M-2.3-22.4Q0-25 2.3-22.4L1.7-20H-1.7Z" fill="#12306b" stroke="none"/>'
    + '<path d="M0-17V14" stroke-width="1.2" stroke-dasharray="1.3 2.3" opacity=".55"/></g>'; },

  /* Marina Bay Sands on its little promontory */
  mbs: () => '<ellipse cx="2" cy="19" rx="44" ry="6.4" class="gsh"/>'
    + '<path d="M-30 22q4-3 8 0t8 0 8 0 8 0 8 0 8 0 8 0" fill="none" stroke="var(--ripple)" stroke-width="1.5" stroke-linecap="round" transform="translate(2 6)"/>'
    + `<g stroke="${OL}" stroke-width="1.6" stroke-linejoin="round">`
    + '<path d="M-25 19-19.5-10H-12L-13 19Z" fill="#4f9bc4"/><path d="M-6 19-4-10H4L6 19Z" fill="#74b9da"/><path d="M25 19 19.5-10H12L13 19Z" fill="#4f9bc4"/>'
    + '<path d="M-31.5-12.5H22C27.5-12.5 30.5-14.8 33.5-19L33-12.2C29.5-8.6 26-8 22-8H-28c-3.4 0-4.6-2.2-3.5-4.5Z" fill="#f4f7fa"/></g>'
    + '<g fill="#bfe3f3"><path d="M-17.2-5.5l-.4 18 1.3 0 .3-18Z"/><path d="M-.5-5.5V16h1.3V-5.5Z"/><path d="M17.2-5.5l.4 18-1.3 0-.3-18Z"/></g>'
    + '<rect x="8.5" y="-12" width="11" height="2.5" rx="1.2" fill="#29b6c5"/><g fill="#3aa05a"><circle cx="-24" cy="-12.4" r="1.5"/><circle cx="-17" cy="-12.4" r="1.5"/><circle cx="-10" cy="-12.4" r="1.5"/><circle cx="-3" cy="-12.4" r="1.5"/><circle cx="3.5" cy="-12.4" r="1.5"/></g>'
    + '<use href="#t2" transform="translate(-38 14) scale(1)"/><use href="#t2" transform="translate(40 15) scale(1.05)"/>',

  /* Sentosa: the luge hill */
  luge: () => `<path d="M-36 17C-31-9-12-19 3-14S28-5 36 17Z" fill="#8fd081" stroke="${OL}" stroke-width="1.7" stroke-linejoin="round"/>`
    + '<path d="M-26 14C-22-4-10-11 2-8" fill="none" stroke="#b6e6a4" stroke-width="3" stroke-linecap="round" opacity=".8"/>'
    + '<use href="#t2" transform="translate(-28 11) scale(1.05)"/><use href="#t2" transform="translate(30 12)"/><use href="#t0" transform="translate(-14 15) scale(.9)"/><use href="#t1" transform="translate(16 16) scale(.9)"/>'
    + `<path d="M25-11C7-15-14-11-13-4S13-3 12 3-6 10-26 12" fill="none" stroke="${OL}" stroke-width="7.4" stroke-linecap="round"/>`
    + '<path d="M25-11C7-15-14-11-13-4S13-3 12 3-6 10-26 12" fill="none" stroke="#d3dbe0" stroke-width="4.6" stroke-linecap="round"/>'
    + '<path d="M25-11C7-15-14-11-13-4S13-3 12 3-6 10-26 12" fill="none" stroke="#fff" stroke-width=".9" stroke-dasharray="2.2 2.4"/>'
    + `<path d="M26-11V-25" stroke="${OL}" stroke-width="1.6" stroke-linecap="round"/><path d="M26-25l8 2.6-8 2.8Z" fill="#ff7a1a" stroke="${OL}" stroke-width="1.2" stroke-linejoin="round"/>`
    + '<g transform="translate(2.5 -12.2) scale(-1 1) rotate(-6)">'
    + '<path d="M-4.6-1.2 2.4-6.6" stroke="#2468d8" stroke-width="2" stroke-linecap="round"/>'
    + `<rect x="-6.6" y="-3.8" width="13.2" height="5.6" rx="2.4" fill="#e23b2e" stroke="${OL}" stroke-width="1.1"/>`
    + `<rect x="-3.2" y="-9.6" width="5" height="6.4" rx="1.8" fill="#2468d8" stroke="${OL}" stroke-width=".9"/>`
    + `<circle cx="-.2" cy="-11.4" r="2.7" fill="#f2b81c" stroke="${OL}" stroke-width=".9"/>`
    + `<circle cx="-4.2" cy="2.2" r="2" fill="#26323a" stroke="${OL}" stroke-width=".7"/><circle cx="4.2" cy="2.2" r="2" fill="#26323a" stroke="${OL}" stroke-width=".7"/></g>`,

  /* Hougang United: a small stadium with a running track, stands and floodlights */
  stadium: () => '<ellipse cx="2" cy="24" rx="40" ry="6" class="gsh"/>'
    + `<ellipse rx="40" ry="26" fill="#c9ced2" stroke="${OL}" stroke-width="1.7"/>`
    + (() => { let d = ''; for (let i = 0; i < 30; i++) { const a = i / 30 * 6.2832, cx = Math.cos(a) * 36.5, cy = Math.sin(a) * 22.5, c = ['#e5533d', '#f2b81c', '#2f6fe0', '#fff', '#ff7a1a'][i % 5]; d += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="1.5" fill="${c}"/>`; } return d; })()
    + `<ellipse rx="33" ry="19.5" fill="#d4764a" stroke="${OL}" stroke-width="1.2"/>`
    + `<ellipse rx="28" ry="15.5" fill="#62b861" stroke="${OL}" stroke-width="1"/>`
    + '<g fill="#58ad58"><rect x="-22" y="-12" width="8" height="24"/><rect x="-6" y="-12" width="8" height="24"/><rect x="10" y="-12" width="8" height="24"/></g>'
    + '<g fill="none" stroke="#fff" stroke-width="1.1" opacity=".95"><rect x="-23" y="-11.5" width="46" height="23" rx="1"/><path d="M0-11.5V11.5"/><circle r="4.4"/><rect x="-23" y="-5.6" width="6" height="11.2"/><rect x="17" y="-5.6" width="6" height="11.2"/></g>'
    + fig(-10, -1, '#ff7a1a', '#17252f', 1, .78) + fig(8, 2, '#2f6fe0', '#fff', -1, .78) + fig(-2, 5, '#ff7a1a', '#17252f', 1, .78)
    + `<circle cx="-1" cy="7.4" r="1.9" fill="#fff" stroke="${OL}" stroke-width=".8"/>`
    + `<g stroke="${OL}" stroke-width="1.2" stroke-linecap="round"><path d="M-37-17V-27M37-17V-27M-37 19V9M37 19V9"/></g><g fill="#fff6c8" stroke="${OL}" stroke-width=".9"><rect x="-39.5" y="-30" width="5" height="3.6" rx="1"/><rect x="34.5" y="-30" width="5" height="3.6" rx="1"/><rect x="-39.5" y="5.6" width="5" height="3.6" rx="1"/><rect x="34.5" y="5.6" width="5" height="3.6" rx="1"/></g>`,

  /* Jurong Island: tanks, a flare stack and a puff of smoke */
  refinery: () => '<ellipse cx="0" cy="14" rx="34" ry="6" class="gsh"/>'
    + `<g stroke="${OL}" stroke-width="1.3"><ellipse cx="-14" cy="6" rx="10" ry="5" fill="#e8ecee"/><rect x="-24" y="-6" width="20" height="12" fill="#f4f6f7" stroke="none"/><path d="M-24-6V6M-4-6V6" fill="none"/><ellipse cx="-14" cy="-6" rx="10" ry="5" fill="#fff"/>`
    + '<ellipse cx="10" cy="9" rx="8" ry="4" fill="#e8ecee"/><rect x="2" y="-1" width="16" height="10" fill="#f4f6f7" stroke="none"/><path d="M2-1V9M18-1V9" fill="none"/><ellipse cx="10" cy="-1" rx="8" ry="4" fill="#fff"/></g>'
    + `<path d="M26 12V-14" stroke="${OL}" stroke-width="2.2" stroke-linecap="round"/><path d="M23 12 26 -6 29 12" fill="none" stroke="${OL}" stroke-width="1"/>`
    + '<path d="M26-15C21-21 24-24 26-29 28-24 31-21 26-15Z" fill="#ff8a1c" stroke="#d4380f" stroke-width="1"/><path d="M26-17C24-20 26-22 26-24 27-22 28-20 26-17Z" fill="#ffe27a"/>'
    + '<g fill="#fff" stroke="#b8c4cc" stroke-width="1"><circle cx="-2" cy="-17" r="5"/><circle cx="5" cy="-21" r="4"/><circle cx="-8" cy="-22" r="3.4"/></g>'
};

const LANDMARKS = [
  { art: 'beer', x: 807, y: 358, s: 1.0 },
  { art: 'plane', x: 1148, y: 398, s: 1.2, rot: 52 },
  { art: 'mbs', x: 836, y: 626, s: 1.05 },
  { art: 'luge', x: 776, y: 712, s: .92 },
  { art: 'stadium', x: 673, y: 399, s: 1.0, cap: 'Hougang United' },
  { art: 'refinery', x: 394, y: 578, s: .85 }
];

function landmarks() {
  let s = '<g class="landmarks" aria-hidden="true">';
  LANDMARKS.forEach(l => {
    s += `<g class="lm" transform="translate(${l.x} ${l.y}) scale(${l.s})"><g class="art">${ART[l.art](l.rot || 0)}</g>`;
    if (l.cap) s += `<text class="lm-cap" y="-34" text-anchor="middle">${l.cap}</text>`;
    s += '</g>';
  });
  return s + '</g>';
}

/* ---------- the painted base: sea, shallows, land, greenery ---------- */
function base(T, W, H) {
  let s = DEFS;
  const lands = Object.keys(T.land).map(k => T.land[k]);
  const all = T.johor.concat(T.isles, lands);
  const big = T.johor.concat(lands);
  s += '<defs>' + big.map((d, i) => `<clipPath id="cl${i}"><path d="${d}"/></clipPath>`).join('')
    + '<pattern id="grain" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="4" cy="6" r=".9"/><circle cx="17" cy="3" r=".7"/><circle cx="11" cy="15" r="1"/><circle cx="22" cy="19" r=".8"/><circle cx="3" cy="22" r=".7"/></pattern></defs>';
  s += `<rect class="sea" x="-1500" y="-1500" width="${W + 3000}" height="${H + 3000}"/>`;
  s += '<g class="waves">' + T.waves.map(w => `<use href="#wv" class="wv" transform="translate(${w[0]} ${w[1]}) scale(${w[2]})"/>`).join('') + '</g>';
  s += '<g class="shore">' + ['sh3', 'sh2', 'sh1'].map(c => all.map(d => `<path class="${c}" d="${d}"/>`).join('')).join('') + '</g>';
  s += '<g class="ships">' + SHIPS.map(sh => `<use href="#${sh.id}" transform="translate(${sh.x} ${sh.y}) rotate(${sh.r}) scale(${sh.s})"/>`).join('') + '</g>';
  s += '<g class="ground">';
  T.johor.forEach(d => { s += `<path class="malay" d="${d}"/>`; });
  T.isles.forEach(d => { s += `<path class="isle" d="${d}"/>`; });
  lands.forEach(d => { s += `<path class="land" d="${d}"/>`; });
  big.forEach((d, i) => { s += `<path class="beach" d="${d}" clip-path="url(#cl${i})"/><path class="grain" d="${d}" fill="url(#grain)"/>`; });
  s += '</g>';
  s += '<g class="features">';
  T.forests.forEach(d => { s += `<path class="forest" d="${d}"/>`; });
  T.reservoirs.forEach(d => { s += `<path class="res" d="${d}"/>`; });
  s += '</g>';
  s += '<g class="coasts" fill="none">' + all.map(d => `<path class="coast" d="${d}"/>`).join('') + '</g>';
  s += '<g class="trees">' + T.trees.map(t => `<use href="#t${t[2]}" transform="translate(${t[0]} ${t[1]}) scale(${t[3]})"/>`).join('') + '</g>';
  return s;
}

function labels() {
  let s = '<g class="water">';
  s += '<text x="300" y="92" class="big">MALAYSIA</text>';
  s += '<text x="790" y="62" class="big">JOHOR</text>';
  s += '<text x="676" y="132" class="small" transform="rotate(7 676 132)">Johor Strait</text>';
  s += '<text x="980" y="690" class="small">Singapore Strait</text>';
  s += '<text x="118" y="640" class="small" transform="rotate(-62 118 640)">Strait of Malacca</text>';
  s += '<g transform="translate(1198 700)" class="rose"><circle r="31" class="ring1"/><circle r="22" class="ring2"/><path d="M0-34 5.5-5.5 34 0 5.5 5.5 0 34-5.5 5.5-34 0-5.5-5.5Z" class="star1"/><path d="M0-34 5.5-5.5 0 0Z" class="star2"/><path d="M0 34-5.5 5.5 0 0Z" class="star2"/><path d="M34 0 5.5 5.5 0 0Z" class="star2"/><path d="M-34 0-5.5-5.5 0 0Z" class="star2"/><circle r="3" class="hub"/><text y="-40" text-anchor="middle" class="north">N</text></g>';
  return s + '</g>';
}

g.Scenery = { base, landmarks, labels };
})(typeof globalThis !== 'undefined' ? globalThis : window);
