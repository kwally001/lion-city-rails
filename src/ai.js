/* Lion City Rails: computer opponents. */
(function (g) {
'use strict';
const E = g.Engine;
const { COLORS, WILD, ROUTES, TICKETS, SCORE } = E;

function ticketCost(s, pi, ti) {
  const t = TICKETS[ti]; const p = E.bestPath(s, pi, t.a, t.b); return p ? p.cost : 99;
}

function makePlan(s, pi) {
  const p = s.players[pi];
  const goals = p.tickets.filter(ti => { const t = TICKETS[ti]; return !E.connected(s, pi, t.a, t.b); })
    .map(ti => ({ ti, pts: TICKETS[ti].pts, path: E.bestPath(s, pi, TICKETS[ti].a, TICKETS[ti].b) }))
    .filter(x => x.path).sort((a, b) => b.pts - a.pts);
  const need = new Map(); let cost = 0; const used = new Set();
  const kept = [];
  for (const gl of goals) {
    const add = gl.path.edges.filter(ri => s.routes[ri] !== pi && !used.has(ri));
    const c = add.reduce((a, ri) => a + ROUTES[ri].len, 0);
    if (cost + c > p.trains) continue;
    cost += c; kept.push(gl);
    gl.path.edges.forEach(ri => { if (s.routes[ri] === pi) return; used.add(ri); need.set(ri, (need.get(ri) || 0) + gl.pts); });
  }
  return { goals: kept, need, cost };
}

function chooseTickets(s, pi) {
  const p = s.players[pi]; const setup = s.phase === 'setup';
  const min = setup ? 2 : 1;
  const plan = makePlan(s, pi);
  const room = Math.max(0, p.trains * 0.85 - plan.cost);
  const sc = p.pending.map(ti => { const c = ticketCost(s, pi, ti); return { ti, c, ratio: TICKETS[ti].pts / Math.max(c, 1) }; })
    .sort((a, b) => b.ratio - a.ratio);
  const keep = []; let spent = 0;
  for (const x of sc) {
    if (spent + x.c <= room || keep.length < min) { keep.push(x.ti); spent += x.c; }
  }
  return keep;
}

function desire(s, pi, plan) {
  const p = s.players[pi]; const d = new Array(COLORS.length).fill(0);
  const routes = [];
  if (plan.need.size) plan.need.forEach((w, ri) => routes.push({ ri, w }));
  else {
    // no goals: aim for long, valuable routes
    ROUTES.forEach((r, ri) => { if (E.laneState(s, pi, ri) === 'free' && r.len >= 3 && r.len <= p.trains) routes.push({ ri, w: SCORE[r.len] }); });
    routes.sort((a, b) => b.w - a.w); routes.length = Math.min(routes.length, 4);
  }
  routes.forEach(({ ri, w }) => {
    const r = ROUTES[ri];
    let c;
    if (r.color === 'grey') { let best = 0, bv = -1; for (let i = 0; i < COLORS.length; i++) if (p.hand[i] > bv) { bv = p.hand[i]; best = i; } c = best; }
    else c = COLORS.indexOf(r.color);
    const missing = Math.max(0, r.len - p.hand[c] - (r.color === 'grey' ? 0 : 0));
    d[c] += (missing > 0 ? missing : 0.3) * (1 + w / 25);
  });
  return d;
}

function pickDraw(s, pi, plan, first, R) {
  const p = s.players[pi]; const d = desire(s, pi, plan);
  const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.filter(x => x > 0).length);
  let bestIdx = -1, bestV = 0.9;
  s.faceUp.forEach((c, i) => {
    let v;
    if (c === WILD) { if (!first) return; v = p.hand[WILD] >= 4 ? 0 : avg * 0.95 + 0.6; } else v = d[c];
    v += R() * 0.25;
    if (v > bestV) { bestV = v; bestIdx = i; }
  });
  return bestIdx;
}

function choosePay(s, pi, options, plan) {
  const d = desire(s, pi, plan);
  return options.slice().sort((a, b) => (a.wild - b.wild) || ((a.color < 0 ? 0 : d[a.color]) - (b.color < 0 ? 0 : d[b.color])))[0];
}

function drawStep(s, pi, plan, first, R) {
  const idx = pickDraw(s, pi, plan, first, R);
  let r;
  if (idx >= 0) r = E.drawFaceUp(s, pi, idx);
  else { r = E.drawDeck(s, pi); if (r.err) { const k = s.faceUp.findIndex(c => first || c !== WILD); if (k >= 0) r = E.drawFaceUp(s, pi, k); } }
  return r;
}

function move(s, pi, R) {
  R = R || Math.random;
  const p = s.players[pi];
  if (s.turn !== pi || s.over) return;
  if (s.phase === 'setup' || s.phase === 'tickets') { E.keepTickets(s, pi, chooseTickets(s, pi)); return; }
  if (s.phase === 'main' && !E.movesAvailable(s, pi)) { E.pass(s, pi); return; }
  const plan = makePlan(s, pi);
  if (s.phase === 'drew1') { drawStep(s, pi, plan, false, R); return; }

  const claims = E.legalClaims(s, pi);
  const endgame = !!s.lastRound || p.trains <= 8 || s.players.some(q => q.trains <= 4);
  const sloppy = R() > p.skill;
  let pick = null;

  if (claims.length) {
    let bestV = -1;
    for (const c of claims) {
      const r = ROUTES[c.ri]; const needW = plan.need.get(c.ri);
      let v = -1;
      if (needW != null) v = 20 + SCORE[r.len] * 2 + needW * 0.2;
      else if (endgame) v = SCORE[r.len] * 3;
      else if (!plan.goals.length && r.len >= 3) v = SCORE[r.len];
      if (sloppy && v < 0 && R() < 0.35) v = SCORE[r.len] * 0.5;
      v += R() * 0.5;
      if (v > bestV) { bestV = v; pick = c; }
    }
    if (bestV < 0) pick = null;
  }
  if (pick) {
    const pay = choosePay(s, pi, pick.options, plan);
    E.claimRoute(s, pi, pick.ri, pay); return;
  }
  if (!plan.goals.length && p.trains >= 14 && s.ticketDeck.length && R() < 0.6) { E.drawTickets(s, pi); return; }
  const r = drawStep(s, pi, plan, true, R);
  if (r && r.err && s.ticketDeck.length) E.drawTickets(s, pi);
}

g.AI = { move, chooseTickets, makePlan };
})(typeof globalThis !== 'undefined' ? globalThis : window);
