/* Lion City Rails: online layer over public MQTT brokers (secure WebSockets).
   The host's browser holds the game and is the referee. Friends find it with the 4-letter code, send their moves to it,
   and the host passes every change on to everyone. The brokers are only message relays (they never see anything but
   small game messages), so it works over ordinary secure web connections, including mobile data and strict Wi-Fi.
   Every game lives under its own topic: lioncityrails/v1/<CODE>/... */
(function (g) {
'use strict';
const PREFIX = 'lioncityrails/v1/';
const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = n => Array.from({ length: n }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const genCode = () => rnd(4);
const qp = (() => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(''); } })();
const brokers = () => { const b = qp.get('broker'); return b ? b.split(',').filter(Boolean) : DEFAULT_BROKERS; };   // ?broker=wss://your-broker:port/mqtt uses your own broker (comma-separate several)
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const clean = (s, n) => String(s == null ? '' : s).replace(/[^\w-]/g, '').slice(0, n);
const nickOf = s => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
const copy = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const parse = b => { try { return JSON.parse(b.toString()); } catch (e) { return null; } };

/* ---------- identity: an id and a secret per browser tab (two tabs can be two players); the secret keeps seats from being hijacked ---------- */
let uid = null, key = null;
const cid = 'c' + rnd(12).toLowerCase();   // this page load, used for private replies
function ensureId() {
  if (uid && key) return uid;
  let u = null, k = null; try { u = sessionStorage.getItem('lcr_uid'); k = sessionStorage.getItem('lcr_key'); } catch (e) {}
  if (!u || !k) { u = 'u' + rnd(12).toLowerCase(); k = rnd(20).toLowerCase(); try { sessionStorage.setItem('lcr_uid', u); sessionStorage.setItem('lcr_key', k); } catch (e) {} }
  uid = u; key = k; return uid;
}
function adopt(u, k) { uid = u; key = k; try { sessionStorage.setItem('lcr_uid', u); sessionStorage.setItem('lcr_key', k); } catch (e) {} }
const saveSeat = code => LS.set('lcr_seat_' + code, JSON.stringify({ uid, key }));
const loadSeat = code => { try { const o = JSON.parse(LS.get('lcr_seat_' + code) || 'null'); return o && o.uid && o.key ? o : null; } catch (e) { return null; } };

/* ---------- replicated game record (the host owns it; everyone else holds a copy) ---------- */
let S = null, role = null, C = null, closing = false, seq = 0, lastNick = '', lastHost = 0, lostFlag = false, lostTries = 0, snapWait = null;
let hostTimer = null, clientTimer = null, wl = null, graceful = false;
const peers = new Map();   // host side: player id -> { cid, seen }
const acks = new Map();
const L = { meta: new Set(), joins: new Set(), state: new Set(), pres: new Set(), err: new Set(), link: new Set() };
const fire = (k, ...a) => Array.from(L[k]).forEach(fn => { try { fn(...a); } catch (e) {} });
const fresh = code => ({ code, meta: null, joins: {}, state: null, online: [], keys: {} });
const joinRows = () => Object.keys(S.joins).map(u => Object.assign({ uid: u }, S.joins[u])).sort((a, b) => (a.at - b.at) || (a.uid < b.uid ? -1 : 1));
const T = code => ({ st: PREFIX + code + '/st', h: PREFIX + code + '/h', all: PREFIX + code + '/all', d: id => PREFIX + code + '/d/' + id });
const pub = (c, topic, obj, opts) => { try { if (c) c.publish(topic, JSON.stringify(obj), Object.assign({ qos: 1 }, opts || {})); } catch (e) {} };

function friendly(e) {
  const t = e && e.code;
  if (t === 'noconn') return new Error('Found the game, but the host did not answer. Ask the host to keep the game open and in view (not minimised, asleep or in another tab), then try again.');
  if (t === 'denied') return new Error('That seat is already in use by another device.');
  return new Error('Could not reach the online connection service. Check your internet connection and try again. Some work or school networks block it.');
}

/* ---------- broker plumbing ---------- */
function openBroker(url, opts) {
  return new Promise((resolve, reject) => {
    let done = false, c;
    const fail = e => { if (done) return; done = true; clearTimeout(to); try { c.end(true); } catch (er) {} reject(e || new Error('broker')); };
    try { c = g.mqtt.connect(url, Object.assign({ clientId: 'lcr-' + rnd(14), clean: true, keepalive: 30, reconnectPeriod: 0, connectTimeout: 8000, protocolVersion: 4 }, opts || {})); } catch (e) { reject(e); return; }
    const to = setTimeout(() => fail(new Error('timeout')), 9000);
    c.once('connect', () => { if (done) return; done = true; clearTimeout(to); c.options.reconnectPeriod = 2000; resolve(c); });
    c.once('error', fail); c.once('close', () => fail(new Error('closed')));
  });
}
async function connectAny(opts) {
  let err = null;
  for (const u of brokers()) { try { return { c: await openBroker(u, opts), u }; } catch (e) { err = e; } }
  throw err || new Error('no broker');
}
function peek(c, topic, ms) {   // read a retained message, if there is one
  return new Promise(res => {
    let done = false;
    const end = v => { if (done) return; done = true; clearTimeout(to); c.removeListener('message', on); try { c.unsubscribe(topic); } catch (e) {} res(v); };
    const on = (t, b) => { if (t === topic) end(parse(b)); };
    const to = setTimeout(() => end(null), ms);
    c.on('message', on); c.subscribe(topic, { qos: 1 });
  });
}
function killClient() {
  clearInterval(hostTimer); hostTimer = null; clearInterval(clientTimer); clientTimer = null;
  try { if (wl) wl.release(); } catch (e) {} wl = null;
  const c = C; C = null; peers.clear();
  if (c) { try { c.removeAllListeners('message'); c.end(!graceful); } catch (e) {} }
}
function closeAll() {
  closing = true; killClient(); acks.forEach(f => { try { f(false); } catch (e) {} }); acks.clear(); snapWait = null;
  S = null; role = null; lostFlag = false; lostTries = 0; closing = false;
}

/* ---------- host ---------- */
function persist() {
  if (role !== 'host' || !S) return;
  LS.set('lcr_host', JSON.stringify({ code: S.code, saved: Date.now(), meta: S.meta, joins: S.joins, state: S.state, keys: S.keys }));
}
const onlineIds = () => { const s = new Set([S.meta.host]); peers.forEach((p, u) => s.add(u)); return Array.from(s); };
const toCid = (to, obj) => pub(C, T(S.code).d(to), obj);
const toAll = obj => pub(C, T(S.code).all, obj);
function pushPresence() { const ids = onlineIds(); S.online = ids; toAll({ t: 'pres', ids }); fire('pres', new Set(ids)); }
function pushJoins() { persist(); toAll({ t: 'joins', v: S.joins }); fire('joins', joinRows()); }
function pushMeta() { persist(); toAll({ t: 'meta', v: S.meta }); fire('meta', copy(S.meta)); }
function validState(st) { return !!st && typeof st === 'object' && Array.isArray(st.players) && typeof st.v === 'number' && st.gid != null && Array.isArray(st.routes); }
function hostSetState(st) { S.state = st; persist(); toAll({ t: 'state', v: st }); fire('state', copy(st)); }
function dropPeer(u) {
  if (!peers.delete(u) || !S) return false;
  if (S.meta.status === 'lobby' && u !== S.meta.host && S.joins[u]) { delete S.joins[u]; pushJoins(); }
  return true;
}
function wake() {   // keep a phone or laptop awake while hosting, so the game stays visible to friends
  try { if (navigator.wakeLock && role === 'host' && !wl) navigator.wakeLock.request('screen').then(l => { wl = l; l.addEventListener('release', () => { wl = null; }); }, () => {}); } catch (e) {}
}
try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); }); } catch (e) {}

