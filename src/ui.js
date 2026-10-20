/* Lion City Rails: interface and game controller (solo and online). */
(function (g) {
'use strict';
const E = Engine, M = MAPDATA, MV = MapView;
const P2P = !!g.LCR_P2P;   // the GitHub build: online play only, peer to peer
const $ = (s, el) => (el || document).querySelector(s);
const esc = MV.esc;
const COLORS = M.colors, LINES = MV.LINES, WILD = E.WILD;
const AI_NAMES = ['Merlion', 'Otter', 'Durian', 'Kaya'];
const LEVELS = { easy: 0.5, normal: 0.8, sharp: 1 };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const App = {
  mode: 'menu', state: null, me: -1, code: null, host: false, net: null, netChecked: false,
  sel: null, pick: new Set(), hlTicket: null, hover: null, online: new Set(), busy: false,
  sound: store.get('lcr_sound') !== '0', prevTurn: -1, prevRoutes: null, last: null, aiTimer: null,
  unsub: [], lobby: { meta: null, joins: [] }, overlay: null, shownOver: null, nick: store.get('lcr_nick') || '',
  cfg: { opps: 2, level: 'normal' }, confirmCpu: null, err: '',
  joinPrefill: (() => { try { return (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); } catch (e) { return ''; } })()
};

/* ---------- small helpers ---------- */
function cardHTML(c, tag, attrs, small) {
  attrs = attrs || '';
  if (c === WILD) return `<${tag} class="card wild" title="Express (wild card)" aria-label="Express, wild card" ${attrs}><span class="inner">${MV.glyphSVG(8)}<span>${small ? 'WILD' : 'EXPRESS'}</span></span></${tag}>`;
  return `<${tag} class="card" style="--cc:var(--c-${COLORS[c]});--cct:var(--ct-${COLORS[c]})" title="${esc(LINES[c].name)}" aria-label="${esc(LINES[c].name)} card" ${attrs}>${MV.glyphSVG(c)}<span>${LINES[c].code}</span></${tag}>`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}
let actx = null;
function chime() {
  if (!App.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = actx.createOscillator(), gn = actx.createGain();
      o.type = 'sine'; o.frequency.value = f; gn.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      gn.gain.exponentialRampToValueAtTime(0.12, t0 + i * 0.14 + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.3);
      o.connect(gn); gn.connect(actx.destination); o.start(t0 + i * 0.14); o.stop(t0 + i * 0.14 + 0.32);
    });
  } catch (e) {}
}
const seatVars = i => `--pc:var(--p${i + 1});--pt:var(--pt${i + 1})`;
const myTurn = () => { const s = App.state; return !!s && !s.over && App.me >= 0 && s.turn === App.me; };
const isSetupPick = () => { const s = App.state; return myTurn() && (s.phase === 'setup' || s.phase === 'tickets') && s.players[App.me].pending.length > 0; };

/* ---------- overlay ---------- */
function openOverlay(html, name) {
  App.overlay = name; const o = $('#overlay'); o.innerHTML = html;
  const f = o.querySelector('[autofocus]') || o.querySelector('input, button'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30);
}
function closeOverlay() { App.overlay = null; $('#overlay').innerHTML = ''; }
const lineStrip = () => `<div class="lines" aria-hidden="true">${COLORS.map(c => `<i style="background:var(--c-${c})"></i>`).join('')}</div>`;

/* ---------- top bar ---------- */
function renderTop() {
  const s = App.state; let html = '';
  if (App.code && App.mode === 'online') html += `<span class="codebadge" title="Game code">${esc(App.code)}</span>`;
  if (s) {
    const p = s.players[s.turn]; let txt, mine = false;
    if (s.over) txt = 'Game over';
    else if (App.me >= 0 && s.turn === App.me) { mine = true; txt = s.phase === 'drew1' ? 'Your move: draw one more' : (s.phase === 'setup' ? 'Choose your starting tickets' : 'Your move'); }
    else if (s.phase === 'setup') txt = `${p.name} is choosing tickets`;
    else txt = p.kind === 'ai' ? `${p.name} is thinking…` : `${p.name}'s move`;
    html += `<span class="chip-turn${mine ? ' mine' : ''}" style="${seatVars(s.turn)}" role="status"><i class="seatdot"></i><span class="t">${esc(txt)}</span></span>`;
    if (s.lastRound && !s.over) html += `<span class="note"><b>Last round</b></span>`;
  }
  $('#status').innerHTML = html;
  $('#soundBtn').textContent = App.sound ? 'Sound on' : 'Sound off';
}

