'use strict';
// Explicitly prepaid-at-execution tutorial planning. No DM is spent.
(function(root){function install(E,GE){
 E.planTutorial=function(){const goals=E.tutorialGoals&&E.tutorialGoals();if(!goals)return 'Grundausbildung bereits abgeschlossen';const S=E.state();if(S.tutorialPlan&&S.tutorialPlan.source===goals.source)return 'Vorausplanung läuft bereits';S.tutorialPlan={...goals,wake:E.now(),why:null};E.advanceTutorialPlan();return null;};
 E.stopTutorialPlan=function(){delete E.state().tutorialPlan;return null;};
 E.advanceTutorialPlan=function(){const S=E.state(),q=S.tutorialPlan;if(!q||q.done)return;const p=S.planets[S.home];q.wake=0;let wait=Infinity,reason='Voraussetzungen oder laufende Aufträge';
  const consider=(cost,error)=>{if(error==='Zu wenig Rohstoffe'){const pi=E.prodInfo(p);let h=0;for(let j=0;j<3;j++){const r='mkg'[j],missing=Math.max(0,cost[j]-p.r[r]);if(missing>0){if(pi[r]<=0||cost[j]>E.storeCap(p)){h=Infinity;break;}h=Math.max(h,missing/pi[r]);}}wait=Math.min(wait,h*3600e3);reason='Wartet auf lokale Rohstoffe';}};
  let pending=false;
  for(const [id,L]of Object.entries(q.B)){if(E.lv(p,id)>=L)continue;pending=true;if(E.nextLevel(p,id)>L)continue;const cost=E.bCost(id,E.nextLevel(p,id)),err=E.canBuild(p,id);if(!err)E.build(p.id,id);else consider(cost,err);}
  if(q.balance&&E.prodInfo(p).f<1&&!p.bq.some(x=>x.id==='power')){pending=true;const err=E.canBuild(p,'power');if(!err)E.build(p.id,'power');else consider(E.bCost('power',E.nextLevel(p,'power')),err);}
  for(const [id,L]of Object.entries(q.T)){if(E.tl(id)>=L)continue;pending=true;if(S.rq)continue;const err=E.canResearch(p,id);if(!err)E.research(p.id,id);else consider(E.tCost(id,E.nextTL(id)),err);}
  for(const [id,L]of Object.entries(q.U)){const queued=p.sq.filter(x=>x.id===id).reduce((n,x)=>n+x.n-x.done,0),missing=L-(S.built[id]||0)-queued;if((S.built[id]||0)<L)pending=true;if(missing<=0)continue;const err=E.canUnit(p,'ship',id,missing);if(!err)E.buildUnits(p.id,'ship',id,missing);else consider(GE.SHIP[id].c.map(x=>x*missing),err);}
  if(q.training&&!S.flags.trainingBack){pending=true;if(!S.flags.expSafeDone&&(S.built.sc||0)>=1&&(p.ships.sc||0)>=1&&!S.fleets.some(f=>f.mission==='explore')){const err=E.send(p.id,{sc:1},{g:p.g,s:p.s,p:16},'explore',100);if(err)reason=err;}}
  if(!pending){q.done=true;q.why='Vorgemerkte Schritte abgeschlossen';return;}
  q.why=reason;if(Number.isFinite(wait))q.wake=E.now()+Math.max(15000,Math.ceil(wait));
 };
 return E;
}root.installPlanning=install;if(root.ENGINE)install(root.ENGINE,root.GE);
})(typeof window!=='undefined'?window:globalThis);