async function startHost(code) {
  const t = T(code);
  let r;
  try { r = await connectAny({ will: { topic: t.st, payload: JSON.stringify({ on: false }), qos: 1, retain: true } }); } catch (e) { throw friendly(e); }
  const c = C = r.c;
  c.on('message', (topic, buf) => { if (topic === t.h) hostMsg(parse(buf)); });
  c.subscribe(t.h, { qos: 1 });
  const announce = () => pub(c, t.st, { on: true, at: Date.now() }, { retain: true });
  announce();
  c.on('close', () => { if (!closing && C === c) fire('link', 'brokerlost'); });
  c.on('connect', () => { if (C === c) { announce(); fire('link', 'brokerback'); } });
  clearInterval(hostTimer);
  hostTimer = setInterval(() => {
    if (C !== c || !S) return;
    announce(); toAll({ t: 'hb' });
    const now = Date.now(); let gone = false;
    peers.forEach((p, u) => { if (now - p.seen > 50000) { dropPeer(u); gone = true; } });
    if (gone) pushPresence();
  }, 8000);
  wake();
}
function hostMsg(m) {
  if (!S || role !== 'host' || !m || typeof m !== 'object') return;
  const rc = clean(m.cid, 24); if (!rc) return;
  if (m.t === 'gone') {   // the broker announces a player's lost connection for them
    let any = false; peers.forEach((p, u) => { if (p.cid === rc) { dropPeer(u); any = true; } });
    if (any) pushPresence();
    return;
  }
  let id = clean(m.uid, 40), k = clean(m.k, 40); if (!id || !k) return;
  if (m.t === 'hello') {
    const seat = clean(m.seat, 40), seatKey = clean(m.seatKey, 40);   // a returning player on a new tab proves it is them with the old seat's secret
    if (seat && seat !== id && S.state && !S.state.players.some(p => p.id === id) && S.state.players.some(p => p.id === seat) && seat !== S.meta.host && S.keys[seat] && S.keys[seat] === seatKey) { id = seat; k = seatKey; }
    else if (S.keys[id] && S.keys[id] !== k) { toCid(rc, { t: 'denied' }); return; }
    S.keys[id] = k;
    const old = peers.get(id); if (old && old.cid !== rc) toCid(old.cid, { t: 'replaced' });
    peers.set(id, { cid: rc, seen: Date.now() });
    let changed = false;
    if (S.meta.status === 'lobby') {
      const nick = nickOf(m.nick) || 'Player';
      if (!S.joins[id]) { if (Object.keys(S.joins).length < 12) { S.joins[id] = { nick, at: Date.now() }; changed = true; } }
      else if (S.joins[id].nick !== nick) { S.joins[id].nick = nick; changed = true; }
    }
    toCid(rc, { t: 'snap', meta: S.meta, joins: S.joins, state: S.state, ids: onlineIds(), you: id });
    if (changed) pushJoins(); else persist();
    pushPresence();
    return;
  }
  const p = peers.get(id);
  if (!p || p.cid !== rc || S.keys[id] !== k) { toCid(rc, { t: 'rehello' }); return; }   // we do not know this sender (host reloaded?): ask them to say hello again
  p.seen = Date.now();
  if (m.t === 'leave') {
    peers.delete(id);
    if (S.meta.status === 'lobby' && id !== S.meta.host && S.joins[id]) { delete S.joins[id]; pushJoins(); }
    pushPresence();
  } else if (m.t === 'rename') {
    const nick = nickOf(m.nick);
    if (S.meta.status === 'lobby' && S.joins[id] && nick) { S.joins[id].nick = nick; pushJoins(); }
  } else if (m.t === 'commit') {
    const st = m.state, cur = S.state;
    const ok = validState(st) && !!cur && (st.gid !== cur.gid ? id === S.meta.host : st.v > cur.v) && (id === S.meta.host || cur.players.some(q => q.id === id));
    toCid(rc, { t: 'ack', id: m.id, ok });
    if (ok) hostSetState(st); else if (cur) toCid(rc, { t: 'state', v: cur });
  }
}

