/* Lion City Rails: rules engine. Pure functions over a JSON state, deterministic given state.rng. */
(function (g) {
'use strict';
const M = MAPDATA;
const COLORS = M.colors, NCOL = COLORS.length, WILD = NCOL;
const ROUTES = M.routes;
const NODES = {}; M.nodes.forEach(n => { NODES[n.id] = n; });
const TICKETS = M.tickets;
const SCORE = [0, 1, 2, 4, 7, 10, 15];
const SIB = ROUTES.map((r, i) => r.lanes < 2 ? -1 : ROUTES.findIndex((o, j) => j !== i && o.a === r.a && o.b === r.b));
const ADJ = {}; M.nodes.forEach(n => { ADJ[n.id] = []; });
ROUTES.forEach((r, i) => { ADJ[r.a].push({ to: r.b, ri: i }); ADJ[r.b].push({ to: r.a, ri: i }); });
const TRAINS = { 2: 34, 3: 32, 4: 28, 5: 24 };
const MAXLOG = 40;

function rnd(s) {
  s.rng = (s.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(s) * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const clone = s => JSON.parse(JSON.stringify(s));
function log(s, msg) { s.log.push(msg); if (s.log.length > MAXLOG) s.log.splice(0, s.log.length - MAXLOG); }
const nm = id => NODES[id].name;
const routeName = ri => nm(ROUTES[ri].a) + ' to ' + nm(ROUTES[ri].b);

function newGame(opts) {
  const seed = (opts.seed >>> 0) || 1;
  const n = opts.players.length;
  const s = {
    gid: seed, v: 0, rng: seed | 0, n,
    players: [], routes: ROUTES.map(() => -1),
    deck: [], discard: [], faceUp: [], ticketDeck: [],
    turn: 0, phase: 'setup', lastRound: null, over: false, result: null, passes: 0, log: [],
    trains: opts.trains || TRAINS[n] || 30, hostId: opts.hostId || null
  };
  for (let c = 0; c < NCOL; c++) for (let i = 0; i < 12; i++) s.deck.push(c);
  for (let i = 0; i < 14; i++) s.deck.push(WILD);
  shuffle(s, s.deck);
  s.ticketDeck = shuffle(s, TICKETS.map((_, i) => i));
  opts.players.forEach((pl, i) => {
    const p = { id: pl.id || null, kind: pl.kind || 'human', name: pl.name || ('Player ' + (i + 1)), seat: i,
      hand: new Array(NCOL + 1).fill(0), trains: s.trains, tickets: [], pending: s.ticketDeck.splice(0, 3), skill: pl.skill == null ? 0.8 : pl.skill };
    for (let k = 0; k < 4; k++) p.hand[s.deck.pop()]++;
    s.players.push(p);
  });
  for (let i = 0; i < 5; i++) s.faceUp.push(s.deck.pop());
  refill(s);
  log(s, 'Pick your starting destination tickets (keep at least 2).');
  return s;
}

function drawCard(s) {
  if (!s.deck.length && s.discard.length) { s.deck = shuffle(s, s.discard); s.discard = []; }
  return s.deck.length ? s.deck.pop() : -1;
}
function refill(s) {
  for (let guard = 0; guard < 6; guard++) {
    while (s.faceUp.length < 5) { const c = drawCard(s); if (c < 0) break; s.faceUp.push(c); }
    if (s.faceUp.filter(c => c === WILD).length >= 3 && (s.deck.length + s.discard.length) >= 3) {
      s.discard.push(...s.faceUp); s.faceUp = [];
      log(s, 'Three Express cards showed, so the market was reset.');
    } else break;
  }
}
const cardsLeft = s => s.deck.length + s.discard.length;

function laneState(s, pi, ri) {
  const o = s.routes[ri];
  if (o === pi) return 'mine';
  if (o !== -1) return 'blocked';
  if (ROUTES[ri].lanes === 2) {
    const sb = SIB[ri];
    if (s.routes[sb] === pi) return 'blocked';
    if (s.routes[sb] !== -1 && s.n < 4) return 'blocked';
  }
  return 'free';
}

function claimOptions(s, pi, ri) {
  const r = ROUTES[ri], p = s.players[pi];
  if (s.routes[ri] !== -1) return { err: 'Someone already owns this route.' };
  if (ROUTES[ri].lanes === 2) {
    const sb = SIB[ri];
    if (s.routes[sb] === pi) return { err: 'You already own the other lane of this route.' };
    if (s.routes[sb] !== -1 && s.n < 4) return { err: 'With fewer than 4 players only one lane of a double route can be used.' };
  }
  if (p.trains < r.len) return { err: 'You only have ' + p.trains + ' trains left.' };
  const need = r.len, minW = r.flags === 'F1' ? 1 : 0, w = p.hand[WILD];
  const cols = r.color === 'grey' ? COLORS.map((_, i) => i) : [COLORS.indexOf(r.color)];
  const out = [], seen = new Set();
  for (const c of cols) {
    const have = p.hand[c];
    const k = Math.max(minW, need - have);
    if (k > w || k > need) continue;
    const key = k === need ? 'w' : 'c' + c;
    if (seen.has(key)) continue; seen.add(key);
    out.push(k === need ? { color: -1, n: 0, wild: need } : { color: c, n: need - k, wild: k });
  }
  if (!out.length) {
    const col = r.color === 'grey' ? 'cards of one colour' : COLORS[cols[0]] + ' cards';
    return { err: 'You need ' + need + ' ' + col + (minW ? ' including an Express card' : '') + '.' };
  }
  return { options: out };
}

function claimRoute(s, pi, ri, pay) {
  if (s.over) return { err: 'The game is over.' };
  if (s.turn !== pi) return { err: 'It is not your turn.' };
  if (s.phase !== 'main') return { err: 'Finish your current action first.' };
  const co = claimOptions(s, pi, ri);
  if (co.err) return co;
  const ok = co.options.find(o => o.color === pay.color && o.wild === pay.wild);
  if (!ok) return { err: 'That payment does not fit this route.' };
  const p = s.players[pi], r = ROUTES[ri];
  if (ok.color >= 0) { p.hand[ok.color] -= ok.n; for (let i = 0; i < ok.n; i++) s.discard.push(ok.color); }
  p.hand[WILD] -= ok.wild; for (let i = 0; i < ok.wild; i++) s.discard.push(WILD);
  p.trains -= r.len; s.routes[ri] = pi;
  log(s, p.name + ' claimed ' + routeName(ri) + ' (+' + SCORE[r.len] + ').');
  s.passes = 0;
  endTurn(s);
  return { ok: true, ri };
}

function afterFirstDraw(s) {
  const canSecond = s.faceUp.some(c => c !== WILD) || s.deck.length + s.discard.length > 0;
  if (canSecond) { s.phase = 'drew1'; s.v++; } else endTurn(s);
}
function drawFaceUp(s, pi, idx) {
  if (s.over) return { err: 'The game is over.' };
  if (s.turn !== pi) return { err: 'It is not your turn.' };
  if (s.phase !== 'main' && s.phase !== 'drew1') return { err: 'Finish your current action first.' };
  const c = s.faceUp[idx];
  if (c == null) return { err: 'No card there.' };
  if (c === WILD && s.phase === 'drew1') return { err: 'An Express card can only be taken as your first and only draw.' };
  const p = s.players[pi];
  p.hand[c]++; s.faceUp.splice(idx, 1); refill(s); s.passes = 0;
  if (s.phase === 'drew1') { log(s, p.name + ' took a second card.'); endTurn(s); }
  else if (c === WILD) { log(s, p.name + ' took an Express card.'); endTurn(s); }
  else { log(s, p.name + ' took a ' + COLORS[c] + ' card.'); afterFirstDraw(s); }
  return { ok: true, card: c };
}
function drawDeck(s, pi) {
  if (s.over) return { err: 'The game is over.' };
  if (s.turn !== pi) return { err: 'It is not your turn.' };
  if (s.phase !== 'main' && s.phase !== 'drew1') return { err: 'Finish your current action first.' };
  const c = drawCard(s);
  if (c < 0) return { err: 'No cards left in the deck.' };
  const p = s.players[pi];
  p.hand[c]++; s.passes = 0;
  if (s.phase === 'drew1') { log(s, p.name + ' drew a card from the deck.'); endTurn(s); }
  else { log(s, p.name + ' drew a card from the deck.'); afterFirstDraw(s); }
  return { ok: true, card: c };
}
function drawTickets(s, pi) {
  if (s.over) return { err: 'The game is over.' };
  if (s.turn !== pi) return { err: 'It is not your turn.' };
  if (s.phase !== 'main') return { err: 'Finish your current action first.' };
  if (!s.ticketDeck.length) return { err: 'No destination tickets left.' };
  const p = s.players[pi];
  p.pending = s.ticketDeck.splice(0, 3);
  s.phase = 'tickets'; s.passes = 0; s.v++;
  log(s, p.name + ' is choosing destination tickets.');
  return { ok: true };
}
function keepTickets(s, pi, keep) {
  if (s.over) return { err: 'The game is over.' };
  if (s.turn !== pi) return { err: 'It is not your turn.' };
  if (s.phase !== 'setup' && s.phase !== 'tickets') return { err: 'No tickets to choose right now.' };
  const p = s.players[pi];
  const min = s.phase === 'setup' ? 2 : 1;
  const k = keep.filter(t => p.pending.includes(t));
  if (new Set(k).size !== k.length) return { err: 'Duplicate ticket.' };
  if (k.length < Math.min(min, p.pending.length)) return { err: 'Keep at least ' + min + ' ticket' + (min > 1 ? 's' : '') + '.' };
  p.tickets.push(...k);
  const back = p.pending.filter(t => !k.includes(t));
  s.ticketDeck.push(...back);
  p.pending = [];
  s.passes = 0;
  if (s.phase === 'setup') {
    log(s, p.name + ' kept ' + k.length + ' tickets.');
    s.turn++;
    if (s.turn >= s.n) { s.turn = 0; s.phase = 'main'; log(s, 'The game begins. ' + s.players[0].name + ' goes first.'); }
    s.v++;
  } else {
    log(s, p.name + ' kept ' + k.length + ' of ' + (k.length + back.length) + ' tickets.');
    endTurn(s);
  }
  return { ok: true };
}

function movesAvailable(s, pi) {
  if (s.phase === 'drew1') return s.faceUp.some(c => c !== WILD) || cardsLeft(s) > 0;
  if (s.faceUp.length || cardsLeft(s) > 0 || s.ticketDeck.length) return true;
  return ROUTES.some((_, ri) => !claimOptions(s, pi, ri).err);
}
function pass(s, pi) {
  if (s.turn !== pi || s.over) return { err: 'Not your turn.' };
  if (s.phase === 'main' && movesAvailable(s, pi)) return { err: 'You still have a move.' };
  log(s, s.players[pi].name + ' had no move and passed.');
  s.passes++;
  endTurn(s);
  return { ok: true };
}

function endTurn(s) {
  const p = s.players[s.turn];
  if (s.passes >= s.n) { finish(s); return; }
  if (!s.lastRound && p.trains <= 2) {
    s.lastRound = { left: s.n - 1 };
    log(s, p.name + ' is nearly out of trains. Everyone else gets one last turn.');
  } else if (s.lastRound) {
    s.lastRound.left--;
    if (s.lastRound.left <= 0) { finish(s); return; }
  }
  s.turn = (s.turn + 1) % s.n; s.phase = 'main'; s.v++;
}

function connected(s, pi, a, b) {
  const seen = new Set([a]), st = [a];
  while (st.length) {
    const u = st.pop(); if (u === b) return true;
    for (const e of ADJ[u]) if (s.routes[e.ri] === pi && !seen.has(e.to)) { seen.add(e.to); st.push(e.to); }
  }
  return a === b;
}
function routePoints(s, pi) {
  let t = 0; s.routes.forEach((o, i) => { if (o === pi) t += SCORE[ROUTES[i].len]; }); return t;
}
function longestPath(s, pi) {
  const mine = []; s.routes.forEach((o, i) => { if (o === pi) mine.push(i); });
  const adj = {};
  mine.forEach(i => { const r = ROUTES[i]; (adj[r.a] = adj[r.a] || []).push({ to: r.b, ri: i, len: r.len }); (adj[r.b] = adj[r.b] || []).push({ to: r.a, ri: i, len: r.len }); });
  let best = 0; const used = new Set();
  function dfs(u, acc) {
    if (acc > best) best = acc;
    for (const e of (adj[u] || [])) if (!used.has(e.ri)) { used.add(e.ri); dfs(e.to, acc + e.len); used.delete(e.ri); }
  }
  Object.keys(adj).forEach(u => dfs(u, 0));
  return best;
}
function finalScores(s) {
  const res = s.players.map((p, pi) => {
    const rp = routePoints(s, pi);
    let tp = 0, done = 0, failed = 0; const list = [];
    p.tickets.forEach(ti => { const t = TICKETS[ti]; const ok = connected(s, pi, t.a, t.b); list.push({ ti, ok }); if (ok) { tp += t.pts; done++; } else { tp -= t.pts; failed++; } });
    return { pi, routePts: rp, ticketPts: tp, done, failed, list, longest: longestPath(s, pi), bonus: 0, total: 0, trains: p.trains };
  });
  const mx = Math.max(...res.map(r => r.longest));
  res.forEach(r => { if (mx > 0 && r.longest === mx) r.bonus = 10; r.total = r.routePts + r.ticketPts + r.bonus; });
  const top = Math.max(...res.map(r => r.total));
  let winners = res.filter(r => r.total === top);
  if (winners.length > 1) { const m = Math.max(...winners.map(r => r.done)); winners = winners.filter(r => r.done === m); }
  if (winners.length > 1) { const m = Math.max(...winners.map(r => r.bonus)); winners = winners.filter(r => r.bonus === m); }
  return { rows: res, winners: winners.map(r => r.pi) };
}
function finish(s) {
  s.over = true; s.phase = 'over'; s.result = finalScores(s); s.v++;
  log(s, 'Game over. ' + s.result.winners.map(i => s.players[i].name).join(' and ') + ' won.');
}

/* path planning helpers (used by AI and UI hints) */
function bestPath(s, pi, a, b, extraCost) {
  const D = {}, prev = {}; D[a] = 0; const q = [[0, a]];
  while (q.length) {
    q.sort((x, y) => x[0] - y[0]); const [d, u] = q.shift();
    if (d > D[u]) continue; if (u === b) break;
    for (const e of ADJ[u]) {
      const st = laneState(s, pi, e.ri);
      let c;
      if (st === 'mine') c = 0; else if (st === 'free') c = ROUTES[e.ri].len + 0.01; else {
        // look for other lane for same pair
        continue;
      }
      if (extraCost && extraCost[e.ri]) c += extraCost[e.ri];
      const nd = d + c;
      if (nd < (D[e.to] == null ? 1e9 : D[e.to])) { D[e.to] = nd; prev[e.to] = { u, ri: e.ri }; q.push([nd, e.to]); }
    }
  }
  if (D[b] == null) return null;
  const edges = []; let x = b; while (x !== a) { edges.push(prev[x].ri); x = prev[x].u; }
  edges.reverse();
  return { cost: D[b], edges };
}
function legalClaims(s, pi) {
  const out = [];
  ROUTES.forEach((_, ri) => { const o = claimOptions(s, pi, ri); if (!o.err) out.push({ ri, options: o.options }); });
  return out;
}

g.Engine = { COLORS, NCOL, WILD, ROUTES, NODES, TICKETS, SCORE, SIB, ADJ, TRAINS, newGame, clone, claimOptions, claimRoute, drawFaceUp, drawDeck, drawTickets, keepTickets, pass,
  movesAvailable, connected, routePoints, longestPath, finalScores, bestPath, legalClaims, laneState, routeName, rnd, shuffle, cardsLeft };
})(typeof globalThis !== 'undefined' ? globalThis : window);
