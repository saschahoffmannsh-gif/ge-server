'use strict';
// Shared command model. A snapshot is a cache; only replayed commands acquire
// resources, levels, ships, rewards or timers in multiplayer.
(function(root){
function install(E,GE){
 if(E.actionsInstalled)return E;E.actionsInstalled=true;let depth=0;
 const copy=x=>JSON.parse(JSON.stringify(x));
 const methods=['planTutorial','stopTutorialPlan','build','demolish','cancelBuild','research','cancelResearch','buildUnits','speedupBuild','speedupResearch','speedupYard','useVoucher','send','recall','nebRepeat','nebStop','nebQueueKick','fleetSave','hireCmd','useItem','buy','claimGift','makeCore','changeCore','peaceStart','peaceApply','setPct','setRaids','rename','abandon','claimMission','claimSideMission','claimWeekly','applyGift','receiveEvent','receiveFleet'];
 E.receiveEvent=function(id){const S=E.state(),ev=(E.externalEvents||{})[id];if(!ev)return 'Ereignis nicht belegt';S.evSeen=S.evSeen||{};if(S.evSeen[id])return null;
  const c=ev.to||{},p=S.order.map(i=>S.planets[i]).find(p=>p.g===c.g&&p.s===c.s&&p.p===c.p&&!p.moon);
  if(ev.kind==='transport'&&p){for(const r of ['m','k','g'])p.r[r]+=ev.res[r]||0;E.bookIn('e:'+id,ev.res);}
  if(ev.kind==='attacked'&&p){for(const [key,loss]of [['ships',ev.lossShips||{}],['def',ev.lossDef||{}]])for(const k in loss)p[key][k]=Math.max(0,(p[key][k]||0)-loss[k]);for(const r of ['m','k','g'])p.r[r]=Math.max(0,p.r[r]-(ev.loot[r]||0));if(ev.moon&&!p.moonId)E.addMoon(p);if(ev.gal)E.galGrant(ev.galKey,ev.gal);}
  S.evSeen[id]=1;if(ev.kind==='attacked')E.report('combat','Angriff von '+ev.from,{battle:ev.battle});else if(ev.kind==='transport')E.report('transport','Lieferung von '+ev.from,{text:['m','k','g'].filter(r=>ev.res[r]>0).map(r=>ev.res[r]+' '+r).join(', ')});else E.report('info','Server-Ereignis',{text:ev.kind});return null;
 };
 E.receiveFleet=function(fid,sid){const S=E.state(),x=(E.externalResults||{})[sid],f=S.fleets.find(f=>f.id===fid);if(!x)return 'Flottenergebnis nicht belegt';if(!f)return null;
  if(f.resultId)return null;if(!f.pvp||String(f.pvp.sid)!==String(sid))return 'Flotte passt nicht zum Ergebnis';
  if(f.resultId)return null;f.resultId=sid;
  if(x.kind==='attack'){f.ships=copy(x.endShips);for(const r of ['m','k','g'])f.cargo[r]+=x.loot[r]||0;E.bookIn('e:f'+sid,x.loot);if(x.gal)E.galGrant(x.galKey,x.gal);}
  if(x.kind==='spy'&&x.lostProbes)f.ships={};if(x.kind==='transport')f.cargo={m:0,k:0,g:0};
  if(!Object.values(f.ships).some(n=>n>0))S.fleets=S.fleets.filter(q=>q!==f);else{f.phase='back';f.arrive=E.now()+f.dur;delete f.pvp;}E.report(x.kind==='attack'?'combat':x.kind==='spy'?'spy':'info','Flottenbericht',{battle:x.battle,spy:x.spy,text:x.msg||''});return null;
 };
 const tick=E.tick;E.tick=function(...a){depth++;try{const r=tick.apply(this,a);if(E.initCampaign){E.initCampaign();E.freezeCampaign();if(E.tutDone())E.weekly();}return r;}finally{depth--;}};
 for(const name of methods){const fn=E[name];if(!fn)throw new Error('Fehlende Aktion '+name);E[name]=function(...args){const outer=depth===0,at=E.now(),arg=copy(args);depth++;let result;try{result=fn.apply(this,args);}finally{depth--;}
   if(outer&&E.journalEnabled&&(result==null||result===true||result==='broken')){const S=E.state();S.actionSeq=(S.actionSeq||0)+1;(S.pendingActions||(S.pendingActions=[])).push({seq:S.actionSeq,t:at,type:name,args:arg});}
   return result;};}
 E.applyCommand=function(a){if(!a||!methods.includes(a.type)||!Array.isArray(a.args)||a.args.length>8)return 'Unbekannte Aktion';
  if(a.type==='recall'){const f=E.state().fleets.find(f=>f.id===a.args[0]),r=f&&E.remoteFleets&&E.remoteFleets[f.id];if(r&&(r.status!=='out'||r.arrive<=E.now()))return 'Flotte wird bereits aufgelöst';}
  if(a.type==='applyGift'){const [id]=a.args,n=(E.externalGifts||{})[id];if(n==null)return 'Geschenk nicht belegt';return E.applyGift(id,n);}
  if(a.type==='peaceApply'&&(!(E.externalGal||{})[a.args[0]]||a.args[1]!==1))return 'Galactonit nicht belegt';
  return E[a.type](...a.args);
 };
 E.replay=function(prev,actions,to){E.journalEnabled=false;E.load(copy(prev));if(E.initCampaign)E.initCampaign();const S=E.state();delete S.pendingActions;
  if(!Array.isArray(actions)||actions.length>1000)throw new Error('Zu viele Aktionen');
  for(const a of actions){if(!Number.isSafeInteger(a.seq)||!Number.isFinite(a.t))throw new Error('Ungültige Aktionsnummer/Zeit');if(a.seq<=(S.actionSeq||0))continue;
   if(a.seq!==(S.actionSeq||0)+1)throw new Error('Aktionsfolge unvollständig');if(a.t<S.t||a.t>to+5000)throw new Error('Aktionszeit außerhalb des bestätigten Fensters');
   E.clock=()=>a.t;E.tick(a.t);const r=E.applyCommand(a);if(r!=null&&r!==true&&r!=='broken')throw new Error(a.type+': '+r);S.actionSeq=a.seq;
  }
  E.clock=()=>to;E.tick(to);delete S.pendingActions;return S;
 };
 return E;
}
root.installActions=install;if(root.ENGINE&&root.ENGINE.claimMission)install(root.ENGINE,root.GE);
})(typeof window!=='undefined'?window:globalThis);