/* ---------- side desk ---------- */
function hintText() {
  const s = App.state; if (!s) return '';
  if (s.over) return 'The game is over. Open the results from the Menu.';
  const p = s.players[s.turn];
  if (App.me < 0) return `You are watching. ${esc(p.name)} is playing.`;
  if (s.turn !== App.me) return p.kind === 'ai' ? `${esc(p.name)} is thinking…` : `Waiting for <b>${esc(p.name)}</b>.`;
  if (s.phase === 'setup') return 'Pick at least <b>2</b> starting tickets in the panel under the map.';
  if (s.phase === 'tickets') return 'Choose which tickets to keep (at least <b>1</b>).';
  if (s.phase === 'drew1') return 'Take <b>one more</b> train card from the market or the deck. Express cards can only be your first draw.';
  if (!E.movesAvailable(s, App.me)) return 'You have no moves left, so you have to pass.';
  return 'Your move: <b>draw 2 cards</b>, <b>claim a route</b> by tapping it on the map, or <b>take tickets</b>.';
}
function playersBox(s) {
  const rows = s.players.map((p, i) => {
    const isMe = i === App.me;
    const pts = E.routePoints(s, i);
    const on = App.mode === 'online' && p.kind === 'human' ? (App.online.has(p.id) || isMe ? '<i class="on" title="Online"></i>' : '<i class="off" title="Not seen online"></i>') : '';
    const cards = p.hand.reduce((a, b) => a + b, 0);
    let extra = '';
    if (App.mode === 'online' && App.host && p.kind === 'human' && !isMe && !s.over)
      extra = `<button class="btn small hostbtn" data-act="cpu" data-i="${i}">${App.confirmCpu === i ? 'Confirm: computer takes over' : 'Hand to computer'}</button>`;
    return `<li class="pl${s.turn === i && !s.over ? ' turn' : ''}" style="${seatVars(i)}"><span class="chip">${i + 1}</span>
      <span class="pname"><b>${esc(p.name)}</b>${isMe ? '<em>you</em>' : ''}${p.kind === 'ai' ? '<span class="cpu">CPU</span>' : ''}${on}</span>
      <span class="pstats"><div><small>Trains</small><b>${p.trains}</b></div><div><small>Points</small><b>${pts}</b></div><div><small>Cards</small><b>${cards}</b></div><div><small>Tickets</small><b>${p.tickets.length}</b></div></span>${extra}</li>`;
  }).join('');
  return `<section class="box"><h3>Players <small>${s.lastRound ? 'last round' : 'first to 2 trains or fewer ends it'}</small></h3><ul class="plist">${rows}</ul></section>`;
}
function marketBox(s) {
  const mt = myTurn(), canCard = mt && (s.phase === 'main' || s.phase === 'drew1');
  const fu = s.faceUp.map((c, i) => {
    const dis = !canCard || (c === WILD && s.phase === 'drew1');
    return cardHTML(c, 'button', `type="button" data-act="face" data-i="${i}" ${dis ? 'disabled' : ''}`);
  }).join('');
  const canTix = mt && s.phase === 'main' && s.ticketDeck.length > 0;
  const pass = mt && s.phase === 'main' && !E.movesAvailable(s, App.me) ? '<div class="row" style="margin-top:8px"><button class="btn primary" data-act="pass">Pass turn</button></div>' : '';
  return `<section class="box"><h3>Train cards <small>${E.cardsLeft(s)} in deck</small></h3>
    <div class="faceup">${fu || '<span class="note">No cards in the market.</span>'}</div>
    <div class="decks"><button class="deckbtn" data-act="deck" ${canCard && E.cardsLeft(s) > 0 ? '' : 'disabled'}>Draw from deck<small>Blind card</small></button>
    <button class="deckbtn" data-act="tickets" ${canTix ? '' : 'disabled'}>Destination tickets<small>${s.ticketDeck.length} left</small></button></div>
    <p class="hint" aria-live="polite">${hintText()}</p>${pass}</section>`;
}
function handBox(s) {
  const p = s.players[App.me]; const total = p.hand.reduce((a, b) => a + b, 0);
  const chips = p.hand.map((n, c) => `<div class="hc${n ? '' : ' zero'}">${cardHTML(c, 'div', '', true)}<span class="n">${n}</span></div>`).join('');
  return `<section class="box"><h3>Your hand <small>${total} cards</small></h3><div class="hand">${chips}</div></section>`;
}
function ticketStatus(s, pi, ti) {
  const t = E.TICKETS[ti];
  if (E.connected(s, pi, t.a, t.b)) return { cls: 'done', txt: 'Connected. Points are yours if you keep it.' };
  const bp = E.bestPath(s, pi, t.a, t.b);
  if (!bp) return { cls: 'blocked', txt: 'Blocked. No open route links these stations.' };
  return { cls: '', txt: `About ${Math.floor(bp.cost)} more cars to connect` };
}
const tixName = ti => { const t = E.TICKETS[ti]; return `${esc(E.NODES[t.a].name)}<i>to</i>${esc(E.NODES[t.b].name)}`; };
function ticketsBox(s) {
  const p = s.players[App.me];
  const list = p.tickets.map(ti => {
    const st = ticketStatus(s, App.me, ti), t = E.TICKETS[ti];
    return `<button type="button" class="tix ${st.cls}${App.hlTicket === ti ? ' on' : ''}" data-ti="${ti}" data-act="tix-look" aria-pressed="${App.hlTicket === ti}"><span class="rt">${tixName(ti)}</span><span class="pts">${t.pts}</span><span class="st">${st.txt}</span></button>`;
  }).join('');
  return `<section class="box"><h3>Your tickets <small>kept secret from others</small></h3><div class="tlist">${list || '<span class="note">No tickets yet.</span>'}</div></section>`;
}
function logBox(s) {
  return `<section class="box"><h3>Table talk</h3><ul class="log">${s.log.slice(-8).reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
}
function renderSide() {
  const s = App.state, el = $('#side');
  if (!s) { el.innerHTML = ''; return; }
  const top = el.scrollTop;
  let h = playersBox(s) + marketBox(s);
  if (App.me >= 0) h += handBox(s) + ticketsBox(s);
  h += logBox(s);
  el.innerHTML = h; el.scrollTop = top;
}

/* ---------- sheet under the board ---------- */
function claimSheet(s) {
  const ri = App.sel, r = E.ROUTES[ri];
  const co = E.claimOptions(s, App.me, ri);
  if (co.err) return '';
  const ci = r.color === 'grey' ? -1 : COLORS.indexOf(r.color);
  const lineTxt = ci >= 0 ? LINES[ci].name : 'Any one colour';
  const opts = co.options.map(o => {
    let cards = '';
    for (let i = 0; i < o.n; i++) cards += cardHTML(o.color, 'span');
    for (let i = 0; i < o.wild; i++) cards += cardHTML(WILD, 'span');
    return `<button type="button" class="opt" data-act="pay" data-c="${o.color}" data-w="${o.wild}" autofocus><span class="mini">${cards}</span><span>Claim</span></button>`;
  }).join('');
  return `<div class="sh"><b>${esc(E.NODES[r.a].name)} to ${esc(E.NODES[r.b].name)}</b><span>${r.len} cars · +${E.SCORE[r.len]} points · ${esc(lineTxt)}${r.flags === 'F1' ? ' · needs an Express card' : ''}${r.name ? ' · ' + esc(r.name) : ''}</span></div>
    <div class="opts">${opts}<button type="button" class="btn" data-act="close-sheet">Cancel</button></div>`;
}
function ticketSheet(s) {
  const p = s.players[App.me], min = Math.min(s.phase === 'setup' ? 2 : 1, p.pending.length);
  const cards = p.pending.map(ti => {
    const t = E.TICKETS[ti], on = App.pick.has(ti), st = ticketStatus(s, App.me, ti);
    return `<button type="button" class="tix" data-act="tix-toggle" data-ti="${ti}" aria-pressed="${on}"><span class="rt">${tixName(ti)}</span><span class="pts">${t.pts}</span><span class="chk">${on ? 'Keeping' : 'Tap to keep'} · ${esc(st.txt)}</span></button>`;
  }).join('');
  return `<div class="sh"><b>${s.phase === 'setup' ? 'Choose your starting tickets' : 'Choose destination tickets'}</b><span>Keep at least ${min}. Unkept tickets go back to the bottom of the pile.</span></div>
    <div class="tpick">${cards}</div>
    <div class="row"><button type="button" class="btn primary" data-act="keep" ${App.pick.size >= min ? '' : 'disabled'}>Keep ${App.pick.size} ticket${App.pick.size === 1 ? '' : 's'}</button><span class="note">Complete a ticket for its points. Fail it and you lose them.</span></div>`;
}
function renderSheet() {
  const el = $('#sheet'), s = App.state; let h = '';
  if (s && !s.over && myTurn()) {
    if (isSetupPick()) h = ticketSheet(s);
    else if (App.sel != null && s.phase === 'main') h = claimSheet(s);
  }
  if (!h && App.sel != null) App.sel = null;
  const had = !el.hidden;
  el.hidden = !h; el.innerHTML = h;
  if (h && !had) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
}

/* ---------- map context ---------- */
function mapCtx() {
  const s = App.state, ctx = {};
  if (!s) return ctx;
  const me = App.me;
  if (myTurn() && s.phase === 'main') ctx.can = new Set(E.legalClaims(s, me).map(c => c.ri));
  ctx.sel = App.sel; ctx.last = App.last;
  const tk = new Set(), hl = new Set(), hlE = new Set();
  const look = [];
  if (me >= 0) {
    s.players[me].tickets.forEach(ti => { const t = E.TICKETS[ti]; if (!E.connected(s, me, t.a, t.b)) { tk.add(t.a); tk.add(t.b); } });
    if (isSetupPick()) s.players[me].pending.forEach(ti => look.push(ti));
  }
  if (App.hlTicket != null) look.push(App.hlTicket);
  look.forEach(ti => { const t = E.TICKETS[ti]; hl.add(t.a); hl.add(t.b); const bp = E.bestPath(s, Math.max(me, 0), t.a, t.b); if (bp && App.hlTicket === ti) bp.edges.forEach(ri => hlE.add(ri)); });
  ctx.tkNodes = tk; ctx.hlNodes = hl; ctx.hlEdges = hlE;
  return ctx;
}
function paintMap() { MV.update(App.state, mapCtx()); }

/* ---------- state changes ---------- */
function afterChange(o) {
  o = o || {};
  const s = App.state; if (!s) return;
  if (App.prevRoutes && App.prevRoutes.length === s.routes.length) {
    for (let i = 0; i < s.routes.length; i++) if (s.routes[i] !== App.prevRoutes[i] && s.routes[i] >= 0) App.last = i;
  }
  App.prevRoutes = s.routes.slice();
  if (App.hlTicket != null && App.me >= 0 && !s.players[App.me].tickets.includes(App.hlTicket)) App.hlTicket = null;
  if (!isSetupPick()) App.pick = new Set();
  renderTop(); renderSide(); renderSheet(); paintMap();
  if (App.mode === 'online' && !s.over && App.me >= 0 && s.turn === App.me && App.prevTurn !== App.me) chime();
  App.prevTurn = s.turn;
  if (s.over && App.shownOver !== s.gid) { App.shownOver = s.gid; showResults(); }
  if (App.mode === 'solo') store.set('lcr_solo', JSON.stringify(s));
  scheduleAI();
}
async function commit() {
  if (App.mode === 'online') {
    App.busy = true;
    try { await Net.commit(App.code, App.state); }
    catch (e) {
      toast('Could not reach the shared game. Re-syncing…');
      try { const st = await Net.getState(App.code); if (st) { App.state = st; afterChange(); } } catch (er) {}
    }
    App.busy = false;
  }
}
async function apply(fn) {
  const s = App.state; if (!s || App.busy) return null;
  const c = E.clone(s); const r = fn(c);
  if (r && r.err) { toast(r.err); return r; }
  App.state = c; afterChange({ local: true });
  await commit();
  return r;
}

/* ---------- computer players ---------- */
function scheduleAI() {
  clearTimeout(App.aiTimer);
  const s = App.state; if (!s || s.over) return;
  const p = s.players[s.turn]; if (!p || p.kind !== 'ai') return;
  if (App.mode === 'online' && App.me < 0) return;
  const v = s.v, gid = s.gid, base = s.phase === 'setup' ? 300 : 950;
  if (App.mode === 'solo') App.aiTimer = setTimeout(() => runAI(gid, v), base + Math.random() * 500);
  else if (App.mode === 'online') { if (P2P && !App.host) return; App.aiTimer = setTimeout(() => runAIOnline(gid, v), base + (App.host ? 0 : 800) + Math.random() * 500); }
}
function runAI(gid, v) {
  const s = App.state; if (!s || s.gid !== gid || s.v !== v || s.over || App.busy) return;
  const c = E.clone(s); AI.move(c, c.turn);
  App.state = c; afterChange({ local: true }); commit();
}
async function runAIOnline(gid, v) {
  const ok = await Net.lease(App.code, 'ai', 5000);
  const s = App.state; if (!s || s.gid !== gid || s.v !== v || s.over) return;
  if (!ok) { App.aiTimer = setTimeout(() => { const t = App.state; if (t && t.gid === gid && t.v === v) scheduleAI(); }, 3500); return; }
  runAI(gid, v);
}

/* ---------- starting games ---------- */
function newSeed() { return (Math.random() * 4294967295) >>> 0 || 1; }
function startSolo(cfg) {
  const nick = (App.nick || 'You').trim() || 'You';
  const players = [{ kind: 'human', name: nick, id: 'me' }];
  for (let i = 0; i < cfg.opps; i++) players.push({ kind: 'ai', name: AI_NAMES[i], skill: LEVELS[cfg.level] });
  resetGameUi();
  App.mode = 'solo'; App.me = 0; App.code = null; App.host = false;
  App.state = E.newGame({ seed: newSeed(), players });
  App.soloCfg = cfg;
  closeOverlay(); MV.fit(); afterChange({ local: true });
}
function resetGameUi() {
  teardown(); App.sel = null; App.pick = new Set(); App.hlTicket = null; App.last = null; App.prevRoutes = null; App.prevTurn = -1; App.shownOver = null; App.confirmCpu = null;
}
function teardown() {
  clearTimeout(App.aiTimer);
  App.unsub.forEach(u => { try { u(); } catch (e) {} }); App.unsub = [];
  if (App.mode === 'online' || App.code) { try { Net.clearPresence(); } catch (e) {} }
}

/* ---------- online ---------- */
async function hostOnline() {
  readNick();
  if (!App.nick.trim()) { App.err = 'Enter your name first.'; showMenu(); return; }
  try {
    if (P2P) toast('Setting up your game…');
    const code = await Net.createGame(App.nick.trim());
    if (P2P) $('#toast').hidden = true;
    resetGameUi(); App.mode = 'lobby'; App.code = code; App.host = true; App.state = null; App.me = -1;
    watchLobbyNow();
  } catch (e) { App.err = errText(e); showMenu(); }
}
async function joinOnline(code) {
  readNick();
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { App.err = 'Game codes have 4 letters or numbers.'; showMenu(); return; }
  if (!App.nick.trim()) { App.err = 'Enter your name first.'; showMenu(); return; }
  try {
    if (P2P) toast('Looking for that game…');
    const r = await Net.joinGame(code, App.nick.trim());
    if (P2P) $('#toast').hidden = true;
    if (r.role === 'missing') { App.err = 'No game found with that code.'; showMenu(); return; }
    resetGameUi(); App.code = code; App.host = r.meta.host === Net.uid();
    if (r.role === 'lobby') { App.mode = 'lobby'; watchLobbyNow(); }
    else enterOnlineGame(code);
  } catch (e) { App.err = errText(e); showMenu(); }
}
function errText(e) {
  const c = e && e.code;
  if (c === 'invalid_argument') return 'You can look at this game but not play in it. Ask the page owner to share it with you as an Editor or Contributor.';
  return (e && e.message) ? e.message : 'Something went wrong talking to the shared game.';
}
function watchLobbyNow() {
  App.lobby = { meta: null, joins: [] };
  const un = Net.watchLobby(App.code, meta => {
    App.lobby.meta = meta;
    if (meta && meta.status === 'play' && App.mode === 'lobby') { enterOnlineGame(App.code); return; }
    if (App.mode === 'lobby') renderLobby();
  }, rows => { App.lobby.joins = rows; if (App.mode === 'lobby') renderLobby(); }, () => { if (P2P && App.mode === 'lobby') { teardown(); App.mode = 'menu'; App.code = null; App.host = false; App.err = 'The host closed the lobby, or the connection dropped.'; showMenu(); } });
  App.unsub.push(un);
  renderLobby();
}
function renderLobby() {
  const L = App.lobby, joins = L.joins, ai = L.meta ? L.meta.ai : 1;
  const humans = Math.min(joins.length, 5), maxAi = Math.max(0, 5 - humans), aiN = Math.min(ai, maxAi), total = humans + aiN;
  const me = Net.uid();
  const list = joins.slice(0, 5).map((j, i) => `<li style="${seatVars(i)}"><span class="chip">${i + 1}</span><b>${esc(j.nick || 'Player')}</b>${j.uid === me ? '<em class="pname" style="display:inline"><em>you</em></em>' : ''}${i === 0 ? '<span class="note">host</span>' : ''}</li>`).join('')
    + Array.from({ length: aiN }, (_, k) => `<li style="${seatVars(humans + k)}"><span class="chip">${humans + k + 1}</span><b>${esc(AI_NAMES[k])}</b><span class="pname"><span class="cpu">CPU</span></span></li>`).join('');
  const seg = [0, 1, 2, 3, 4].filter(n => n <= maxAi + 0).map(n => `<button type="button" data-act="ai-count" data-n="${n}" aria-pressed="${n === aiN}">${n}</button>`).join('');
  const hostUi = App.host ? `<div class="field"><label>Computer players</label><div class="seg" role="group" aria-label="Computer players">${seg}</div></div>
      <div class="row"><button class="btn primary" data-act="lobby-start" ${total >= 2 ? '' : 'disabled'}>Start game (${total} players)</button><button class="btn" data-act="lobby-leave">Leave</button></div>
      ${total < 2 ? '<p class="note">Add a computer player or wait for a friend to join.</p>' : ''}`
    : `<p class="note">Waiting for the host to start the game…</p><div class="row"><button class="btn" data-act="lobby-leave">Leave</button></div>`;
  openOverlay(`<div class="modal"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="lt">${lineStrip()}<h2 class="sm" id="lt">Game lobby</h2>
    <p class="lead">${P2P ? 'Friends open the invite link, or enter this code on the same page.' : 'Friends open this page, pick “Play with friends” and enter this code.'}</p>
    <div class="bigcode" aria-label="Game code ${esc(App.code.split('').join(' '))}">${esc(App.code)}</div>
    <div class="row" style="justify-content:center"><button class="btn small" data-act="copy-code">Copy code</button>${P2P ? '<button class="btn small" data-act="copy-link">Copy invite link</button>' : ''}</div>
    <h3 class="note" style="margin:16px 0 8px">Players (${total} of 5)</h3><ul class="joined">${list}</ul>
    <div style="display:grid;gap:12px;margin-top:16px">${hostUi}</div></div></div>`, 'lobby');
}
async function lobbyStart() {
  const L = App.lobby, joins = L.joins.slice(0, 5), ai = Math.min(L.meta ? L.meta.ai : 1, Math.max(0, 5 - joins.length));
  const players = joins.map(j => ({ id: j.uid, kind: 'human', name: (j.nick || 'Player').slice(0, 16) }));
  for (let i = 0; i < ai; i++) players.push({ kind: 'ai', name: AI_NAMES[i], skill: LEVELS.normal });
  if (players.length < 2) return;
  const st = E.newGame({ seed: newSeed(), players, hostId: Net.uid() });
  try { await Net.begin(App.code, st); } catch (e) { toast(errText(e)); }
}
async function enterOnlineGame(code) {
  App.unsub.forEach(u => { try { u(); } catch (e) {} }); App.unsub = [];
  App.mode = 'online'; App.code = code; closeOverlay(); MV.fit();
  store.set('lcr_last', code);
  const meta = await Net.getMeta(code); App.host = !!meta && meta.host === Net.uid();
  App.unsub.push(Net.watchState(code, onRemoteState, () => { if (!P2P) toast('Lost the connection to the game.'); }));
  App.unsub.push(Net.watchPresence(code, ids => { App.online = ids; if (App.state) renderSide(); }));
  const st = await Net.getState(code); if (st) onRemoteState(st);
}
function onRemoteState(st) {
  const cur = App.state;
  if (cur && st.gid === cur.gid && st.v <= cur.v) return;
  if (!cur || st.gid !== cur.gid) { App.shownOver = null; App.prevRoutes = null; App.prevTurn = -1; App.last = null; closeOverlayIf('results'); }
  App.state = st; App.me = st.players.findIndex(p => p.id === Net.uid());
  afterChange({ local: false });
}
function closeOverlayIf(n) { if (App.overlay === n) closeOverlay(); }

/* ---------- menu, rules, results ---------- */
function readNick() { const i = $('#nick'); if (i) { App.nick = i.value.slice(0, 16); store.set('lcr_nick', App.nick); } }
function seg(name, items, cur) {
  return `<div class="seg" role="group" aria-label="${name}">${items.map(([v, t]) => `<button type="button" data-act="cfg" data-k="${name}" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join('')}</div>`;
}
function showMenu() {
  const n = App.net, inGame = !!App.state && !App.state.over;
  let online;
  if (!App.netChecked) online = '<p class="note">Checking your connection…</p>';
  else if (!n || !n.ok) {
    const why = P2P ? 'The connection library did not load. Check your internet connection and reload the page.' : { signedout: 'Online play needs you to be signed in to Claude and invited to this page with edit access.', unavailable: 'Online play works on the published page. This copy cannot reach the shared game.', noid: 'Online play needs you to be signed in to Claude.', error: 'Could not reach the shared game right now.' }[(n && n.reason) || 'error'];
    online = `<p class="note warn">${esc(why)}</p>${P2P ? '' : '<p class="note">You can still play the computer.</p>'}`;
  } else {
    online = `${n.canWrite === false ? '<p class="note warn">Your access to this page is view-only. Ask the owner to share it with you as an Editor or Contributor to play.</p>' : ''}
      <button class="btn primary" data-act="host">Host a game</button>
      <div class="field"><label for="jcode">Or join a friend's game</label><div class="row"><input class="code" id="jcode" value="${esc(App.joinPrefill)}" maxlength="4" size="4" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Game code" style="max-width:150px"><button class="btn" data-act="join">Join</button></div></div>`;
  }
  const solo = store.get('lcr_solo'), last = store.get('lcr_last');
  let resume = '';
  if (inGame) resume += `<button class="btn primary" data-act="close-menu">Back to the game</button>`;
  if (!P2P && !inGame && solo) { try { const o = JSON.parse(solo); if (o && !o.over) resume += `<button class="btn" data-act="continue-solo">Continue your last computer game</button>`; } catch (e) {} }
  if (last && n && n.ok) resume += `<button class="btn" data-act="resume" data-code="${esc(last)}">Rejoin game ${esc(last)}</button>`;
  openOverlay(`<div class="modal"><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="mt">${lineStrip()}
    <h2 id="mt">Lion City Rails</h2>
    <p class="lead">Lay MRT lines across Singapore, connect your destination tickets and out-build your friends. Bugis is the busiest interchange on the map.</p>
    ${App.err ? `<p class="err" role="alert" style="margin-top:10px">${esc(App.err)}</p>` : ''}
    <div class="field" style="margin:16px 0 12px;max-width:320px"><label for="nick">Your name</label><input id="nick" maxlength="16" value="${esc(App.nick)}" placeholder="Name shown to other players" autocomplete="nickname"></div>
    <div class="cols${P2P ? ' one' : ''}">
      ${P2P ? '' : `<div class="opt-card"><h3>Play the computer</h3><p>Solo game against up to four computer players.</p>
        <div class="field"><label>Opponents</label>${seg('opps', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], App.cfg.opps)}</div>
        <div class="field"><label>Level</label>${seg('level', [['easy', 'Easy'], ['normal', 'Normal'], ['sharp', 'Sharp']], App.cfg.level)}</div>
        <button class="btn primary" data-act="solo-start">Start game</button></div>`}
      <div class="opt-card"><h3>Play with friends</h3><p>Everyone plays on their own device. ${P2P ? 'Host a game, then send friends this page and the 4-letter code. The host keeps this tab open while you play.' : 'Share the page, then swap a 4-letter code.'}</p>${online}</div>
    </div>
    ${resume ? `<div class="row" style="margin-top:14px">${resume}</div>` : ''}
    <div class="row" style="margin-top:16px"><button class="btn small" data-act="rules">How to play</button></div></div></div>`, 'menu');
  App.err = '';
}
function showRules() {
  const key = COLORS.map((c, i) => `<span><i class="sw" style="--cc:var(--c-${c});--cct:var(--ct-${c})">${MV.glyphSVG(i)}</i>${LINES[i].code} ${esc(LINES[i].name)}</span>`).join('');
  openOverlay(`<div class="modal"><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="rt">${lineStrip()}<h2 class="sm" id="rt">How to play</h2>
    <div class="rules">
      <div><h3>Goal</h3><p>Score the most points by claiming routes, completing your destination tickets and building the longest unbroken line.</p></div>
      <div><h3>On your turn, do one of three things</h3><ul>
        <li><b>Draw train cards.</b> Take two from the market or the deck. A face-up Express card counts as your whole draw.</li>
        <li><b>Claim a route.</b> Tap a route and pay cards of its line colour, one per car. Grey routes take any one colour. Express cards are wild.</li>
        <li><b>Take destination tickets.</b> Draw three and keep at least one.</li></ul></div>
      <div><h3>Route points</h3><p>1 car scores 1, 2 cars 2, 3 cars 4, 4 cars 7, 5 cars 10, 6 cars 15.</p></div>
      <div><h3>Special routes</h3><ul>
        <li><b>Double routes</b> (such as Orchard to Bugis) have two lanes. With 2 or 3 players only one lane can be used. With 4 or 5 both can, but never by the same player.</li>
        <li><b>Bumboats</b> to Pulau Ubin have dashed cars and need at least one Express card.</li>
        <li><b>Bugis</b> is the busiest interchange: more routes meet there than anywhere else.</li></ul></div>
      <div><h3>Game end</h3><p>When a player has 2 trains or fewer, every other player gets one last turn. Completed tickets add their points, failed tickets subtract them, and the longest continuous line earns 10 bonus points.</p></div>
      <div><h3>Card colours</h3><p class="note">Every line has its own colour on the board, and each card carries its line code. Numbers on claimed routes show who owns them.</p><div class="keyrow">${key}<span><i class="sw" style="background:conic-gradient(var(--c-red),var(--c-amber),var(--c-green),var(--c-blue),var(--c-purple),var(--c-red));color:#fff">${MV.glyphSVG(8)}</i>Express (wild)</span></div></div>
    </div>
    <div class="row" style="margin-top:18px"><button class="btn primary" data-act="close-rules" autofocus>Got it</button></div></div></div>`, 'rules');
}
function showResults() {
  const s = App.state; if (!s || !s.result) return;
  const rows = s.result.rows.slice().sort((a, b) => b.total - a.total);
  const win = s.result.winners.map(i => s.players[i].name).join(' and ');
  const body = rows.map(r => {
    const p = s.players[r.pi];
    return `<tr class="${s.result.winners.includes(r.pi) ? 'win' : ''}"><td><span class="chip" style="${seatVars(r.pi)};display:inline-grid;vertical-align:middle;margin-right:8px">${r.pi + 1}</span>${esc(p.name)}${r.pi === App.me ? ' (you)' : ''}</td>
      <td>${r.routePts}</td><td>${r.ticketPts >= 0 ? '+' : ''}${r.ticketPts}<small>${r.done} done, ${r.failed} missed</small></td>
      <td>${r.bonus ? '+10' : '0'}<small>${r.longest} cars</small></td><td class="tot">${r.total}</td></tr>`;
  }).join('');
  const mine = App.me >= 0 ? s.result.rows[App.me] : null;
  const tix = mine ? `<h3 class="note" style="margin:16px 0 6px">Your tickets</h3><div class="tlist">${mine.list.map(x => { const t = E.TICKETS[x.ti]; return `<div class="tix ${x.ok ? 'done' : 'blocked'}"><span class="rt">${tixName(x.ti)}</span><span class="pts">${x.ok ? '+' : '-'}${t.pts}</span><span class="st">${x.ok ? 'Connected' : 'Not connected'}</span></div>`; }).join('')}</div>` : '';
  const again = App.mode === 'solo' ? '<button class="btn primary" data-act="again">Play again</button>' : (App.host ? '<button class="btn primary" data-act="rematch">Rematch with same players</button>' : '<span class="note">The host can start a rematch.</span>');
  openOverlay(`<div class="modal"><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="gt">${lineStrip()}<h2 class="sm" id="gt">Final scores</h2>
    <div class="winner">${esc(win)} ${s.result.winners.length > 1 ? 'win' : 'wins'}.</div>
    <div class="table-wrap"><table class="res"><thead><tr><th>Player</th><th>Routes</th><th>Tickets</th><th>Longest line</th><th>Total</th></tr></thead><tbody>${body}</tbody></table></div>${tix}
    <div class="row" style="margin-top:18px">${again}<button class="btn" data-act="close-results">Look at the board</button><button class="btn" data-act="menu">Menu</button></div></div></div>`, 'results');
}

/* ---------- events ---------- */
function onAct(act, el) {
  const s = App.state;
  switch (act) {
    case 'rules': showRules(); break;
    case 'close-rules': if (App.state && App.mode !== 'menu') closeOverlay(); else showMenu(); break;
    case 'menu': showMenu(); break;
    case 'close-menu': closeOverlay(); break;
    case 'close-results': closeOverlay(); break;
    case 'sound': App.sound = !App.sound; store.set('lcr_sound', App.sound ? '1' : '0'); if (App.sound) chime(); renderTop(); break;
    case 'zoom-in': MV.zoomBtn(0.7); break;
    case 'zoom-out': MV.zoomBtn(1.4); break;
    case 'zoom-fit': MV.fit(); break;
    case 'cfg': App.cfg[el.dataset.k] = el.dataset.k === 'opps' ? +el.dataset.v : el.dataset.v; readNick(); showMenu(); break;
    case 'solo-start': readNick(); startSolo(App.cfg); break;
    case 'continue-solo': { try { const o = JSON.parse(store.get('lcr_solo')); resetGameUi(); App.mode = 'solo'; App.me = o.players.findIndex(p => p.id === 'me'); App.state = o; closeOverlay(); MV.fit(); afterChange({ local: true }); } catch (e) { store.del('lcr_solo'); showMenu(); } break; }
    case 'again': startSolo(App.soloCfg || App.cfg); break;
    case 'host': hostOnline(); break;
    case 'join': joinOnline(($('#jcode') || {}).value); break;
    case 'resume': joinOnline(el.dataset.code); break;
    case 'ai-count': Net.setAiCount(App.code, +el.dataset.n).catch(() => toast('Could not change the computer players.')); break;
    case 'lobby-start': lobbyStart(); break;
    case 'lobby-leave': { const code = App.code; const wasHost = App.host; teardown(); Net.leaveLobby(code).catch(() => {}); App.mode = 'menu'; App.code = null; App.host = false; showMenu(); break; }
    case 'copy-code': try { navigator.clipboard.writeText(App.code).then(() => toast('Code copied.'), () => toast('Select the code and copy it.')); } catch (e) { toast('Select the code and copy it.'); } break;
    case 'copy-link': { const u = location.href.split('#')[0].split('?')[0] + '?join=' + App.code; try { navigator.clipboard.writeText(u).then(() => toast('Invite link copied.'), () => toast('Copy this: ' + u)); } catch (e) { toast('Copy this: ' + u); } break; }
    case 'rematch': rematch(); break;
    case 'cpu':
      if (App.confirmCpu !== +el.dataset.i) { App.confirmCpu = +el.dataset.i; renderSide(); break; }
      { const i = App.confirmCpu; App.confirmCpu = null; apply(c => { const p = c.players[i]; p.kind = 'ai'; p.skill = LEVELS.normal; p.name = p.name + ' (CPU)'; c.v++; log(c, p.name + ' is now played by the computer.'); return { ok: true }; }); }
      break;
    case 'face': apply(c => E.drawFaceUp(c, App.me, +el.dataset.i)); break;
    case 'deck': apply(c => E.drawDeck(c, App.me)); break;
    case 'tickets': App.pick = new Set(); apply(c => E.drawTickets(c, App.me)); break;
    case 'pass': apply(c => E.pass(c, App.me)); break;
    case 'tix-toggle': { const ti = +el.dataset.ti; if (App.pick.has(ti)) App.pick.delete(ti); else App.pick.add(ti); renderSheet(); break; }
    case 'tix-look': { const ti = +el.dataset.ti; App.hlTicket = App.hlTicket === ti ? null : ti; renderSide(); paintMap(); if (App.hlTicket != null) { const t = E.TICKETS[ti]; MV.focusOn([t.a, t.b]); } break; }
    case 'keep': { const keep = [...App.pick]; apply(c => E.keepTickets(c, App.me, keep)).then(r => { if (r && r.ok) App.pick = new Set(); }); break; }
    case 'close-sheet': App.sel = null; renderSheet(); paintMap(); break;
    case 'pay': { const ri = App.sel; apply(c => E.claimRoute(c, App.me, ri, { color: +el.dataset.c, wild: +el.dataset.w })).then(r => { if (r && r.ok) { App.sel = null; App.last = ri; renderSheet(); paintMap(); } }); break; }
  }
}
function log(c, m) { c.log.push(m); if (c.log.length > 40) c.log.shift(); }
async function rematch() {
  const s = App.state; if (!s || !App.host) return;
  const players = s.players.map(p => ({ id: p.id, kind: p.kind, name: p.name, skill: p.skill }));
  const st = E.newGame({ seed: newSeed(), players, hostId: Net.uid() });
  App.state = st; App.shownOver = null; App.prevRoutes = null; App.last = null; closeOverlay(); afterChange({ local: true });
  try { await Net.commit(App.code, st); } catch (e) { toast(errText(e)); }
}
function onRoute(ri) {
  const s = App.state;
  if (!s) return;
  if (App.overlay) return;
  if (s.over) { toast('The game is over.'); return; }
  if (App.me < 0) { toast('You are watching this game.'); return; }
  const r = E.ROUTES[ri];
  if (s.routes[ri] >= 0) { toast(`${s.players[s.routes[ri]].name} owns ${E.routeName(ri)}.`); return; }
  if (s.turn !== App.me) { toast('Wait for your turn.'); return; }
  if (s.phase !== 'main') { toast(s.phase === 'drew1' ? 'Finish drawing your second card first.' : 'Choose your tickets first.'); return; }
  const co = E.claimOptions(s, App.me, ri);
  if (co.err) { toast(co.err); return; }
  App.sel = App.sel === ri ? null : ri; renderSheet(); paintMap();
}
function onHover(ri) {
  const tip = $('#maptip');
  if (ri == null) { tip.hidden = true; return; }
  const r = E.ROUTES[ri], s = App.state, o = s ? s.routes[ri] : -1;
  const ci = r.color === 'grey' ? -1 : COLORS.indexOf(r.color);
  tip.textContent = `${E.NODES[r.a].name} to ${E.NODES[r.b].name} · ${r.len} cars · +${E.SCORE[r.len]} · ${ci >= 0 ? LINES[ci].name : 'any colour'}${r.flags === 'F1' ? ' · needs Express' : ''}${o >= 0 ? ' · owned by ' + s.players[o].name : ''}`;
  tip.hidden = false;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  onAct(el.dataset.act, el);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (App.overlay === 'rules' || App.overlay === 'results' || (App.overlay === 'menu' && App.state))) { if (App.overlay === 'rules' && !App.state) showMenu(); else closeOverlay(); }
  if (e.key === 'Enter' && e.target && e.target.id === 'jcode') onAct('join', e.target);
});
$('#side').addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-ti]');
  const ti = t && t.dataset.act === 'tix-toggle' ? +t.dataset.ti : null;
  if (ti !== App.hover) { App.hover = ti; if (App.state) { const keep = App.hlTicket; App.hlTicket = ti != null ? ti : keep; } }
});
$('#sheet').addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-ti]');
  const ti = t ? +t.dataset.ti : null;
  if (ti !== App.hover) { App.hover = ti; const prev = App.hlTicket; App.hlTicket = ti; if (prev !== ti) paintMap(); }
});
$('#sheet').addEventListener('mouseleave', () => { if (App.hover != null) { App.hover = null; App.hlTicket = null; paintMap(); } });

/* ---------- boot ---------- */
function boot() {
  $('#legend').innerHTML = COLORS.map((c, i) => `<span style="color:var(--c-${c})"><svg viewBox="-6 -6 12 12"><rect x="-5.5" y="-3.2" width="11" height="6.4" rx="1.6"/></svg><b style="color:var(--ink);font-weight:700">${LINES[i].code}</b></span>`).join('')
    + `<span style="color:var(--ink)"><svg viewBox="-6 -6 12 12">${MV.glyphSVG(8).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg><b>Express</b></span>`;
  MV.init({ onRoute, onHover });
  renderTop(); paintMap();
  showMenu();
  if (Net.onLink) Net.onLink(k => toast(k === 'back' ? 'Reconnected to the host.' : k === 'gone' ? 'Could not reconnect. The host may have closed the game.' : 'Lost the connection to the host. Reconnecting…'));
  Net.init().then(res => {
    App.net = res; App.netChecked = true;
    if (res && res.ok && !App.nick && res.name) { App.nick = res.name.slice(0, 16); }
    if (App.overlay === 'menu') { readNick(); showMenu(); }
  });
  g.__LCR = { App, E, MV };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof globalThis !== 'undefined' ? globalThis : window);