async function createGame(nick) {
  closeAll(); ensureId(); lastNick = nickOf(nick);
  let probe;
  try { probe = await connectAny({}); } catch (e) { throw friendly(e); }
  let code = null;
  try {
    for (let i = 0; i < 8 && !code; i++) {   // a code is free unless a live game is using it
      const cand = genCode(), st = await peek(probe.c, T(cand).st, 1500);
      if (!st || st.on !== true) code = cand;
    }
  } finally { try { probe.c.end(true); } catch (e) {} }
  if (!code) throw new Error('Could not find a free game code. Try again.');
  S = fresh(code); role = 'host';
  S.meta = { host: uid, status: 'lobby', created: Date.now(), ai: 1 };
  S.joins[uid] = { nick: lastNick || 'Host', at: Date.now() }; S.keys[uid] = key;
  try { await startHost(code); } catch (e) { S = null; role = null; throw e; }
  persist(); saveSeat(code);
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
  closeAll();
  const k = rec.keys && rec.keys[rec.meta.host]; adopt(rec.meta.host, k || rnd(20).toLowerCase());
  S = fresh(rec.code); role = 'host'; S.meta = rec.meta; S.joins = rec.joins; S.state = rec.state; S.keys = rec.keys || {}; S.keys[uid] = key; S.online = [uid];
  try { await startHost(rec.code); } catch (e) { S = null; role = null; throw e; }
  persist();
}

