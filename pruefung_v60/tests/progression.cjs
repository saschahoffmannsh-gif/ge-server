'use strict';
// Actual supplied engine and campaign, headless policy agents. Source stays untouched.
const fs=require('fs'),path=require('path');
const {ROOT,clone}=require('./harness.cjs');
const base=require('./harness.cjs');function create(seed,opts){const h=base.create(seed,opts);h.options={full:true,weekly:false};h.E.v2Caps={buildings:Object.fromEntries(Object.keys(h.GE.BUILD).map(k=>[k,h.E.bCapLv(k)])),tech:Object.fromEntries(Object.keys(h.GE.TECH).map(k=>[k,h.E.tCapLv(k)]))};return h;}
const DAY=864e5,HOUR=3600e3,MIN=60e3;
const HORIZON=Number(process.env.HORIZON_DAYS||180),POINTS=[...new Set([1,7,30,90,180,HORIZON])];
const PROFILES={casual:{sessions:[0,12],minutes:10,policy:'balanced',pct:100,raids:true},active:{sessions:[0,4,10,14],minutes:15,policy:'balanced',pct:100,raids:true},optimized:{sessions:[0,2,4,6,9,12,15,18],minutes:20,policy:'nebula',pct:10,raids:false}};
function run(profile,seed,overrides={}){
 const cfg={...PROFILES[profile],...overrides,raids:overrides.raids??false},h=create(seed,{...cfg,instrument:true,variant:cfg.variant||process.env.VARIANT||'full'}),E=h.E,GE=h.GE,S=h.S,C=h.ctx.AUDIT_CAMP;
 S.settings.raids=cfg.raids;const start=h.t,initialLiquid=Object.values(S.planets.P1.r).reduce((a,b)=>a+b,0);
 if(cfg.tutorialEconomy){const T=h.ctx.CAMP.TT.find(x=>x.id==='T07');T.R.B={metal_mine:8,crystal_mine:6,gas_mine:4};T.c=()=>E.maxB('metal_mine')>=8&&E.maxB('crystal_mine')>=6&&E.maxB('gas_mine')>=4&&E.prodInfo(E.planet(S.home)).f>=1;}
 if(cfg.vouchers!=null)h.ctx.CAMP.TT.find(t=>t.id==='T01').f.voucher=cfg.vouchers;
 const logs=[],milestones={},errors={},counts={build:0,research:0,unit_orders:0,unit_count:0,starts:0,pvp_attacks:0,frames:0,claims:0,online_minutes:0};
 const flow={mines:{m:0,k:0,g:0},storage_wasted:{m:0,k:0,g:0},nebula:{m:0,k:0,g:0},npc_loot:{m:0,k:0,g:0},recycle:{m:0,k:0,g:0},gifts:{m:0,k:0,g:0},campaign:{m:0,k:0,g:0},transport_internal:{m:0,k:0,g:0},spent_build:{m:0,k:0,g:0},spent_research:{m:0,k:0,g:0},spent_units:{m:0,k:0,g:0},fuel:{m:0,k:0,g:0},raid_loot:{m:0,k:0,g:0},found_ship_value:0,lost_ship_value:0,raid_lost_value:0,weekly_stones:0,cores:0};
 const add=(o,r)=>{for(const k of ['m','k','g'])o[k]+=(r[k]||0)};
 const resourceCost=(o,c)=>add(o,{m:c[0],k:c[1],g:c[2]});
 const value=o=>Object.entries(o||{}).reduce((a,[k,n])=>a+n*((GE.SHIP[k]||GE.DEF[k])?.c.reduce((a,b)=>a+b,0)||0),0);
 const wallet=()=>S.order.reduce((a,id)=>{const r=S.planets[id].r;return a+r.m+r.k+r.g},0);
 const allShips=()=>{const o={};for(const id of S.order)for(const[k,n]of Object.entries(S.planets[id].ships))o[k]=(o[k]||0)+n;for(const f of S.fleets)if(!f.npc)for(const[k,n]of Object.entries(f.ships))o[k]=(o[k]||0)+n;for(const f of S.saves||[])for(const[k,n]of Object.entries(f.ships))o[k]=(o[k]||0)+n;return o};
 h.ctx.__auditProduction=(r,got,wasted)=>{flow.mines[r]+=got;flow.storage_wasted[r]+=wasted};
 const origSend=E.send;E.send=function(pid,sh,to,mission,pct,cargo){const fuel=E.fuel(S.planets[pid],to,sh,pct||100),e=origSend.apply(this,arguments);if(!e){flow.fuel.g+=fuel;counts.starts++}return e};
 const origReward=E.giveReward;E.giveReward=function(r){add(flow.campaign,r);return origReward.apply(this,arguments)};
 const origSafe=E.fleetSave;E.fleetSave=function(pid){const before=S.planets[pid].r.g,err=origSafe.apply(this,arguments);if(!err)flow.fuel.g+=before-S.planets[pid].r.g;return err};
 for(const [method,bucket]of [['build','spent_build'],['research','spent_research'],['buildUnits','spent_units']]){const original=E[method];E[method]=function(...args){const p=S.planets[args[0]],before={...p.r},err=original.apply(this,args);if(!err){for(const r of ['m','k','g'])flow[bucket][r]+=before[r]-p.r[r];if(method==='build')counts.build++;else if(method==='research')counts.research++;else{counts.unit_orders++;counts.unit_count+=args[3];}}return err;};}
 E.on((type,r)=>{if(type==='report'){
  if(r.neb){if(r.neb.res)add(flow.nebula,r.neb.res);flow.found_ship_value+=value(r.neb.ships);flow.lost_ship_value+=value(r.neb.loss)}
  if(r.type==='combat'&&r.battle){if(r.battle.attackerIsMe)add(flow.npc_loot,r.battle.loot||{});else{add(flow.raid_loot,r.battle.loot||{});flow.raid_lost_value+=value(r.battle.lossD)}}
  if(r.type==='colonize'&&E.colonies()>0&&!milestones.colony_created_event)milestones.colony_created_event=(E.now()-start)/HOUR;
 }if(type==='fleetback'&&r.mission==='explore'){const key=r.safe?'training_return_event':'regular_return_event';if(!milestones[key])milestones[key]=(E.now()-start)/HOUR;}});
 // Flow instrumentation calls the original production and payment routines; no added resources.
 const originalTick=h.tick.bind(h);
 function tick(t){
  const before=wallet(),neb=Object.values(flow.nebula).reduce((a,b)=>a+b,0),npc=Object.values(flow.npc_loot).reduce((a,b)=>a+b,0),raid=Object.values(flow.raid_loot).reduce((a,b)=>a+b,0);
  const preR=S.order.reduce((a,id)=>{add(a,S.planets[id].r);return a},{m:0,k:0,g:0});
  originalTick(t);
  const postR=S.order.reduce((a,id)=>{add(a,S.planets[id].r);return a},{m:0,k:0,g:0});
  // Overall passive delta includes in-flight deliveries; keep a separate reliable
  // account budget identity below. Production capacity/loss metrics use snapshots.
  return before;
 }
 function blocked(s){if(s)errors[s]=(errors[s]||0)+1}
 function home(){return E.planet(S.home)}
 function queuedB(p,id){return E.nextLevel(p,id)-1}
 function queuedT(id){return Math.max(E.tl(id),S.rq?.id===id?S.rq.lv:0)}
 function ensureStore(p,c,depth=0){if(!E.storeOk(p,c))return ensureB(p,'store',E.lv(p,'store')+1,depth+1);return false}
 function ensureB(p,id,L,depth=0){
  if(h.options.full&&E.nextLevel(p,id)>(E.v2Caps.buildings[id]||40))return false;
  if(depth>25){blocked('dependency_depth');return false}if(queuedB(p,id)>=L)return false;
  const d=GE.BUILD[id];for(const [k,n]of Object.entries(d.req||{})){if(GE.TECH[k]&&E.tl(k)<n)return ensureT(k,n,depth+1);if(GE.BUILD[k]&&E.lv(p,k)<n)return ensureB(p,k,n,depth+1)}
  if(id!=='terraformer'&&id!=='moon_base'&&E.fieldsUsed(p)+p.bq.filter(q=>!q.demo).length>=E.fieldsMax(p))return ensureB(p,'terraformer',E.lv(p,'terraformer')+1,depth+1);
  const level=E.nextLevel(p,id),cost=E.bCost(id,level);
  if(id!=='store'&&!p.moon&&!E.storeOk(p,cost))return ensureStore(p,cost,depth+1);
  const e=E.build(p.id,id);if(!e){if(!milestones['build_'+id])milestones['build_'+id]=(h.t-start)/HOUR;return true}blocked(e);return false;
 }
 function ensureT(id,L,depth=0){
  if(h.options.full&&E.tl(id)>=(E.v2Caps.tech[id]??40))return false;
  if(depth>25||queuedT(id)>=L)return false;const p=home();
  for(const q of E.tReqs(p,id,E.tl(id)+1)){if(!q.ok){if(GE.TECH[q.id])return ensureT(q.id,q.need,depth+1);return ensureB(p,q.id,q.need,depth+1)}}
  const cost=E.tCost(id,E.tl(id)+1);if(!E.storeOk(p,cost))return ensureStore(p,cost,depth+1);
  const e=E.research(p.id,id);if(!e){if(!milestones['research_'+id])milestones['research_'+id]=(h.t-start)/HOUR;return true}blocked(e);return false;
 }
 function queuedU(p,id){return p.sq.filter(q=>q.id===id).reduce((a,q)=>a+q.n-q.done,0)}
 function ensureU(id,want,byBuilt=false){const p=home(),have=byBuilt?(S.built[id]||0):(p.ships[id]||0);const missing=want-have-queuedU(p,id);if(missing<=0)return false;
  for(const[k,n]of Object.entries(GE.SHIP[id].req||{})){if(GE.TECH[k]&&E.tl(k)<n)return ensureT(k,n);if(GE.BUILD[k]&&E.lv(p,k)<n)return ensureB(p,k,n)}
  const n=Math.min(missing,E.maxUnits(p,'ship',id));if(n<=0){blocked('ship_resources_'+id);return false}
  const e=E.buildUnits(p.id,'ship',id,n);if(!e){return true}blocked(e);return false;
 }
 function send(p,ships,to,mission,cargo={m:0,k:0,g:0},repeat=0){
  const fuel=E.fuel(p,to,ships,cfg.pct),before=S.nebL.n;
  const e=repeat?E.nebRepeat(p.id,ships,cfg.pct,repeat):E.send(p.id,ships,to,mission,cfg.pct,cargo);
  if(!e){if(mission==='colonize'&&!milestones.first_colony_launch)milestones.first_colony_launch=(h.t-start)/HOUR;return true}blocked(e);return false;
 }
 const missionTargets={};
 function colonyTarget(){const p=home();let best=null,score=-1;for(let off=0;off<4;off++)for(let pos=4;pos<=12;pos++){const s=(p.s-1+off)%499+1;if(E.slot(p.g,s,pos).kind!=='empty')continue;const f=E.colFields(p.g,s,pos),q=f+(40-E.tempOf(pos))*.10-off*3;if(q>score){score=q;best={g:p.g,s,p:pos}}}return best}
 function npc(){const p=home();return{g:p.g,s:p.s,p:E.npcAt(p.g,p.s)[0]}}
 function v2Tutorial(){const id=C.curMain();if(!id)return false;const task=h.ctx.CAMP.TT.find(x=>x.id===id);h.ctx.CAMP.reward(id);
  if(C.done(id)){const e=h.ctx.CAMP.claim(id);if(!e){counts.claims++;milestones[id]=(h.t-start)/HOUR;return true}return false}
  if(cfg.preplan&&(!S.tutorialPlan||S.tutorialPlan.source!==id)&&!E.planTutorial())return true;
  if(task.R){for(const[k,L]of Object.entries(task.R.B||{}))if(queuedB(home(),k)<L)return ensureB(home(),k,L);for(const[k,L]of Object.entries(task.R.T||{}))if(queuedT(k)<L)return ensureT(k,L);for(const[k,L]of Object.entries(task.R.U||{}))if((S.built[k]||0)+queuedU(home(),k)<L)return ensureU(k,L,true);if(task.balance&&E.prodInfo(home()).f<.999)return ensureB(home(),'power',E.lv(home(),'power')+1);return false}
  if(task.action==='pct'){E.setPct(S.home,'gas_mine',60);E.setPct(S.home,'gas_mine',100);return true}
  if(['training','nebula'].includes(task.action)&&!S.fleets.some(f=>f.mission==='explore')){if(!home().ships.sc)return ensureU('sc',1);return send(home(),{sc:1},{g:home().g,s:home().s,p:16},'explore')}
  if(task.action==='colony'&&!S.fleets.some(f=>f.mission==='colonize')){if(!home().ships.co)return ensureU('co',1);const to=colonyTarget();return to?send(home(),{co:1},to,'colonize'):false}
  if(task.action==='supply'&&!S.fleets.some(f=>f.mission==='transport')){const col=E.planets().find(p=>p.id!==S.home&&!p.moon);if(!col)return false;if(!home().ships.sc)return ensureU('sc',1);return send(home(),{sc:1},{g:col.g,s:col.s,p:col.p},'transport',{m:600,k:300,g:100})}
  return false;
 }
 function lookahead(){if(!h.options.full||cfg.lookahead===false)return false;const i=h.ctx.CAMP.TT.findIndex(x=>x.id===C.curMain());for(const task of h.ctx.CAMP.TT.slice(i,i+3)){if(task.action==='pct'&&!S.flags.pctTouched){E.setPct(S.home,'gas_mine',60);E.setPct(S.home,'gas_mine',100);return true}for(const[k,L]of Object.entries(task.R?.B||{}))if(queuedB(home(),k)<L&&ensureB(home(),k,L))return true;for(const[k,L]of Object.entries(task.R?.T||{}))if(queuedT(k)<L&&ensureT(k,L))return true;for(const[k,L]of Object.entries(task.R?.U||{}))if((S.built[k]||0)+queuedU(home(),k)<L&&ensureU(k,L,true))return true}return false;}
 function tutorial(){const id=C.curMain();if(!id)return false;
  if(C.done(id)){const r=clone(h.ctx.CAMP.reward(id));const e=h.ctx.CAMP.claim(id);if(!e){counts.claims++;milestones[id]=(h.t-start)/HOUR;return true}return false}
  const R=h.ctx.CAMP.TT.find(x=>x.id===id).R;
  if(R){
   for(const[k,L]of Object.entries(R.B||{}))if(queuedB(home(),k)<L)return ensureB(home(),k,L);
   for(const[k,L]of Object.entries(R.T||{}))if(queuedT(k)<L)return ensureT(k,L);
   for(const[k,L]of Object.entries(R.U||{}))if((S.built[k]||0)+queuedU(home(),k)<L)return ensureU(k,L,true);
   if(id==='T07'||id==='T20'){
    const pi=E.prodInfo(home());if(pi.f<.999)return ensureB(home(),'power',E.lv(home(),'power')+1);
    if(id==='T20'&&!C.storeFor('T21'))return ensureB(home(),'store',E.lv(home(),'store')+1);
   }
   return false;
  }
  if(id==='T05'){E.setPct(S.home,'gas_mine',60);E.setPct(S.home,'gas_mine',100);return true}
  if(id==='T16'&&!S.fleets.some(f=>f.mission==='spy')){if(!home().ships.pr)return ensureU('pr',1);return send(home(),{pr:1},npc(),'spy')}
  if(id==='T17'&&!S.fleets.some(f=>f.mission==='attack')){if((home().ships.lf||0)<3)return ensureU('lf',3);return send(home(),{lf:Math.min(6,home().ships.lf)},npc(),'attack')}
  if(id==='T19'&&!S.fleets.some(f=>f.mission==='explore')){if(!home().ships.sc)return ensureU('sc',1);return send(home(),{sc:1},{g:home().g,s:home().s,p:16},'explore')}
  if(id==='T23'&&!S.fleets.some(f=>f.mission==='colonize')){if(!home().ships.co)return ensureU('co',1);const to=colonyTarget();return to?send(home(),{co:1},to,'colonize'):false}
  if(id==='T24'&&!S.fleets.some(f=>f.mission==='transport')){const col=E.planets().find(p=>p.id!==S.home&&!p.moon);if(!col)return false;if(!home().ships.sc)return ensureU('sc',1);return send(home(),{sc:1},{g:col.g,s:col.s,p:col.p},'transport',{m:600,k:300,g:100})}
  return false;
 }
 function maybeFree(){for(const id of S.order){const p=S.planets[id];if(p.bq[0]&&p.bq[0].end-h.t>0&&p.bq[0].end-h.t<=E.FREE_MS){E.speedupBuild(id);return true}}
  if(S.rq&&S.rq.end-h.t>0&&S.rq.end-h.t<=E.FREE_MS){E.speedupResearch();return true}return false;
 }
 function repeat(){if(cfg.policy==='mines'||E.tl('astro')<1)return false;if(S.nebQ||S.fleets.some(f=>f.mission==='explore'))return false;
  const p=home(),ships={};for(const id of ['sc','lc','rc','pr'])if(p.ships[id])ships[id]=p.ships[id];if(!Object.keys(ships).length)return false;
  const probes=ships.pr||0;if(probes>=10000){if(p.ships.bs)ships.bs=Math.min(p.ships.bs,Math.max(1,Math.ceil(probes/5000)));else if(p.ships.cr)ships.cr=Math.min(p.ships.cr,Math.max(1,Math.ceil(probes/2000)))}
  // Fit the actually available gas; do not create fuel or mandatory ship reserve.
  const to={g:p.g,s:p.s,p:16};let fuel=E.fuel(p,to,ships,cfg.pct);
  for(const id of ['rc','lc','sc','pr'])if(fuel>p.r.g*.8&&ships[id]>1){ships[id]=Math.max(1,Math.floor(ships[id]*Math.min(.9,p.r.g*.7/fuel)));fuel=E.fuel(p,to,ships,cfg.pct)}
  if(E.nebFree()<1)return false;return send(p,ships,to,'explore',undefined,E.nebFree());
 }
 function maintenance(){
  const day=(h.t-start)/DAY,p=home();
  if(S.voucher>0){if(S.rq&&S.rq.end-h.t>30e3&&S.rq.end-h.t<=E.VOUCHER_MS){E.useVoucher('r');return true}if(p.bq[0]&&p.bq[0].end-h.t>30e3&&p.bq[0].end-h.t<=E.VOUCHER_MS){E.useVoucher('b',p.id);return true}}
  if(E.giftReady()){const r=E.giftReward();if(!E.claimGift()){add(flow.gifts,r);return true}}
  if(S.nebQ&&!S.fleets.some(f=>f.q)&&(!S.nebQ.wait||S.nebQ.wait<=h.t)){
   const before=S.nebL.n;E.nebQueueKick();if(S.nebL.n>before)return true;
   if(S.nebQ&&/Zu wenige/.test(S.nebQ.why||'')){for(const [id,n]of Object.entries(S.nebQ.ships)){const need=Math.ceil(n*E.NEB2.QMIN);if((p.ships[id]||0)+queuedU(p,id)<need&&ensureU(id,need))return true}}
  }
  if(E.tutDone()){
   if(h.options.full&&h.options.weekly&&!E.claimProject()){flow.weekly_stones++;if(!milestones.first_weekly_stone)milestones.first_weekly_stone=(h.t-start)/HOUR;return true}
   for(const strand of h.ctx.CAMP.STR){const m=strand.m.find(m=>!S.camp.side[m.id]);if(m&&m.c()){C.claimSide(m.id);return true}}
   const W=C.wk();if(W)for(const g of W.g){const d=C.WK_DEF.find(d=>d.id===g.id);if(!W.cl[g.id]&&d.v()-g.b>=g.n){E.giveReward(d.r);W.cl[g.id]=1;return true}}
  }
  if(cfg.raids&&cfg.policy!=='mines'){const r=E.raidsIncoming().find(f=>!f.ext);if(r&&E.countShips(S.planets[r.target].ships)>0){E.fleetSave(r.target);return true}}
  if(E.tutDone()){
   for(const id of ['geologist','guider'])if(S.dm>=(id==='geologist'?50:45)&&!E.cmdActive(id)&&(id!=='guider'||value(allShips())>=1e6)){E.hireCmd(id,7);return true}
   for(const id of ['power1','energy1','engine1','armor1'])if(S.items[id]>0&&!E.buff(GE.ITEMS[id].buff)){E.useItem(id);return true}
  }
  return false;
 }
 function corePlan(){if(!h.options.full||!h.options.weekly)return false;const day=(h.t-start)/DAY;if((S.gal.st>=4||day>=20)&&!E.maxB('galacto')&&ensureB(home(),'galacto',1))return true;if(S.gal.st<5)return false;const eligible=E.planets().filter(p=>!p.moon&&!p.core).sort((a,b)=>{const f=p=>{const q=E.prodInfo(p);return q.m+q.k+q.g};return f(b)-f(a)});for(const p of eligible){if(!E.lv(p,'galacto')){if(ensureB(p,'galacto',1))return true;continue}if(!E.makeCore(p.id,'prod')){flow.cores++;if(!milestones.first_core)milestones.first_core=(h.t-start)/HOUR;return true}}return false;}
 function supportBulk(){const p=home();for(const col of E.planets().filter(q=>q.id!==S.home&&!q.moon)){
  if(S.fleets.some(f=>f.mission==='transport'&&f.to.g===col.g&&f.to.s===col.s&&f.to.p===col.p))continue;
  if(E.lv(col,'robotics')<1&&col.r.g<200&&p.r.g>1000&&(p.ships.sc||0)>0&&p.r.m>2500&&p.r.k>2000&&E.slotsUsed()<E.fleetSlots()-1)return send(p,{sc:1},col,'transport',{m:2000,k:1000,g:500});
  if(col.r.m+col.r.k+col.r.g<Math.max(12000,E.storeCap(col)*.7)||S.fleets.some(f=>f.from===col.id)||E.slotsUsed()>=E.fleetSlots()-1)continue;
  const n=col.ships.lc||0;if(n<10){if((p.ships.lc||0)>=10)return send(p,{lc:10-n},col,'deploy');if(ensureU('lc',10))return true;continue}
  const sh={lc:n},fuel=E.fuel(col,p,sh,cfg.pct),cap=E.cargoCap(sh)-fuel;if(col.r.g<fuel)continue;const pi=E.prodInfo(col);const available=cfg.localReserve?{m:Math.max(0,col.r.m-12*pi.m),k:Math.max(0,col.r.k-12*pi.k),g:Math.max(0,col.r.g-fuel-12*pi.g)}:{m:col.r.m*.7,k:col.r.k*.7,g:Math.max(0,col.r.g-fuel)*.5};if(cfg.localReserve&&(E.lv(col,'metal_mine')<20||Object.values(available).reduce((a,b)=>a+b,0)<125000))continue;const sum=Object.values(available).reduce((a,b)=>a+b,0),ratio=Math.min(1,cap/Math.max(1,sum)),cargo=Object.fromEntries(Object.entries(available).map(([r,x])=>[r,Math.floor(x*ratio)]));return send(col,sh,p,'transport',cargo);
 }return false;}
 function supportColonies(){if(cfg.logistics==='bulk')return supportBulk();const p=home();
  for(const col of E.planets().filter(q=>q.id!==S.home&&!q.moon)){
   if(S.fleets.some(f=>f.mission==='transport'&&f.to.g===col.g&&f.to.s===col.s&&f.to.p===col.p))continue;
   if(E.lv(col,'robotics')<1&&col.r.g<200&&p.r.g>1000&&(p.ships.sc||0)>0&&p.r.m>2500&&p.r.k>2000)return send(p,{sc:1},{g:col.g,s:col.s,p:col.p},'transport',{m:2000,k:1000,g:500});
   // Pool useful excess at the actual research/shipyard world with real transports.
   if(col.r.m+col.r.k+col.r.g>Math.max(12000,E.storeCap(col)*.8)&&!S.fleets.some(f=>f.from===col.id)){
    if(!col.ships.sc&&p.ships.sc>1)return send(p,{sc:1},{g:col.g,s:col.s,p:col.p},'deploy');
    if(col.ships.sc){const f=E.fuel(col,p,{sc:1},cfg.pct),cap=5000-f;if(col.r.g<f)continue;const cargo={m:Math.floor(Math.min(col.r.m*.4,cap*.45)),k:Math.floor(Math.min(col.r.k*.5,cap*.35)),g:Math.floor(Math.min(Math.max(0,col.r.g-f)*.35,cap*.20))};return send(col,{sc:1},{g:p.g,s:p.s,p:p.p},'transport',cargo)}
   }
  }return false;
 }
 function economy(){const p=home(),day=(h.t-start)/DAY,all=allShips(),M=E.lv(p,'metal_mine');
  if(supportColonies())return true;
  const wantPlanets=Math.min(8,2+Math.floor(day/7));
  if(E.colonies()+1<wantPlanets&&!S.fleets.some(f=>f.mission==='colonize')){
   const needed=2*(E.colonies()+1);
   if(E.tl('astro')<needed){if(ensureT('astro',needed))return true;if(cfg.reserve&&!S.rq&&!E.tBlock(p,'astro',E.tl('astro')+1)){const c=E.tCost('astro',E.tl('astro')+1),pi=E.prodInfo(p);const wait=Math.max(...['m','k','g'].map((r,i)=>Math.max(0,c[i]-p.r[r])/Math.max(.001,pi[r])));if(wait<=24){if(repeat())return true;return false}}}
   if(E.maxPlanets()>E.colonies()+1){if(!p.ships.co){if(ensureU('co',1))return true}else{const to=colonyTarget();if(to&&send(p,{co:1},to,'colonize'))return true}}
  }
  if(repeat())return true;
  if(cfg.colonyInfra)for(const col of E.planets().filter(q=>!q.moon&&q.id!==S.home)){const M=E.lv(col,'metal_mine'),robo=Math.min(10,Math.max(1,Math.floor(M/3))),nan=M>=28?2:M>=25?1:0;if(queuedB(col,'robotics')<robo&&ensureB(col,'robotics',robo))return true;if(queuedB(col,'nanite')<nan&&ensureB(col,'nanite',nan))return true;}
  const targets={...(cfg.plasma&&day>=7?{plasma:10}:{}),energy:Math.max(2,Math.floor(M/3)),combustion:6,espionage:cfg.policy==='nebula'?Math.min(12,Math.max(5,Math.floor(M/2))):5,computer:Math.max(2,Math.min(10,Math.floor(M/2.5))),alloy:Math.max(1,Math.min(10,Math.floor((M-8)/3))),dynpower:Math.max(1,Math.min(16,Math.floor((M-7)/2))),armour:Math.min(10,Math.floor(M/3)),shielding:Math.min(10,Math.floor(M/3)),weapons:Math.min(10,Math.floor(M/3))};
  if(!S.rq){for(const [id,L]of Object.entries(targets))if(E.tl(id)<L&&ensureT(id,L))return true}
  const infrastructure={robotics:Math.min(12,Math.max(2,Math.floor(M/2.5))),lab:Math.min(14,Math.max(3,Math.floor(M/2))),shipyard:M<14?4:M<20?5:8,nanite:M>=20?Math.min(4,Math.floor((M-17)/3)):0};
  for(const[id,L]of Object.entries(infrastructure))if(queuedB(p,id)<L&&ensureB(p,id,L))return true;
  if(cfg.policy!=='mines'){
   const total=value(all),prod=E.refProd();
   // Public, fixed heuristic: maintain a fleet sized to hourly economy; compare
   // this with mine-only and activity-matched sensitivities, not a global optimum.
   const capitalGoal=(prod.m+prod.k+prod.g)*(cfg.policy==='nebula'?72:24);
   if(total<capitalGoal&&p.sq.length<2){
    const civilianTarget=cfg.policy==='nebula'?Math.min(3000,Math.max(5,Math.floor(capitalGoal*.20/18000))):Math.min(667,Math.max(5,Math.floor(capitalGoal*.45/18000)));
    if((all.rc||0)<civilianTarget&&E.reqOk(GE.SHIP.rc.req,p)){if(ensureU('rc',Math.min(civilianTarget,(p.ships.rc||0)+Math.max(1,Math.floor(E.maxUnits(p,'ship','rc')*.15)))))return true}
    else if((all.lc||0)<10&&ensureU('lc',10))return true;
    const probeTarget=Math.max(0,Math.floor((capitalGoal-total)/1000));
    if(probeTarget>0&&E.reqOk(GE.SHIP.pr.req,p)&&p.r.k>2000){const n=Math.min(probeTarget,Math.floor(E.maxUnits(p,'ship','pr')*(cfg.policy==='nebula'?.25:.10)));if(n>0&&ensureU('pr',(p.ships.pr||0)+n))return true}
   }
  }
  // Energy and storage remain physical constraints on every world.
  const candidates=[];
  for(const world of E.planets().filter(q=>!q.moon)){
   if(world.bq.length>=E.queueMax())continue;
   const pi=E.prodInfo(world);
   if(pi.f<.97){if(ensureB(world,'power',E.lv(world,'power')+1))return true}
   const bm=E.lv(world,'metal_mine'),bk=E.lv(world,'crystal_mine'),bg=E.lv(world,'gas_mine');
   for(const id of ['metal_mine','crystal_mine','gas_mine']){
    const lv=E.lv(world,id);if(queuedB(world,id)>lv||(h.options.full&&lv>=40))continue;
    if(id==='crystal_mine'&&bk>bm-1)continue;if(id==='gas_mine'&&bg>bk-2)continue;
    const c=E.bCost(id,lv+1),key=GE.BUILD[id].prod;
    const before=E.prodInfo(world)[key];world.b[id]=lv+1;const after=E.prodInfo(world)[key];world.b[id]=lv;if(!lv)delete world.b[id];
    const scarcity=id==='crystal_mine'?1.25:id==='gas_mine'&&p.r.g<Math.max(5000,prodG(E)*2)?1.5:1;
    candidates.push({p:world,id,L:lv+1,score:(c[0]+1.3*c[1]+1.6*c[2])/Math.max(1,(after-before)*scarcity)})
   }
  }
  candidates.sort((a,b)=>a.score-b.score);
  for(const c of candidates)if(ensureB(c.p,c.id,c.L))return true;
  return false;
 }
 function earlyEconomy(){
  const p=home();if(E.prodInfo(p).f<.99)return ensureB(p,'power',E.lv(p,'power')+1);
  const limits={metal_mine:10,crystal_mine:8,gas_mine:6},list=[];
  for(const[id,max]of Object.entries(limits)){const L=E.lv(p,id);if(queuedB(p,id)>L||L>=max)continue;const c=E.bCost(id,L+1),r=GE.BUILD[id].prod,old=E.prodInfo(p)[r];p.b[id]=L+1;const delta=E.prodInfo(p)[r]-old;p.b[id]=L;if(!L)delete p.b[id];list.push({id,score:(c[0]+1.3*c[1])/Math.max(1,delta),L:L+1})}
  list.sort((a,b)=>a.score-b.score);for(const x of list)if(x.score<6&&ensureB(p,x.id,x.L))return true;return false;
 }
 function prodG(E){return E.refProd().g}
 function snapshot(day){
  const cp=E.calcPoints(),ships=allShips(),p=home(),pr=E.refProd();
  const transit=S.fleets.filter(f=>!f.npc).reduce((a,f)=>a+Object.values(f.cargo||{}).reduce((a,b)=>a+b,0),0);
  const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
  const expected=initialLiquid+sum(flow.mines)+sum(flow.nebula)+sum(flow.npc_loot)+sum(flow.recycle)+sum(flow.gifts)+sum(flow.campaign)+(S.flags.firstCol?900:0)-sum(flow.spent_build)-sum(flow.spent_research)-sum(flow.spent_units)-sum(flow.fuel)-sum(flow.raid_loot);
  const cashError=wallet()+transit-expected;
  return{profile,seed,config:cfg,rules:h.options,day,tutorial_complete:E.tutDone(),tutorial_mission:C.curMain(),tutorial_hour:(h.options.full?milestones.T09:milestones.T24)??null,regular_nebula_hour:milestones.regular_return_event??null,colony_hour:milestones.colony_created_event??null,first_core_hour:milestones.first_core??null,planets:E.colonies()+1,cores:E.cores(),galactonite:clone(S.gal),
   buildings:clone(Object.fromEntries(S.order.filter(id=>!S.planets[id].moon).map(id=>[id,S.planets[id].b]))),tech:clone(S.tech),ships,dm:S.dm,liquid_total:wallet(),liquid_in_transit:transit,cash_accounting_error:cashError,liquid_home:clone(p.r),
   points:cp,ship_value:value(ships),production_hour:clone(pr),storage_home:E.storeCap(p),field_home:[E.fieldsUsed(p),E.fieldsMax(p)],
   neb_starts:S.nebL.n,neb_resolutions:S.nebL.r,neb_found_value:value(S.nebL.ships),neb_resources:clone(S.nebL.res),counts:clone(counts),flow:clone(flow),milestones:clone(milestones),
   active_build_worlds:S.order.filter(id=>S.planets[id].bq.length).length,errors:Object.fromEntries(Object.entries(errors).sort((a,b)=>b[1]-a[1]).slice(0,12))};
 }
 const snapshots=[];
 for(let day=0;day<HORIZON;day++){
  for(const hour of cfg.sessions){
   const st=start+day*DAY+hour*HOUR;tick(st);
   const steps=cfg.minutes*4;
   for(let step=0;step<steps;step++){
    tick(st+step*15e3);counts.frames++;counts.online_minutes+=.25;
    // One decision/action per 15 seconds; free queue continues while offline.
    if(maybeFree())continue;if(maintenance())continue;
    if(!E.tutDone()){if(!(h.options.full?v2Tutorial():tutorial())&&!lookahead()&&(cfg.policy==='nebula'||cfg.earlyEconomy))earlyEconomy();continue}
    if(h.options.full&&C.curMain()&&v2Tutorial())continue;
    if(corePlan())continue;
    economy();
   }
  }
  tick(start+(day+1)*DAY);
  if(POINTS.includes(day+1))snapshots.push(snapshot(day+1));
 }
 return{profile,seed,config:cfg,snapshots,final:snapshots.at(-1)};
}
if(require.main===module){
 const seeds=(process.env.SEEDS||'101,123,2026').split(',').map(Number),profiles=(process.env.PROFILES||'casual,active,optimized').split(',');
 const out=[];const output=process.env.OUTPUT||'progression.json';
 for(const profile of profiles)for(const seed of seeds){const started=Date.now(),r=run(profile,seed,JSON.parse(process.env.OVERRIDES||'{}'));if(Math.abs(r.final.cash_accounting_error)>.01)throw new Error('Ressourcenbilanz '+r.final.cash_accounting_error);out.push(r);fs.writeFileSync(path.join(__dirname,output),JSON.stringify(out,null,2));console.log(JSON.stringify({profile,seed,seconds:(Date.now()-started)/1000,tutorial:r.final.tutorial_hour,planets:r.final.planets,points:r.final.points.total,neb:r.final.neb_starts,home:r.final.buildings.P1,tech:r.final.tech}));}
}
module.exports={run,PROFILES};
