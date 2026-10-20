// Runs many AI-vs-AI games with the real engine + AI to check termination, balance and rule invariants.
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
const src=['src/mapdata.js','src/engine.js','src/ai.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
vm.runInThisContext(src+'\n;globalThis.__E=Engine;globalThis.__AI=AI;');
const E=globalThis.__E, AI=globalThis.__AI;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

function play(n, seed, skills, trains){
  const R=mulberry(seed*7+1);
  const players=Array.from({length:n},(_,i)=>({kind:'ai',name:'P'+(i+1),skill:skills[i%skills.length]}));
  let s=E.newGame({seed,players,trains});
  let steps=0, turns=0;
  while(!s.over){
    if(++steps>6000) throw new Error('did not terminate seed '+seed);
    const before=s.v+'|'+s.turn+'|'+s.phase;
    AI.move(s,s.turn,R);
    invariants(s);
    if(s.phase==='main'&&s.turn===undefined) throw new Error('bad');
    turns++;
    if(before===s.v+'|'+s.turn+'|'+s.phase && !s.over) throw new Error('stuck at '+before+' seed '+seed);
  }
  return {s,turns};
}
function invariants(s){
  // card conservation
  let total=s.deck.length+s.discard.length+s.faceUp.length;
  s.players.forEach(p=>{ p.hand.forEach(c=>{ if(c<0) throw new Error('negative hand'); total+=c; }); if(p.trains<0) throw new Error('neg trains'); });
  if(total!==110) throw new Error('cards not conserved: '+total);
  // tickets conservation
  let t=s.ticketDeck.length; s.players.forEach(p=>t+=p.tickets.length+p.pending.length);
  if(t!==E.TICKETS.length) throw new Error('tickets not conserved '+t);
  // trains vs routes
  s.players.forEach((p,pi)=>{ let used=0; s.routes.forEach((o,i)=>{ if(o===pi) used+=E.ROUTES[i].len; }); if(used+p.trains!==s.trains) throw new Error('train accounting'); });
  // double route rule
  E.ROUTES.forEach((r,i)=>{ const sb=E.SIB[i]; if(sb>=0 && s.routes[i]>=0 && s.routes[sb]>=0){ if(s.n<4) throw new Error('both lanes in <4p game'); if(s.routes[i]===s.routes[sb]) throw new Error('same player both lanes'); } });
}
const cfgs=[[2,[0.8]],[3,[0.8]],[4,[0.8]],[5,[0.8]],[3,[1,0.55,0.8]]];
const N=+process.argv[2]||120;
for(const [n,sk] of cfgs){
  let turns=0,claimed=0,done=0,tick=0,scores=[],longest=[],maxT=0,minT=1e9,endTrains=[], fillLen=0, uniq=0;
  for(let g=0;g<N;g++){
    const {s,turns:tt}=play(n,1000+g,sk);
    turns+=tt; maxT=Math.max(maxT,tt); minT=Math.min(minT,tt);
    s.routes.forEach((o,i)=>{ if(o>=0){claimed++; fillLen+=E.ROUTES[i].len;} });
    s.result.rows.forEach(r=>{done+=r.done; tick+=r.done+r.failed; scores.push(r.total); longest.push(r.longest); endTrains.push(r.trains); });
  }
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`${n}p trains=${E.TRAINS[n]} games=${N}: avg turns(total) ${(turns/N).toFixed(0)} [${minT}-${maxT}], routes claimed ${(claimed/N).toFixed(1)}/${E.ROUTES.length}, lanes len ${(fillLen/N).toFixed(0)}, tickets done ${(100*done/tick).toFixed(0)}%, avg score ${avg(scores).toFixed(0)} (min ${Math.min(...scores)} max ${Math.max(...scores)}), longest avg ${avg(longest).toFixed(1)}, end trains avg ${avg(endTrains).toFixed(1)}`);
}
