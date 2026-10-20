/* Lion City Rails: peer-to-peer online layer (PeerJS / WebRTC).
   The host's browser holds the game. Friends connect to it with the 4-letter code, send their moves to the host,
   and the host passes every change on to everyone. No game server is needed: PeerJS's free public broker only
   introduces the browsers to each other, then the game data flows directly between them. */
(function (g) {
'use strict';
const NS = 'lioncityrails-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = n => Array.from({ length: n }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const genCode = () => rnd(4);
const qp = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const clean = (s, n) => String(s == null ? '' : s).replace(/[^\w-]/g, '').slice(0, n);
const nickOf = s => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);

/* ---------- identity: one id per browser tab, so two tabs can play as two people; a game remembers its own seat ---------- */
let uid = null;
function ensureUid() {
  if (uid) return uid;
  let u = null; try { u = sessionStorage.getItem('lcr_uid'); } catch (e) {}
  if (!u) { u = 'u' + rnd(12).toLowerCase(); try { sessionStorage.setItem('lcr_uid', u); } catch (e) {} }
  return (uid = u);
}
function adoptUid(u) { uid = u; try { sessionStorage.setItem('lcr_uid', u); } catch (e) {} }

/* ---------- replicated game record (the host owns it; everyone else holds a copy) ---------- */
let S = null, role = null, peer = null, conn = null, closing = false, seq = 0, lastNick = '';
const hostConns = new Map();   // host side: connection -> player id
const acks = new Map();
const L = { meta: new Set(), joins: new Set(), state: new Set(), pres: new Set(), err: new Set(), link: new Set() };
const fire = (k, ...a) => Array.from(L[k]).forEach(fn => { try { fn(...a); } catch (e) {} });
const fresh = code => ({ code, meta: null, joins: {}, state: null, online: [] });
const joinRows = () => Object.keys(S.joins).map(u => Object.assign({ uid: u }, S.joins[u])).sort((a, b) => (a.at - b.at) || (a.uid < b.uid ? -1 : 1));
const copy = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const send = (c, m) => { try { if (c && c.open) c.send(m); } catch (e) {} };

function friendly(e) {
  const t = e && (e.type || e.code);
  if (t === 'browser-incompatible') return new Error('This browser cannot make peer-to-peer connections. Try a recent Chrome, Edge, Safari or Firefox.');
  return new Error('Could not reach the PeerJS connection service. Check your internet connection and try again.');
}

/* ---------- PeerJS plumbing ---------- */
function brokerOpts() {
  const b = qp.get('broker');   // ?broker=host:port points the game at your own PeerJS server (also used for testing)
  if (b) { const i = b.lastIndexOf(':'); return { host: i > 0 ? b.slice(0, i) : b, port: i > 0 ? +b.slice(i + 1) : 9000, path: '/', secure: qp.get('secure') === '1', config: { iceServers: [] } }; }
  return {};
}
function openPeer(id) {
  return new Promise((resolve, reject) => {
    let done = false, p;
    try { p = new g.Peer(id || undefined, brokerOpts()); } catch (e) { reject(e); return; }
    const to = setTimeout(() => { if (!done) { done = true; try { p.destroy(); } catch (e) {} reject(Object.assign(new Error('timeout'), { type: 'network' })); } }, 12000);
    p.on('open', () => { if (!done) { done = true; clearTimeout(to); resolve(p); } });
    p.on('error', err => { if (!done) { done = true; clearTimeout(to); try { p.destroy(); } catch (e) {} reject(err); } });
  });
}
function killPeer() {
  const p = peer; peer = null;
  if (conn) { try { conn.close(); } catch (e) {} conn = null; }
  hostConns.forEach((u, c) => { try { c.close(); } catch (e) {} }); hostConns.clear();
  if (p) { try { p.destroy(); } catch (e) {} }
}
function closeAll() {
  closing = true; clearInterval(rcTimer); rcTimer = null; rcBusy = false;
  killPeer(); acks.forEach(f => { try { f(false); } catch (e) {} }); acks.clear();
  S = null; role = null; closing = false;
}

/* ---------- host ---------- */
const onlineIds = () => { const s = new Set([S.meta.host]); hostConns.forEach(u => s.add(u)); return Array.from(s); };
function persist() {
  if (role !== 'host' || !S) return;
  LS.set('lcr_host', JSON.stringify({ code: S.code, saved: Date.now(), meta: S.meta, joins: S.joins, state: S.state }));
}
function pushPresence() {
  const ids = onlineIds(); S.online = ids;
  hostConns.forEach((u, c) => send(c, { t: 'pres', ids }));
  fire('pres', new Set(ids));
}
function pushJoins(except) { persist(); hostConns.forEach((u, c) => { if (c !== except) send(c, { t: 'joins', v: S.joins }); }); fire('joins', joinRows()); }
function pushMeta() { persist(); hostConns.forEach((u, c) => send(c, { t: 'meta', v: S.meta })); fire('meta', copy(S.meta)); }
function validState(st) { return !!st && typeof st === 'object' && Array.isArray(st.players) && typeof st.v === 'number' && st.gid != null && Array.isArray(st.routes); }
function hostSetState(st, from) {
  S.state = st; persist();
  hostConns.forEach((u, c) => { if (c !== from) send(c, { t: 'state', v: st }); });
  fire('state', copy(st));
}
function hostSetup(p) {
  peer = p;
  p.on('connection', c => {
    c.on('data', m => hostMsg(c, m));
    c.on('close', () => hostDrop(c));
    c.on('error', () => hostDrop(c));
  });
  p.on('disconnected', () => setTimeout(() => { try { if (peer === p && !p.destroyed) p.reconnect(); } catch (e) {} }, 1500));
  p.on('error', () => {});
}
function hostDrop(c) {
  const u = hostConns.get(c); if (!hostConns.delete(c) || !S) return;
  if (S.meta.status === 'lobby' && u && u !== S.meta.host && S.joins[u] && !Array.from(hostConns.values()).includes(u)) { delete S.joins[u]; pushJoins(); }
  pushPresence();
}
function hostMsg(c, m) {
  if (!S || role !== 'host' || !m || typeof m !== 'object') return;
  const u = hostConns.get(c);
  if (m.t === 'hello') {
    const id = clean(m.uid, 40); if (!id) return;
    hostConns.forEach((v, k) => { if (v === id && k !== c) { hostConns.delete(k); try { k.close(); } catch (e) {} } });
    hostConns.set(c, id);
    let changed = false;
    if (S.meta.status === 'lobby') {
      const nick = nickOf(m.nick) || 'Player';
      if (!S.joins[id]) { if (Object.keys(S.joins).length < 12) { S.joins[id] = { nick, at: Date.now() }; changed = true; } }
      else if (S.joins[id].nick !== nick) { S.joins[id].nick = nick; changed = true; }
    }
    send(c, { t: 'snap', meta: S.meta, joins: S.joins, state: S.state, ids: onlineIds() });
    if (changed) pushJoins(c);
    pushPresence();
    return;
  }
  if (!u) return;
  if (m.t === 'leave') {
    if (S.meta.status === 'lobby' && u !== S.meta.host && S.joins[u]) { delete S.joins[u]; pushJoins(); }
  } else if (m.t === 'rename') {
    const nick = nickOf(m.nick);
    if (S.meta.status === 'lobby' && S.joins[u] && nick) { S.joins[u].nick = nick; pushJoins(); }
  } else if (m.t === 'commit') {
    const st = m.state, cur = S.state;
    const ok = validState(st) && !!cur && (st.gid !== cur.gid ? u === S.meta.host : st.v > cur.v) && (u === S.meta.host || cur.players.some(p => p.id === u));
    send(c, { t: 'ack', id: m.id, ok });
    if (ok) hostSetState(st, c); else if (cur) send(c, { t: 'state', v: cur });
  }
}

async function createGame(nick) {
  closeAll(); ensureUid(); lastNick = nickOf(nick);
  let p = null, code = null, err = null;
  for (let i = 0; i < 8 && !p; i++) {
    const c = genCode();
    try { p = await openPeer(NS + c); code = c; } catch (e) { err = e; if (!e || e.type !== 'unavailable-id') break; }
  }
  if (!p) throw friendly(err);
  S = fresh(code); role = 'host';
  S.meta = { host: uid, status: 'lobby', created: Date.now(), ai: 1 };
  S.joins[uid] = { nick: lastNick || 'Host', at: Date.now() };
  hostSetup(p); persist(); LS.set('lcr_seat_' + code, uid);
  return code;
}
function hostRecord(code) {
  try {
    const r = JSON.parse(LS.get('lcr_host') || 'null');
    if (r && r.code === code && r.meta && r.joins && Date.now() - r.saved < 12 * 3600 * 1000) return r;
  } catch (e) {}
  return null;
}
async function resumeHost(rec) {
  closeAll(); adoptUid(rec.meta.host);
  let p = null, err = null;
  for (let i = 0; i < 12 && !p; i++) {     // the broker can take a few seconds to free the old id after a page reload
    try { p = await openPeer(NS + rec.code); } catch (e) { err = e; if (!e || e.type !== 'unavailable-id') break; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!p) throw (err && err.type === 'unavailable-id') ? new Error('That game is still shutting down. Wait a few seconds and try again.') : friendly(err);
  S = fresh(rec.code); role = 'host'; S.meta = rec.meta; S.joins = rec.joins; S.state = rec.state; S.online = [uid];
  hostSetup(p); persist();
}

/* ---------- client ---------- */
let rcTimer = null, rcBusy = false, snapWait = null;
function applySnap(m) {
  S.meta = m.meta; S.joins = m.joins || {}; S.state = m.state || null; S.online = m.ids || [];
  fire('meta', copy(S.meta)); fire('joins', joinRows()); if (S.state) fire('state', copy(S.state)); fire('pres', new Set(S.online));
}
function clientMsg(m) {
  if (!S || !m || typeof m !== 'object') return;
  if (m.t === 'snap') { if (snapWait) { const f = snapWait; snapWait = null; f(m); } else applySnap(m); }
  else if (m.t === 'meta') { S.meta = m.v; fire('meta', copy(S.meta)); }
  else if (m.t === 'joins') { S.joins = m.v || {}; fire('joins', joinRows()); }
  else if (m.t === 'state') { if (validState(m.v)) { S.state = m.v; fire('state', copy(S.state)); } }
  else if (m.t === 'pres') { S.online = m.ids || []; fire('pres', new Set(S.online)); }
  else if (m.t === 'ack') { const f = acks.get(m.id); if (f) { acks.delete(m.id); f(!!m.ok); } }
  else if (m.t === 'closed') { closing = true; fire('err', new Error('The host closed this game.')); fire('link', 'gone'); killPeer(); closing = false; clearInterval(rcTimer); rcTimer = null; }
}
function clientConnect(code, nick) {
  return new Promise(async (resolve, reject) => {
    let settled = false, p = null, c = null, to = null;
    const fail = e => { if (settled) return; settled = true; clearTimeout(to); snapWait = null; try { if (c) c.close(); } catch (er) {} try { if (p) p.destroy(); } catch (er) {} reject(e); };
    try { p = await openPeer(null); } catch (e) { fail(e); return; }
    p.on('error', e => { if (e && e.type === 'peer-unavailable') fail(Object.assign(new Error('missing'), { code: 'missing' })); else if (!settled) fail(e); });
    c = p.connect(NS + code, { reliable: true });
    snapWait = m => { if (settled) return; settled = true; clearTimeout(to); peer = p; conn = c; resolve(m); };
    c.on('open', () => send(c, { t: 'hello', uid, nick: nick || lastNick }));
    c.on('data', clientMsg);
    c.on('close', () => clientLost(c));
    c.on('error', () => clientLost(c));
    to = setTimeout(() => fail(Object.assign(new Error('timeout'), { code: 'missing' })), 10000);
  });
}
function clientLost(c) {
  if (closing || conn !== c || role !== 'client') return;
  conn = null; fire('err', new Error('Lost the connection to the host.')); fire('link', 'lost');
  clearInterval(rcTimer); let tries = 0;
  rcTimer = setInterval(async () => {
    if (rcBusy || closing || role !== 'client') return;
    rcBusy = true;
    try {
      const old = peer; peer = null; try { if (old) old.destroy(); } catch (e) {}
      const m = await clientConnect(S.code, lastNick);
      clearInterval(rcTimer); rcTimer = null; applySnap(m); fire('link', 'back');
    } catch (e) { if (++tries > 60) { clearInterval(rcTimer); rcTimer = null; fire('link', 'gone'); } }
    rcBusy = false;
  }, 3000);
}

async function joinGame(code, nick) {
  const rec = hostRecord(code);
  if (rec) {                       // this browser was hosting that game: pick it up again
    await resumeHost(rec);
    return { role: S.meta.status === 'lobby' ? 'lobby' : 'resume', meta: copy(S.meta) };
  }
  closeAll(); lastNick = nickOf(nick);
  const saved = LS.get('lcr_seat_' + code); if (saved) adoptUid(saved); else ensureUid();
  S = fresh(code); role = 'client';
  let snap;
  try { snap = await clientConnect(code, lastNick); }
  catch (e) { S = null; role = null; if (e && e.code === 'missing') return { role: 'missing' }; throw friendly(e); }
  applySnap(snap); LS.set('lcr_seat_' + code, uid);
  if (S.meta.status === 'lobby') return { role: 'lobby', meta: copy(S.meta) };
  return { role: S.state && S.state.players.some(p => p.id === uid) ? 'resume' : 'spectator', meta: copy(S.meta) };
}

/* ---------- the API the interface uses ---------- */
function init() {
  return Promise.resolve(typeof g.Peer === 'function' ? { ok: true, uid: ensureUid(), name: '', canWrite: true } : { ok: false, reason: 'unavailable' });
}
const getMeta = async () => (S && S.meta ? copy(S.meta) : null);
const getState = async () => (S && S.state ? copy(S.state) : null);
async function setAiCount(code, n) { if (role === 'host' && S) { S.meta.ai = n; pushMeta(); } }
async function leaveLobby(code) {
  const tok = S, later = () => { if (S === tok) closeAll(); };   // give the goodbye a moment to leave, unless a new game has started
  if (role === 'host') { hostConns.forEach((u, c) => send(c, { t: 'closed' })); LS.del('lcr_host'); setTimeout(later, 150); return; }
  if (role === 'client' && conn) { send(conn, { t: 'leave' }); setTimeout(later, 150); return; }
  closeAll();
}
async function renameInLobby(code, nick) {
  nick = nickOf(nick); if (!nick || !S) return;
  if (role === 'host') { if (S.joins[uid]) { S.joins[uid].nick = nick; pushJoins(); } } else send(conn, { t: 'rename', nick });
}
function sub(set, fn, now) { set.add(fn); if (now) setTimeout(() => { if (set.has(fn)) { try { now(); } catch (e) {} } }, 0); return () => set.delete(fn); }
function watchLobby(code, onMeta, onJoins, onError) {
  const a = sub(L.meta, onMeta, () => onMeta(S && S.meta ? copy(S.meta) : null));
  const b = sub(L.joins, onJoins, () => S && onJoins(joinRows()));
  const c = onError ? sub(L.err, onError) : () => {};
  return () => { a(); b(); c(); };
}
function watchState(code, onState, onError) {
  const a = sub(L.state, onState, () => { if (S && S.state) onState(copy(S.state)); });
  const b = onError ? sub(L.err, onError) : () => {};
  return () => { a(); b(); };
}
function watchMeta(code, onMeta, onError) {
  const a = sub(L.meta, onMeta, () => onMeta(S && S.meta ? copy(S.meta) : null));
  const b = onError ? sub(L.err, onError) : () => {};
  return () => { a(); b(); };
}
function commit(code, state) {
  if (!S) return Promise.reject(new Error('You are not in a game.'));
  if (role === 'host') { hostSetState(state, null); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    if (!conn || !conn.open) { reject(new Error('Not connected to the host right now. Reconnecting…')); return; }
    const id = ++seq;
    const to = setTimeout(() => { acks.delete(id); reject(new Error('The host did not answer.')); }, 8000);
    acks.set(id, ok => { clearTimeout(to); if (ok) resolve(); else reject(new Error('That move was out of date, so the board was refreshed.')); });
    send(conn, { t: 'commit', id, state });
  });
}
async function begin(code, state) {
  if (role !== 'host') throw new Error('Only the host can start the game.');
  hostSetState(state, null); S.meta.status = 'play'; pushMeta();
}
async function lease() { return role === 'host'; }   // the host's browser plays the computer players
function watchPresence(code, cb) { return sub(L.pres, cb, () => cb(new Set(S ? (role === 'host' ? onlineIds() : S.online) : []))); }
function clearPresence() {}
function onLink(fn) { return sub(L.link, fn); }

g.Net = { init, createGame, getMeta, getState, joinGame, setAiCount, leaveLobby, renameInLobby, watchLobby, watchState, watchMeta, commit, begin, lease, watchPresence, clearPresence, onLink,
  uid: () => uid, name: () => '', genCode, p2p: true };
})(typeof globalThis !== 'undefined' ? globalThis : window);
