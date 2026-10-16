'use strict';
(function(root){
const base=root.ENGINE,GE=root.GE;
// Advance shared-world events in timestamp order across both combatants. Each
// event sees the debris/NPC state left by the preceding event, never a copy
// of the same still-uncollected field in a second account.
root.advanceRuntimes=function(runtimes,to){const copy=x=>JSON.parse(JSON.stringify(x));let world={debris:copy(runtimes[0].state().debris),npc:copy(runtimes[0].state().npc)};
 const sync=E=>{E.state().debris=copy(world.debris);E.state().npc=copy(world.npc);};
 const tick=(E,t)=>{sync(E);E.tick(t);world={debris:E.state().debris,npc:E.state().npc};};
 for(let n=0;n<100000;n++){let E=null,t=Infinity;for(const r of runtimes){const next=r.nextSharedEvent(to);if(next<t){t=next;E=r;}}if(!E)break;tick(E,t);if(n===99999)throw new Error('Zu viele gemeinsame Ereignisse');}
 for(const E of runtimes)tick(E,to);for(const E of runtimes)sync(E);
};
root.makeRuntime=function(state,ctx={}){const E=base.fork();E.load(JSON.parse(JSON.stringify(state)));E.mp=true;
 root.installCampaign({ENGINE:E,GE,headless:true});root.installPlanning(E,GE);root.installActions(E,GE);
 E.remoteFleets=ctx.fleet||{};E.externalEvents=ctx.events||{};E.externalResults=ctx.results||{};E.externalGifts=ctx.gifts||{};E.externalGal=ctx.gal||{};
 E.slotHook=(g,s,p)=>(ctx.slots||{})[g+':'+s+':'+p]||null;
 E.onSend=f=>{if(f.to.moon||!['attack','spy','transport'].includes(f.mission))return;const sl=E.slotHook(f.to.g,f.to.s,f.to.p);if(sl&&(sl.real||sl.npcid))f.pvp={who:sl.player,...(sl.real?{name:sl.player}:{npc:sl.npcid})};};
 E.extIncoming=()=>(ctx.incoming||[]).filter(f=>f.mission==='attack').map(f=>({target:E.state().order.find(id=>{const p=E.state().planets[id];return p.g===f.data.to.g&&p.s===f.data.to.s&&p.p===f.data.to.p&&!p.moon;}),arrive:f.arrive,phase:'out',ext:1}));E.pvpArrive=()=>{};return E;
};
root.commandState=function(prev,actions,to,ctx){const E=root.makeRuntime(prev,ctx);const next=E.replay(prev,actions,to);
 for(const id of next.order){const p=next.planets[id];for(const r of ['m','k','g'])if(!Number.isFinite(p.r[r])||p.r[r]<0||p.r[r]>Number.MAX_SAFE_INTEGER)throw new Error('Unsicherer Rohstoffbestand');}
 return next;
};
})(globalThis);