/* ---------- client ---------- */
function applySnap(m) {
  if (m.you && m.you !== uid) {   // we were given our old seat back
    const seat = loadSeat(S.code); if (seat && seat.uid === m.you) adopt(seat.uid, seat.key);
  }
  saveSeat(S.code);
  S.meta = m.meta; S.joins = m.joins || {}; S.state = m.state || null; S.online = m.ids || [];
  fire('meta', copy(S.meta)); fire('joins', joinRows()); if (S.state) fire('state', copy(S.state)); fire('pres', new Set(S.online));
}
function hello() {
  if (!C || !S) return;
  const seat = loadSeat(S.code);
  pub(C, T(S.code).h, { t: 'hello', cid, uid, k: key, nick: lastNick, seat: seat && seat.uid !== uid ? seat.uid : null, seatKey: seat && seat.uid !== uid ? seat.key : null });
}
function clientMsg(m) {
  if (!S || !m || typeof m !== 'object') return;
  if (m.t === 'snap') {
    if (snapWait) { const f = snapWait; snapWait = null; f(m); }
    else { applySnap(m); if (lostFlag) { lostFlag = false; lostTries = 0; fire('link', 'back'); } }
  }
  else if (m.t === 'meta') { S.meta = m.v; fire('meta', copy(S.meta)); }
  else if (m.t === 'joins') { S.joins = m.v || {}; fire('joins', joinRows()); }
  else if (m.t === 'state') { if (validState(m.v)) { S.state = m.v; fire('state', copy(S.state)); } }
  else if (m.t === 'pres') { S.online = m.ids || []; fire('pres', new Set(S.online)); }
  else if (m.t === 'ack') { const f = acks.get(m.id); if (f) { acks.delete(m.id); f(!!m.ok); } }
  else if (m.t === 'rehello') hello();
  else if (m.t === 'denied') { if (snapWait) { const f = snapWait; snapWait = null; f({ t: 'denied' }); } }
  else if (m.t === 'replaced' || m.t === 'closed') {
    const why = m.t === 'closed' ? 'The host closed this game.' : 'This game was opened in another tab.';
    closing = true; fire('err', new Error(why)); fire('link', 'gone'); killClient(); closing = false;
  }
}
function findGame(code) {   // look for the game on every broker at once; the one that has it live wins
  const t = T(code), will = { topic: t.h, payload: JSON.stringify({ t: 'gone', cid }), qos: 1 };
  return new Promise((resolve, reject) => {
    const urls = brokers(); let pending = urls.length, finished = false, seenOff = false, anyUp = false; const made = [];
    const finish = (r, err) => {
      if (finished) return; finished = true;
      made.forEach(c => { if (!r || r.c !== c) { try { c.end(true); } catch (e) {} } });
      if (r) resolve(r); else reject(err);
    };
    const settle = () => { if (--pending === 0 && !finished) { if (anyUp) finish({ status: seenOff ? 'offline' : 'none' }); else finish(null, new Error('brokers')); } };
    urls.forEach(u => {
      openBroker(u, { will }).then(c => {
        anyUp = true; made.push(c);
        if (finished) { try { c.end(true); } catch (e) {} return; }
        peek(c, t.st, 3500).then(st => {
          if (finished) return;
          if (st && st.on === true) finish({ status: 'on', c, u }); else { if (st && !st.closed) seenOff = true; settle(); }
        });
      }, settle);
    });
  });
}
function wireClient(code) {
  const t = T(code), c = C; let stOn = true;
  lastHost = Date.now();
  c.on('message', (topic, buf) => {
    if (C !== c) return;
    const m = parse(buf);
    if (topic === t.st) {
      if (!m) return;
      if (m.on === false) { stOn = false; if (!lostFlag) { lostFlag = true; fire('err', new Error('The host went offline.')); fire('link', 'lost'); } }
      else if (m.on === true && (!stOn || lostFlag)) { stOn = true; hello(); }
      return;
    }
    lastHost = Date.now(); clientMsg(m);
  });
  c.subscribe([t.all, t.d(cid), t.st], { qos: 1 });
  c.on('close', () => { if (!closing && C === c && !lostFlag) { lostFlag = true; fire('err', new Error('Lost the connection.')); fire('link', 'lost'); } });
  c.on('connect', () => { if (C === c) hello(); });
  clearInterval(clientTimer);
  clientTimer = setInterval(() => {
    if (C !== c || !S) return;
    pub(c, t.h, { t: 'ping', cid, uid, k: key }, { qos: 0 });
    if (!lostFlag && Date.now() - lastHost > 26000) { lostFlag = true; fire('err', new Error('The host stopped answering.')); fire('link', 'lost'); }
    if (lostFlag) { hello(); if (++lostTries > 120) { clearInterval(clientTimer); fire('link', 'gone'); } }
  }, 5000);
}

async function joinGame(code, nick, opts) {
  const rec = hostRecord(code);
  let mine = null; try { mine = sessionStorage.getItem('lcr_uid'); } catch (e) {}
  if (rec && ((opts && opts.resume) || mine === rec.meta.host)) {   // this browser was hosting that game: pick it up again
    await resumeHost(rec);
    return { role: S.meta.status === 'lobby' ? 'lobby' : 'resume', meta: copy(S.meta) };
  }
  closeAll(); lastNick = nickOf(nick); ensureId();
  S = fresh(code); role = 'client';
  let found;
  try { found = await findGame(code); } catch (e) { S = null; role = null; throw friendly(e); }
  if (found.status !== 'on') { S = null; role = null; return { role: found.status === 'offline' ? 'offline' : 'missing' }; }
  C = found.c;
  const snap = await new Promise(resolve => {
    snapWait = resolve; wireClient(code);
    hello(); const again = setInterval(() => { if (snapWait) hello(); else clearInterval(again); }, 3500);
    setTimeout(() => { if (snapWait) { snapWait = null; resolve(null); } clearInterval(again); }, 12000);
  });
  if (!snap || snap.t === 'denied') { const e = friendly({ code: snap ? 'denied' : 'noconn' }); killClient(); S = null; role = null; throw e; }
  applySnap(snap);
  if (S.meta.status === 'lobby') return { role: 'lobby', meta: copy(S.meta) };
  return { role: S.state && S.state.players.some(p => p.id === uid) ? 'resume' : 'spectator', meta: copy(S.meta) };
}

/* ---------- the API the interface uses ---------- */
function init() {
  return Promise.resolve(typeof g.mqtt === 'object' && g.mqtt && typeof g.mqtt.connect === 'function' ? { ok: true, uid: ensureId(), name: '', canWrite: true } : { ok: false, reason: 'unavailable' });
}
const getMeta = async () => (S && S.meta ? copy(S.meta) : null);
const getState = async () => (S && S.state ? copy(S.state) : null);
async function setAiCount(code, n) { if (role === 'host' && S) { S.meta.ai = n; pushMeta(); } }
async function leaveLobby(code) {
  const tok = S, later = () => { if (S === tok) closeAll(); };   // give the goodbye a moment to leave, unless a new game has started
  if (role === 'host') { toAll({ t: 'closed' }); pub(C, T(S.code).st, { on: false, closed: true }, { retain: true }); LS.del('lcr_host'); setTimeout(() => { graceful = true; later(); graceful = false; }, 400); return; }
  if (role === 'client' && C) { pub(C, T(S.code).h, { t: 'leave', cid, uid, k: key }); setTimeout(later, 400); return; }
  closeAll();
}
async function renameInLobby(code, nick) {
  nick = nickOf(nick); if (!nick || !S) return;
  if (role === 'host') { if (S.joins[uid]) { S.joins[uid].nick = nick; pushJoins(); } } else pub(C, T(S.code).h, { t: 'rename', cid, uid, k: key, nick });
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
  if (role === 'host') { hostSetState(state); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    if (!C || !C.connected) { reject(new Error('Not connected to the host right now. Reconnecting…')); return; }
    const id = ++seq;
    const to = setTimeout(() => { acks.delete(id); reject(new Error('The host did not answer.')); }, 8000);
    acks.set(id, ok => { clearTimeout(to); if (ok) resolve(); else reject(new Error('That move was out of date, so the board was refreshed.')); });
    pub(C, T(S.code).h, { t: 'commit', cid, uid, k: key, id, state });
  });
}
async function begin(code, state) {
  if (role !== 'host') throw new Error('Only the host can start the game.');
  hostSetState(state); S.meta.status = 'play'; pushMeta();
}
async function lease() { return role === 'host'; }   // the host's browser plays the computer players
function watchPresence(code, cb) { return sub(L.pres, cb, () => cb(new Set(S ? (role === 'host' ? onlineIds() : S.online) : []))); }
function clearPresence() {}
function onLink(fn) { return sub(L.link, fn); }

g.Net = { init, createGame, getMeta, getState, joinGame, setAiCount, leaveLobby, renameInLobby, watchLobby, watchState, watchMeta, commit, begin, lease, watchPresence, clearPresence, onLink,
  uid: () => uid, name: () => '', genCode, p2p: true };
})(typeof globalThis !== 'undefined' ? globalThis : window);
