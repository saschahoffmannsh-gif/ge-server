'use strict';
// ===== Galaxy Empire Remake – Spiellogik (DOM-frei, auch in Node testbar) =====
(function makeEngine(root){
const GE = root.GE || (typeof require!=='undefined' ? require('./data.js') : null);
const E = {};
const HOUR=3600e3, MIN=60e3;
let S=null; E.listeners=[];
const now=()=>E.clock?E.clock():Date.now();
E.now=now;
const emit=(type,data)=>{for(const f of E.listeners)try{f(type,data)}catch(e){console.error(e)}};
E.on=f=>E.listeners.push(f);
function random(){if(E.rng)return E.rng();if(!S)return Math.random();let a=S.rand=((S.rand??hash(String(S.created)+':'+S.seed))+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}
const rnd=(a,b)=>a+random()*(b-a);
const ri=(a,b)=>Math.floor(rnd(a,b+1));
const ck=(g,s,p)=>g+':'+s+':'+p;
E.ck=ck;
// ---------- deterministischer Hash für Galaxie ----------
function hash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h}
function srng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
E.GAL=9;
const poolPick=k=>GE.PLANET_POOL[hash('img'+k)%GE.PLANET_POOL.length];E.poolPick=poolPick; E.SYS=499;

// ---------- Neues Spiel ----------
function newPlanet(id,name,g,s,p,fields,type){
 return {id,name,g,s,p,fields,type,temp:tempOf(p),b:{},pct:{metal_mine:100,crystal_mine:100,gas_mine:100,power:100,ss:100},
  r:{m:0,k:0,g:0},ships:{},def:{},bq:[],sq:[],gems:[],moonId:null};
}
function tempOf(p){return Math.round(220-(p-1)*25+ (p*7%11) )}
function typeOf(p,seed){const r=(seed||0)%2; if(p<=3)return 'heisser_planet'; if(p<=5)return r?'kristallplanet':'heisser_planet'; if(p<=8)return r?'bewohnbarer_planet':'heimatwelt'; if(p<=11)return r?'gasriese':'bewohnbarer_planet'; return r?'eisplanet':'gasriese'}
E.typeOf=typeOf;
E.newGame=function(opts={}){
 const seed=opts.seed||((random()*1e9)|0);
 const r=srng(seed); const s=1+Math.floor(r()*E.SYS), p=4+Math.floor(r()*9);
 S={v:3,rv:6,progress:[],buildHigh:{},dmLed:0,voucher:2,nebT:[],nebDM:[],nebL:{n:0,r:0,ships:{},res:{m:0,k:0,g:0}},seed,speed:opts.speed||10,t:now(),created:now(),cmdName:'Kommandant',ally:null,
  planets:{},order:[],home:'P1',cur:'P1',nextId:2,
  tech:{},rq:null,dm:0,dmSrc:{},rIn:{},evSeen:{},gal:{v:2,st:0,base:0,src:{},lost:0,shards:{},gems:[],energy:0,nextGem:1},items:{},buffs:[],cmd:{},
  fleets:[],nextFleet:1,reports:[],nextRep:1,debris:{},npc:{},neb:{},
  task:0,flags:{},built:{},pts:{b:0,t:0},log:[],raids:false,nextRaid:0,lastGift:0,settings:{raids:false}};
 const hp=newPlanet('P1','Heimatplanet',1,s,p,178,'heimatwelt'); hp.r={m:1000,k:1000,g:250}; // Review V2: Startbestand 1.000/1.000/250, 2 Gutscheine, 0 DM
 S.planets.P1=hp; S.order=['P1'];
 const np=E.npcAt(1,s);for(let k=0;k<15&&np.includes(hp.p);k++)hp.p=hp.p%15+1; // vorher Endlosschleife möglich (Zyklus 3→6→9→12)
 hp.temp=40; // Progression v1: neue Heimatwelten 40 °C (Review F24: war versehentlich auskommentiert)
 addLog('Willkommen, Kommandant! Aries erwartet dich mit deiner ersten Aufgabe.');
 return S;
};
E.load=function(obj){S=obj;migrate();return S};
E.state=()=>S;
function migrate(){S.settings=S.settings||{raids:true};S.flags=S.flags||{};S.built=S.built||{};S.neb=S.neb||{};S.items=S.items||{};S.buffs=S.buffs||[];migrate34();migrateV2();migrateV3();migrateV4();migrateV5();migrateV6();}
// Progression v1 (rv 2): idempotent; keine rückwirkenden Gutschriften, bezahlte Aufträge behalten ihren Preis
function migrateV2(){if(S.rv>=2)return;S.rv=2;if(S.dmLed==null)S.dmLed=0;if(S.voucher==null)S.voucher=0;
 const n=S.order.filter(id=>S.planets[id]&&!S.planets[id].moon).length;if(n>8)S.grandP=n;
 if(S.order.filter(id=>S.planets[id]&&!S.planets[id].moon).length>1)S.flags.firstCol=1;
 if(S.flags.nebula||S.flags.nebN)S.flags.expSafeDone=1;if((S.flags.npcWins||0)>0)S.flags.trainWin=1;
 if(S.created==null)S.created=S.t||now()}
// Nebel v2 (rv 3): neue Zähler, keine Rückwirkung – laufende Flotten behalten ihre Regelversion
// Galactonit v2: Splitter/Edelsteine → Steine (Wert bleibt erhalten: 1 Splitter = 1 Stein, Edelstein n★ = 3·2^(n−1)), Sockel geleert
function migrateV4(){if(S.rv>=4&&S.gal&&S.gal.v>=2)return;S.rv=Math.max(4,+S.rv||0);const g=S.gal=S.gal||{};if(!(g.v>=2)){let n=0;for(const c in g.shards||{})n+=Math.max(0,+g.shards[c]||0);for(const x of g.gems||[])n+=3*Math.pow(2,Math.max(1,+x.star||1)-1);
 g.v=2;g.base=Math.floor(n);g.st=Math.floor(n);g.src={};g.lost=0;g.shards={};g.gems=[];for(const id of S.order||[]){const p=S.planets[id];if(p){p.gems=[];if(p.core===undefined)p.core=null}}}}
// Review V2 (rv 5): Standardwelt ohne lokale Piratenüberfälle, neue Ledger (DM-Quellen, Rohstoffzuflüsse, gesehene Events). Keine rückwirkenden Gutschriften.
function migrateV5(){if(S.rv>=5)return;S.rv=5;S.settings=S.settings||{};if(!S.flags.pveMode){S.settings.raids=false;S.raids=false;S.nextRaid=0;S.fleets=(S.fleets||[]).filter(f=>!(f.npc&&f.mission==='attack'&&f.phase==='out'))}
 if(!S.dmSrc)S.dmSrc={};if(!S.rIn)S.rIn={};if(!S.evSeen)S.evSeen={};S.gateCd=S.gateCd||{};if(S.camp&&!S.camp.rv3)S.camp.mig3=1}
function migrateV6(){if(S.rv>=6)return;S.rv=6;S.progress=[];S.buildHigh={};for(const id of S.order||[])for(const [k,v]of Object.entries(S.planets[id].b||{}))S.buildHigh[id+':'+k]=v;
 if(S.peace&&S.peace.st){S.peace.st=0;S.peace.goal=0;} // kein unbelegter Altfortschritt
 if(S.camp)S.camp.mig4=1;
}
function migrateV3(){if(S.rv>=3)return;S.rv=3;if(!Array.isArray(S.nebT))S.nebT=[];if(!S.nebL)S.nebL={n:0,r:0,ships:{},res:{m:0,k:0,g:0}};if(!Array.isArray(S.nebDM))S.nebDM=[]}
// v34: 15 Bauplätze – Solar+Fusion → Kraftwerk, 3 Speicher → Lager
function migrate34(){for(const id in (S.planets||{})){const p=S.planets[id];if(!p||!p.b)continue;const b=p.b;const mx=(a)=>Math.max(0,...a.map(k=>b[k]||0));
 if(!p.moon&&(b.solar!=null||b.fusion!=null||b.metal_store!=null||b.crystal_store!=null||b.gas_store!=null)){const pw=Math.max(b.power||0,mx(['solar','fusion'])),st=Math.max(b.store||0,mx(['metal_store','crystal_store','gas_store']));['solar','fusion','metal_store','crystal_store','gas_store'].forEach(k=>delete b[k]);if(pw)b.power=pw;if(st)b.store=st;p.pads=null;p.padsV=0}
 if(p.pct){const v=p.pct.solar!=null?p.pct.solar:p.pct.fusion;if(p.pct.power==null)p.pct.power=v!=null?v:100;delete p.pct.solar;delete p.pct.fusion}
 if(Array.isArray(p.bq)){const R={solar:'power',fusion:'power',metal_store:'store',crystal_store:'store',gas_store:'store'};const seen=new Set();p.bq=p.bq.filter(q=>{if(R[q.id]){q.id=R[q.id];if(seen.has(q.id)||(q.lv!=null&&q.lv<=(b[q.id]||0)))return false}seen.add(q.id);return true})}}}
function addLog(txt,kind){S.log.unshift({t:now(),txt,kind:kind||'info'});if(S.log.length>80)S.log.length=80;emit('log',txt)}
E.addLog=addLog;
E.planet=id=>S.planets[id||S.cur];
E.planets=()=>S.order.map(id=>S.planets[id]);
E.lv=(pl,id)=>(pl.b[id]||0);
E.tl=id=>S.tech[id]||0;
E.maxB=id=>Math.max(0,...S.order.map(i=>S.planets[i].b[id]||0));
const cmdActive=k=>(S.cmd[k]||0)>now();
E.cmdActive=cmdActive;
function buff(kind){if(E._nb)return 0;let v=0;for(const b of S.buffs.concat((S.ally&&S.ally.buffs)||[]))if(b.buff===kind&&(!b.start||b.start<=now())&&b.end>now())v=Math.max(v,b.v);return v} // Allianz-Shop-Buffs (v62) zählen wie Items: stärkster gilt, kein Stapeln
E.buff=buff;
function gemBonus(pl,stat){if(!pl||!pl.core)return 0;const C=GE.CORES[pl.core];if(!C)return 0;return C.stats.includes(stat)?C.v:0}
E.gemBonus=gemBonus;

// ---------- Kosten & Zeiten ----------
function costOf(def,lv){
 if(!def||!Number.isInteger(lv)||lv<1||lv>41)throw new RangeError('Ungültige Kostenstufe');
 const fr=x=>{const t=String(x),d=10n**BigInt((t.split('.')[1]||'').length);return[BigInt(t.replace('.','')),d]};
 const base=fr(def.f||2);let n=1n,d=1n;
 for(let L=2;L<=lv;L++){let q=base;for(const sg of def.fs||[])if(L>=sg[0]&&L<=sg[1]){q=[BigInt(sg[2]),BigInt(sg[3])];break}n*=q[0];d*=q[1]}
 return def.c.map(v=>Number(BigInt(v)*n/d));
}
E.safeCost=c=>Array.isArray(c)&&c.length===3&&c.every(v=>Number.isSafeInteger(v)&&v>=0)&&Number.isSafeInteger(c.reduce((a,b)=>a+b,0));
E.costOf=costOf;
// Progression v1 (2026-10): Kosten = floor(Basis·f^(L−1)) ohne Einfrieren und ohne Abhängigkeit von der Infrastruktur.
// Zeiten: TMUL 2 (Gebäude & Forschung), erst Boni, dann ÷√Tempo, danach Deckel 720 h/√Tempo, min. 15 s.
const CAP_H=30*24;E.CAP_H=CAP_H;
E.capSec=()=>CAP_H*3600/E.tsp();
// Review V2: Funktionsdeckel (neu bau-/erforschbar); höhere Altstufen bleiben als Altstand, ihr Effekt wird auf den Deckel begrenzt
E.LV_MAX=40;E.bCapLv=id=>{const d=GE.BUILD[id];return d&&d.cap!=null?d.cap:E.LV_MAX};E.tCapLv=id=>{const d=GE.TECH[id];return d&&d.cap!=null?d.cap:E.LV_MAX};
E.tlEff=id=>Math.min(E.tl(id),E.tCapLv(id));
E.bCost=(id,lv)=>costOf(GE.BUILD[id],lv);
const tRawCost=(id,lv)=>{const c=costOf(GE.TECH[id],lv);return id==='astro'&&lv>=4?c.map(x=>Math.round(x*0.75)):c};
E.tCost=(id,lv)=>tRawCost(id,lv);
E.TMUL=2;
// v42: Bau-/Forschungs-/Werftzeiten laufen nur mit √(Universumsgeschwindigkeit) schneller (bei Tempo 10 ≈ 3,16×), Produktion weiter ×Tempo.
E.tsp=()=>Math.sqrt(Math.max(1,(S&&S.speed)||1));
E.bTime=function(pl,id,lv){const c=E.bCost(id,lv);let h=(c[0]+c[1])/(2500*(1+E.lv(pl,'robotics'))*Math.pow(2,E.lv(pl,'nanite')));if(cmdActive('commander'))h*=0.9;if((id==='lab'||id==='robotics')&&lv>8)h*=0.7;return Math.max(15,Math.min(E.capSec(),h*3600*E.TMUL/E.tsp()))};
E.labLevel=function(pl){return E.lv(pl,'lab')};
E.researchCapSec=pl=>E.capSec()*Math.min(1,15/(1+E.labLevel(pl))); // Labor 14 als bisheriger Referenzstand
E.tTime=function(id,lv,pl){pl=pl||E.planet();const c=E.tCost(id,lv);let h=(c[0]+c[1])/(1000*(1+E.labLevel(pl)));if(cmdActive('technocrat'))h*=0.75;return Math.max(15,Math.min(E.researchCapSec(pl),h*3600*E.TMUL/E.tsp()))};
E.uTime=function(pl,kind,id){const d=kind==='def'?GE.DEF[id]:GE.SHIP[id];let h=(d.c[0]+d.c[1])/(2500*(1+E.lv(pl,'shipyard'))*Math.pow(2,E.lv(pl,'nanite')));if(kind==='def'&&cmdActive('admiral'))h*=0.9;return Math.max(1,h*3600/E.tsp())}; // v29: Originalformel (OGame/GE) ohne Zeitfaktor
// Felder
E.fieldsUsed=pl=>Object.entries(pl.b).reduce((a,[k,b])=>a+(k==='terraformer'?0:b),0);
E.fieldsMax=pl=>pl.moon?1+3*E.lv(pl,'moon_base'):pl.fields+5*E.lv(pl,'terraformer')+(pl.xf||0);
// Voraussetzungen
E.reqOk=function(req,pl){if(!req)return true;for(const k in req){const need=req[k];const have=GE.TECH[k]?E.tl(k)+(k==='espionage'&&cmdActive('technocrat')?0:0):E.lv(pl,k);if(have<need)return false}return true};
// v41: Stufen-Regeln (siehe GE.LVRULE in data.js). tech optional (für Server-Prüfung), sonst S.tech
E.lvReqs=function(pl,id,L,tech){const out=[];const R=GE.LVRULE;if(!R||pl.moon)return out;const T=tech||S.tech||{};
 const lvOf=k=>k==='@mine'?Math.max(pl.b.metal_mine||0,pl.b.crystal_mine||0,pl.b.gas_mine||0):k==='@mine2'?Math.max(pl.b.metal_mine||0,pl.b.crystal_mine||0):GE.TECH[k]?(T[k]||0):(pl.b[k]||0);
 const nm=k=>k==='@mine'?'eine Mine':k==='@mine2'?'Metall- oder Kristallmine':(GE.TECH[k]||GE.BUILD[k]).n;
 const rules=(id!=='robotics'&&R._all?R._all(L):[]).concat(R[id]?R[id](L):[]);
 for(const [k,need] of rules){if(need<=0)continue;const have=lvOf(k);out.push({id:k,n:nm(k),need,have,ok:have>=need,tech:!!GE.TECH[k]})}return out};
E.lvBlock=function(pl,id,L,tech){const b=E.lvReqs(pl,id,L,tech).filter(x=>!x.ok);return b.length?'Benötigt: '+b.map(x=>x.n+' '+x.need).join(', '):null};
E.storeOk=(pl,c)=>{const cap=E.storeCap(pl);return c.every(v=>v<=cap)};
E.techLabNeed=(L,id)=>Math.max(Math.ceil(L/2),(id&&GE.TECH[id]&&GE.TECH[id].req&&GE.TECH[id].req.lab)||0);
// v42: vollständige Voraussetzungen für den NÄCHSTEN Schritt (Basis-req + Stufen-Regel + Labor) – für Anzeige (✓/✗) und Prüfung
E.tReqs=function(pl,id,L,tech){const T=tech||S.tech||{};const out=[];const d=GE.TECH[id];const lab=E.techLabNeed(L,id);
 const have=k=>GE.TECH[k]?(T[k]||0):(pl.b[k]||0);const nm=k=>(GE.TECH[k]||GE.BUILD[k]).n;const m={};
 const add=(k,n)=>{if(n>0&&(m[k]||0)<n)m[k]=n};add('lab',lab);if(d.req)for(const k in d.req)add(k,d.req[k]);
 if(GE.TRULE&&GE.TRULE[id])for(const [k,n] of GE.TRULE[id](L))add(k,n);
 for(const k in m)out.push({id:k,n:nm(k),need:m[k],have:have(k),ok:have(k)>=m[k],tech:!!GE.TECH[k]});return out};
E.tBlock=(pl,id,L,tech)=>{const b=E.tReqs(pl,id,L,tech).filter(x=>!x.ok);return b.length?'Benötigt: '+b.map(x=>x.n+' '+x.need).join(', '):null};
// v42: Gebäude: Basis-req + Stufen-Regel zusammen
E.bReqs=function(pl,id,L,tech){const T=tech||S.tech||{};const m={};const d=GE.BUILD[id];const out=[];
 if(d.req)for(const k in d.req)m[k]=d.req[k];for(const x of E.lvReqs(pl,id,L,tech))if((m[x.id]||0)<x.need)m[x.id]=x.need;
 const have=k=>k==='@mine'?Math.max(pl.b.metal_mine||0,pl.b.crystal_mine||0,pl.b.gas_mine||0):k==='@mine2'?Math.max(pl.b.metal_mine||0,pl.b.crystal_mine||0):GE.TECH[k]?(T[k]||0):(pl.b[k]||0);
 const nm=k=>k==='@mine'?'eine Mine':k==='@mine2'?'Metall- oder Kristallmine':(GE.TECH[k]||GE.BUILD[k]).n;
 for(const k in m)if(m[k]>0)out.push({id:k,n:nm(k),need:m[k],have:have(k),ok:have(k)>=m[k],tech:!!GE.TECH[k]});return out};
E.reqList=function(req,pl){const out=[];if(!req)return out;for(const k in req){const isT=!!GE.TECH[k];const have=isT?E.tl(k):E.lv(pl,k);out.push({id:k,n:(isT?GE.TECH[k]:GE.BUILD[k]).n,need:req[k],have,ok:have>=req[k],tech:isT})}return out};
// ---------- Produktion ----------
E.temp=pl=>pl.temp;
E.storeCap=(pl,r)=>{const L=E.lv(pl,'store');return 5000*Math.floor(2.5*Math.exp(20*L/33))};
E.prodInfo=function(pl){
 if(pl.moon)return{m:0,k:0,g:0,eProd:0,eUse:0,f:1,parts:{}};
 const L=id=>E.lv(pl,id), P=id=>(pl.pct[id]??100)/100, T=pl.temp;
 const eb=(1+0.02*E.tl('ultra'))*(1+buff('energy'));
 const solar=30*L('power')*Math.pow(1.1+0.004*E.tl('energy'),L('power'))*P('power')*eb;
 const fusion=0;
 const sats=(pl.ships.ss||0)*Math.max(5,(T+160)/6)*P('ss')*eb;
 const eProd=solar+fusion+sats;
 const um=10*L('metal_mine')*Math.pow(1.1,L('metal_mine'))*P('metal_mine');
 const uk=10*L('crystal_mine')*Math.pow(1.1,L('crystal_mine'))*P('crystal_mine');
 const ug=20*L('gas_mine')*Math.pow(1.1,L('gas_mine'))*P('gas_mine');
 const eUse=um+uk+ug; const f=eUse>0?Math.min(1,eProd/eUse):1;
 const geo=1+(cmdActive('geologist')?0.1:0)+buff('prod')+(S.ally&&S.ally.res?0.01*(S.ally.res.eco||0):0)+E.cuB(); // ZIP155 §2.4: Aufholbonus additiv in der Förderbonusgruppe (nicht in refProd/_nb)
 const pl_=E.tl('plasma');
 const m=(30+30*L('metal_mine')*Math.pow(1.1,L('metal_mine'))*P('metal_mine')*f*geo*(1+0.01*pl_+gemBonus(pl,'m')));
 const k=(15+20*L('crystal_mine')*Math.pow(1.1,L('crystal_mine'))*P('crystal_mine')*f*geo*(1+0.0066*pl_+gemBonus(pl,'k')));
 const gasCons=0;
 const g=10*L('gas_mine')*Math.pow(1.1,L('gas_mine'))*(1.44-0.004*T)*P('gas_mine')*f*geo*(1+0.0033*pl_+gemBonus(pl,'g'))-gasCons;
 const sp=S.speed;
 return {m:m*sp,k:k*sp,g:g*sp,eProd,eUse,f,parts:{solar,fusion,sats,um,uk,ug,gasCons:gasCons*sp}};
};
// ===== ZIP155 §2: begrenzter Aufholbonus (Kurve, Referenz vom Server in S.cu, D = max(1, D_max)) =====
E.CU={MAX:0.5,KNOTS:[[0.1,0.5],[0.25,0.35],[0.5,0.2],[0.75,0]]};
E.cuCurve=function(x){if(!(x>=0))x=0;let b;if(x<=0.1)b=0.5;else if(x<0.25)b=0.5-(x-0.1);else if(x<0.5)b=0.35-0.6*(x-0.25);else if(x<0.75)b=0.2-0.8*(x-0.5);else b=0;return Math.max(0,Math.min(0.5,b))};
E.cuSeg=function(t){const c=S.cu;if(!c||!c.on)return null;for(const g of c.segs||[])if(g.a<=t&&t<(g.b==null?Infinity:g.b))return g;return null};
E.dmax=function(){return Math.max(1,Math.floor(S.dmax||0))};
E.cuB=function(){if(E._nb)return 0;const g=E.cuSeg(now());if(!g||!g.act||!(g.R>0))return 0;return E.cuCurve(E.dmax()/g.R)};
E.cuInfo=function(){const c=S.cu||null,g=c?E.cuSeg(now()):null;const b=E.cuB();let mine={m:0,k:0,g:0},extra={m:0,k:0,g:0};
 try{for(const id of S.order){const p=S.planets[id];if(!p||p.moon)continue;const a=E.prodInfo(p);E._nb=1;let z;try{z=E.prodInfo(p)}finally{E._nb=0}for(const r of ['m','k','g'])extra[r]+=Math.max(0,a[r]-z[r])-0}}catch(e){}
 const why=!c?'Aufholbonus: Serverdaten fehlen (Offline-Spiel)':!c.on?(c.why||'Aufholbonus für dieses Konto nicht vorgesehen'):!g?'Aufholbonus noch nicht aktiv':!g.act?('Aufholbonus noch nicht aktiv: '+(g.why||'Referenz fehlt')):null;
 return{b,R:g&&g.R||0,D:E.dmax(),x:g&&g.R?E.dmax()/g.R:null,why,next:c&&c.next||null,extra}};
function cuEdges(){const c=S.cu,o=[];if(c&&c.on)for(const g of c.segs||[]){o.push(g.a);if(g.b!=null)o.push(g.b)}return o}
function produce(pl,dtH){
 if(dtH<=0||pl.moon)return; const pi=E.prodInfo(pl);
 for(const r of ['m','k','g']){const cap=E.storeCap(pl,r);const add=pi[r]*dtH;
  if(add<0)pl.r[r]=Math.max(0,pl.r[r]+add); else if(pl.r[r]<cap)pl.r[r]=Math.min(cap,pl.r[r]+add);}
}
// ---------- Ressourcen ----------
const canPay=(pl,c)=>pl.r.m>=c[0]&&pl.r.k>=c[1]&&pl.r.g>=c[2];
E.canPay=canPay;
function pay(pl,c){pl.r.m-=c[0];pl.r.k-=c[1];pl.r.g-=c[2]}
function giveRes(pl,o){for(const r of['m','k','g'])if(o[r])pl.r[r]+=o[r]}

// ---------- Gebäudebau ----------
// Progression v1: 2 Einträge bis Tutorial-Ende, danach 4 (1 aktiv + 3 vorgemerkt); Commander +1. Bau bleibt seriell.
E.tutDone=()=>!!(S&&S.flags&&S.flags.tutDone);
E.queueMax=()=>(E.tutDone()?4:2)+(cmdActive('commander')?1:0);
E.nextLevel=(pl,id)=>E.lv(pl,id)+1+pl.bq.filter(q=>q.id===id&&!q.demo).length-pl.bq.filter(q=>q.id===id&&q.demo).length;
E.canBuild=function(pl,id){
 const d=GE.BUILD[id]; if(!d)return 'Unbekannt';
 if(pl.moon&&!GE.MOON_B.includes(id))return 'Nur auf Planeten';
 if(!pl.moon&&d.moon)return 'Nur auf Monden';
 if(!E.reqOk(d.req,pl))return 'Benötigt: '+E.reqList(d.req,pl).filter(x=>!x.ok).map(x=>x.n+' '+x.need).join(', ');
 if(pl.bq.length>=E.queueMax())return 'Bauschleife voll';
 if(E.fieldsUsed(pl)+pl.bq.filter(q=>!q.demo&&q.id!=='terraformer').length>=E.fieldsMax(pl)&&id!=='moon_base'&&id!=='terraformer')return 'Keine freien Felder';
 if((id==='shipyard'||id==='nanite')&&pl.sq.length)return 'Werft ist beschäftigt';
 if(id==='lab'&&S.rq&&S.rq.pid===pl.id)return 'Forschung läuft';
 const lv=E.nextLevel(pl,id);if(lv>E.bCapLv(id))return E.bCapLv(id)===0?'Noch nicht verfügbar':'Abgeschlossen (höchste Stufe '+E.bCapLv(id)+')';{const lb=E.lvBlock(pl,id,lv);if(lb)return lb}{const c0=E.bCost(id,lv,pl);if(!pl.moon&&!E.storeOk(pl,c0))return 'Lager zu klein'} if(!E.safeCost(E.bCost(id,lv,pl)))return 'Kosten überschreiten den sicheren Zahlenbereich';if(!canPay(pl,E.bCost(id,lv,pl)))return 'Zu wenig Rohstoffe';
 return null;
};
E.build=function(pid,id){
 const pl=S.planets[pid]; const err=E.canBuild(pl,id); if(err)return err;
 const lv=E.nextLevel(pl,id), c=E.bCost(id,lv,pl); pay(pl,c);
 const start=pl.bq.length?pl.bq[pl.bq.length-1].end:now(); const dur=E.bTime(pl,id,lv)*1000;
 pl.bq.push({id,lv,start,end:start+dur,dur,cost:c}); S.pts.b+=(c[0]+c[1]+c[2])/1000; emit('change');return null;
};
E.demolish=function(pid,id){
 const pl=S.planets[pid]; const L=E.lv(pl,id); if(L<=1)return 'Abriss nur bis Stufe 1 möglich';
 if(pl.bq.length>=E.queueMax())return 'Bauschleife voll';
 const c=E.bCost(id,L,pl).map(v=>Math.floor(v/4)); if(!canPay(pl,c))return 'Zu wenig Rohstoffe';
 pay(pl,c); const start=pl.bq.length?pl.bq[pl.bq.length-1].end:now(); const dur=E.bTime(pl,id,L)*500;
 pl.bq.push({id,lv:L-1,demo:true,start,end:start+dur,dur,cost:c}); emit('change'); return null;
};
E.cancelBuild=function(pid,idx){const pl=S.planets[pid];const q=pl.bq[idx];if(!q)return;
 if(idx!==pl.bq.length-1)return 'Nur der letzte Auftrag kann abgebrochen werden';
 giveRes(pl,{m:q.cost[0],k:q.cost[1],g:q.cost[2]});if(!q.demo)S.pts.b-=(q.cost[0]+q.cost[1]+q.cost[2])/1000;pl.bq.pop();emit('change')};
function finishBuild(pl){const q=pl.bq.shift();pl.b[q.id]=q.lv;if(q.lv<=0)delete pl.b[q.id];if(!q.demo&&!q.free){const hi=S.buildHigh||(S.buildHigh={}),key=pl.id+':'+q.id;if(q.lv>(hi[key]||0)){hi[key]=q.lv;const v=(q.cost||[0,0,0]).reduce((a,b)=>a+b,0);E.progC().b++;E.progC().bv=(E.progC().bv||0)+v;E.progress('industry',v)}}
 addLog(`${pl.name}: ${GE.BUILD[q.id].n} ${q.demo?'abgerissen auf':'ausgebaut auf'} Stufe ${q.lv}`,'build');
 // folgende Aufträge neu terminieren
 let t=q.end;for(const n of pl.bq){n.start=t;n.end=t+n.dur;t=n.end}
 emit('built',{pl,q});}
// ---------- Forschung ----------
E.nextTL=id=>E.tl(id)+1;
E.canResearch=function(pl,id){const d=GE.TECH[id];if(S.rq)return 'Es läuft bereits eine Forschung';
 if(pl.moon)return 'Forschung nur auf Planeten';
 if(!E.lv(pl,'lab'))return 'Forschungslabor benötigt';
 if(pl.bq.some(q=>q.id==='lab'))return 'Labor wird ausgebaut';
 if(!E.reqOk(d.req,pl))return 'Benötigt: '+E.reqList(d.req,pl).filter(x=>!x.ok).map(x=>x.n+' '+x.need).join(', ');
 {const L=E.nextTL(id);if(L>E.tCapLv(id))return E.tCapLv(id)===0?'Vorerst nicht erforschbar':'Abgeschlossen (höchste Stufe '+E.tCapLv(id)+')';const tb=E.tBlock(pl,id,L);if(tb)return tb;if(!E.storeOk(pl,E.tCost(id,L,pl)))return 'Lager zu klein'}
 if(!E.safeCost(E.tCost(id,E.nextTL(id),pl)))return 'Kosten überschreiten den sicheren Zahlenbereich';if(!canPay(pl,E.tCost(id,E.nextTL(id),pl)))return 'Zu wenig Rohstoffe';return null};
E.research=function(pid,id){const pl=S.planets[pid];const err=E.canResearch(pl,id);if(err)return err;
 const lv=E.nextTL(id),c=E.tCost(id,lv,pl);pay(pl,c);const dur=E.tTime(id,lv,pl)*1000;
 S.rq={id,lv,pid,start:now(),end:now()+dur,dur,cost:c};S.pts.t+=2*(c[0]+c[1]+c[2])/1000;emit('change');return null};
E.cancelResearch=function(){const q=S.rq;if(!q)return;giveRes(S.planets[q.pid],{m:q.cost[0],k:q.cost[1],g:q.cost[2]});S.pts.t-=2*(q.cost[0]+q.cost[1]+q.cost[2])/1000;S.rq=null;emit('change')};
function finishResearch(){const q=S.rq;S.tech[q.id]=q.lv;S.rq=null;E.progC().t++;E.progC().tv=(E.progC().tv||0)+(q.cost||[0,0,0]).reduce((a,b)=>a+b,0);E.progress('research',(q.cost||[0,0,0]).reduce((a,b)=>a+b,0));addLog(`Forschung abgeschlossen: ${GE.TECH[q.id].n} Stufe ${q.lv}`,'research');emit('researched',q)}
// ---------- Werft ----------
E.unitDef=(kind,id)=>kind==='def'?GE.DEF[id]:GE.SHIP[id];
E.maxUnits=function(pl,kind,id){const d=E.unitDef(kind,id);let n=Infinity;d.c.forEach((v,i)=>{if(v>0)n=Math.min(n,Math.floor(pl.r['mkg'[i]]/v))});
 if(d.max){const have=(pl.def[id]||0)+pl.sq.filter(q=>q.id===id).reduce((a,q)=>a+q.n-q.done,0);n=Math.min(n,d.max-have)}return Math.max(0,n===Infinity?0:n)};
E.canUnit=function(pl,kind,id,n){const d=E.unitDef(kind,id);if(pl.moon&&!E.lv(pl,'shipyard'))return 'Werft benötigt';
 if(!E.lv(pl,'shipyard'))return 'Raumschiffwerft benötigt';
 if(pl.bq.some(q=>q.id==='shipyard'||q.id==='nanite'))return 'Werft wird ausgebaut';
 if(!E.reqOk(d.req,pl))return 'Benötigt: '+E.reqList(d.req,pl).filter(x=>!x.ok).map(x=>x.n+' '+x.need).join(', ');if(!Number.isSafeInteger(n)||n<=0)return 'Gültige ganze Anzahl wählen';if(!E.safeCost(d.c.map(v=>v*n)))return 'Kosten überschreiten den sicheren Zahlenbereich';
 if(E.maxUnits(pl,kind,id)<n)return d.max?'Nur einmal baubar':'Zu wenig Rohstoffe';return null};
E.buildUnits=function(pid,kind,id,n){const pl=S.planets[pid];n=Math.floor(n);const err=E.canUnit(pl,kind,id,n);if(err)return err;
 const d=E.unitDef(kind,id);const c=d.c.map(v=>v*n);pay(pl,c);const ut=Math.max(1,Math.round(E.uTime(pl,kind,id)*1000));
 const start=pl.sq.length?sqEnd(pl.sq[pl.sq.length-1]):now();
 pl.sq.push({kind,id,n,done:0,ut,start});emit('change');return null};
function sqEnd(q){return q.start+q.ut*q.n}
E.sqEnd=sqEnd;
function progressYard(pl,t){
 while(pl.sq.length){const q=pl.sq[0];let can=Math.min(q.n,Math.floor((t-q.start)/q.ut+1e-9));
  if(t>=sqEnd(q)-1)can=q.n; // FP-Schutz: sonst kann die Werft die Spielzeit einfrieren
  if(can>q.done){const add=can-q.done;const tgt=q.kind==='def'?pl.def:pl.ships;tgt[q.id]=(tgt[q.id]||0)+add;q.done=can;
   const d=E.unitDef(q.kind,q.id);S.pts.b+=add*(d.c[0]+d.c[1]+d.c[2])/1000*0; if(q.kind==='ship')S.built[q.id]=(S.built[q.id]||0)+add; else S.built[q.id]=(S.built[q.id]||0)+add;E.progC().u+=add*(d.c[0]+d.c[1]+d.c[2])}
  if(q.done>=q.n){pl.sq.shift();addLog(`${pl.name}: ${q.n}× ${E.unitDef(q.kind,q.id).n} fertiggestellt`,'yard');
   let st=sqEnd(q);for(const n of pl.sq){n.start=st;st=sqEnd(n)}}else break;}
}
// ---------- Beschleunigen (1 DM je angefangene 15 Min) ----------
E.FREE_MS=300e3; // Gratis-Fertigstellung bis 5 Min. Restzeit (Entscheidung Sascha 16.10.2026)
E.speedCost=ms=>ms<=E.FREE_MS?0:Math.max(1,Math.ceil(Math.pow((ms-E.FREE_MS)/MIN,.9)*.75));
E.isFree=ms=>ms>0&&ms<=E.FREE_MS;
E.speedupBuild=function(pid){const pl=S.planets[pid];const q=pl.bq[0];if(!q)return;const rem=q.end-now();const c=E.speedCost(rem);
 if(S.dm<c)return 'Zu wenig Dunkle Materie';S.dm-=c;const shift=q.end-now();q.end=now();
 for(let i=1;i<pl.bq.length;i++){pl.bq[i].start-=shift;pl.bq[i].end-=shift}
 S.flags.speedup=1;if(c===0)S.flags.freeFin=(S.flags.freeFin||0)+1; E.tick();return null};
// Progression v1: einmaliger Tutorial-Gutschein (bis 10 Min. Beschleunigung, gebunden)
E.VOUCHER_MS=10*MIN;
E.useVoucher=function(kind,pid){if(!(S.voucher>0))return 'Kein Gutschein vorhanden';const t=now();
 if(kind==='r'){const q=S.rq;if(!q)return 'Keine Forschung aktiv';const sh=Math.min(E.VOUCHER_MS,Math.max(0,q.end-t));q.end-=sh}
 else{const pl=S.planets[pid||S.cur];const q=pl&&pl.bq[0];if(!q)return 'Kein Bauauftrag aktiv';const sh=Math.min(E.VOUCHER_MS,Math.max(0,q.end-t));q.end-=sh;let st=q.end;for(let i=1;i<pl.bq.length;i++){const n=pl.bq[i];if(n.start>st){const d=n.start-st;n.start-=d;n.end-=d}st=n.end}}
 S.voucher--;S.flags.vUsed=(S.flags.vUsed||0)+1;S.flags.speedup=1;E.tick();emit('change');return null};
E.speedupResearch=function(){const q=S.rq;if(!q)return;const c=E.speedCost(q.end-now());if(S.dm<c)return 'Zu wenig Dunkle Materie';S.dm-=c;q.end=now();S.flags.speedup=1;if(c===0)S.flags.freeFin=(S.flags.freeFin||0)+1;E.tick();return null};
E.speedupYard=function(pid){const pl=S.planets[pid];if(!pl.sq.length)return;const rem=sqEnd(pl.sq[pl.sq.length-1])-now();const c=E.speedCost(rem);
 if(S.dm<c)return 'Zu wenig Dunkle Materie';S.dm-=c;for(const q of pl.sq){q.start=now()-q.ut*q.n}S.flags.speedup=1;E.tick();return null};

// ---------- Galaxie ----------
E.npcAt=function(g,s){const r=srng(hash('npc'+S.seed+':'+g+':'+s));const pos=[];while(pos.length<5){const p=1+Math.floor(r()*15);if(!pos.includes(p))pos.push(p)}return pos};
E.slot=function(g,s,p){
 const k=ck(g,s,p);
 for(const id of S.order){const pl=S.planets[id];if(!pl.moon&&pl.g===g&&pl.s===s&&pl.p===p)return{kind:'own',pl,type:pl.type,name:pl.name,fields:pl.fields}}
 if(p===16)return{kind:'nebula',name:'Mysteriöser Nebel'};
 if(E.mp&&E.slotHook){const hk=E.slotHook(g,s,p);if(hk&&(hk.real||hk.npcid))return Object.assign({type:poolPick(k)},hk)}
 const npcPos=E.npcAt(g,s);const ni=npcPos.indexOf(p);
 const r=srng(hash('slot'+S.seed+':'+k));
 if(ni>=0){const N=GE.NPC[ni];return{kind:'npc',lv:N.lv,name:N.n,de:N.de,type:poolPick(k)}}
 if(E.slotHook){const hk=E.slotHook(g,s,p);if(hk)return Object.assign({type:poolPick(k)},hk)}
 if((S.colonized||{})[k])return{kind:'empty',fields:E.colFields(g,s,p),type:poolPick(k)};
 const x=r();
 if(E.mp){if(x<0.12){const nm=GE.FAKE_NAMES[Math.floor(r()*GE.FAKE_NAMES.length)];return{kind:'inactive',player:nm,pts:Math.floor(r()*3000)+100,ally:null,name:'Verlassene Kolonie',type:poolPick(k)}}return{kind:'empty',fields:E.colFields(g,s,p),type:poolPick(k)}}
 if(x<0.42){const nm=GE.FAKE_NAMES[Math.floor(r()*GE.FAKE_NAMES.length)]+(r()<0.4?Math.floor(r()*99):'');const inactive=r()<0.55;
  const pts=Math.floor(Math.pow(r(),2)*(inactive?60000:900000))+200;const ally=r()<0.5?GE.ALLY_TAGS[Math.floor(r()*GE.ALLY_TAGS.length)]:null;
  return{kind:inactive?'inactive':'player',player:nm,pts,ally,name:['Kolonie','Heimatplanet','Außenposten','Nova','Aegis','Haven'][Math.floor(r()*6)],type:poolPick(k)}}
 return{kind:'empty',fields:E.colFields(g,s,p),type:poolPick(k)};
};
const FR={1:[40,70],2:[55,90],3:[75,115],4:[105,160],5:[115,170],6:[120,180],7:[150,225],8:[160,240],9:[150,230],10:[120,175],11:[110,165],12:[100,155],13:[70,115],14:[60,105],15:[50,95]};
E.FIELD_RANGE=FR;E.fieldRange=p=>FR[p]||[60,120];
function colFields(g,s,p){const r=srng(hash('f'+S.seed+ck(g,s,p)));const[a,b]=E.fieldRange(p);const x=(r()+r())/2;return Math.round(a+(b-a)*x)}
E.colFields=(g,s,p)=>colFields(g,s,p);
E.tempOf=tempOf;E.tempRange=p=>{const t=tempOf(p);return[t-40,t]};
E.gasFactor=T=>1.44-0.004*T;E.satEnergy=T=>Math.max(5,(T+160)/6);
E.system=function(g,s){const out=[];for(let p=1;p<=16;p++)out.push(Object.assign({p},E.slot(g,s,p)));return out};
// NPC / inaktive: Zustand
const NPC_TEMPL=[
 {res:15000,def:{rl:2},ships:{},tech:0},
 {res:40000,def:{rl:6},ships:{},tech:0},
 {res:120000,def:{rl:30,ll:12},ships:{lf:10},tech:2},
 {res:350000,def:{rl:60,ll:40,hl:10,gauss:2},ships:{lf:40,hf:15,cr:6},tech:4},
 {res:900000,def:{rl:150,ll:100,hl:40,gauss:10,ionc:10,sdome:1},ships:{lf:120,hf:60,cr:30,bs:10},tech:7}];
E.target=function(g,s,p){const k=ck(g,s,p);const sl=E.slot(g,s,p);if(sl.kind!=='npc'&&sl.kind!=='inactive'&&sl.kind!=='player')return null;
 let st=S.npc[k];const regen=12*HOUR/S.speed;
 if(!st){st=S.npc[k]=freshTarget(sl,k)}
 // Progression v1: Trainings-NPC (Stufe 1 im Heimatsystem) bleibt bis zum ersten Sieg sicher schlagbar
 if(E.isTrain(g,s,p,sl)){st.def={rl:1};st.ships={};st.tech={weapons:0,shielding:0,armour:0,espionage:0};st.train=1}
 const t=now();
 const grow=at=>{const dt=Math.max(0,at-st.t);for(const r of ['m','k','g'])st.r[r]=Math.min(st.full.r[r],st.r[r]+st.full.r[r]*dt/regen);st.t=at;};
 const next=at=>{for(const kind of ['ships','def'])for(const [id,want]of Object.entries(st.full[kind]))if((st[kind][id]||0)<want){const d=GE.SHIP[id]||GE.DEF[id];if(!canPay(st,d.c))continue;pay(st,d.c);const yard={b:{shipyard:Math.max(2,(sl.lv||1)*2)}};st.rebuild={kind,id,end:at+Math.round(E.uTime(yard,kind==='def'?'def':'ship',id)*1000)};return;}};
 let guard=0;while(st.rebuild&&st.rebuild.end<=t&&guard++<100000){const q=st.rebuild;grow(q.end);st[q.kind][q.id]=(st[q.kind][q.id]||0)+1;delete st.rebuild;next(q.end);}grow(t);if(!st.rebuild)next(t);
 return st};
E.isTrain=(g,s,p,sl)=>{if(S.flags.trainWin)return false;const h=S.planets[S.home];sl=sl||E.slot(g,s,p);return !!(h&&sl.kind==='npc'&&sl.lv===1&&h.g===g&&h.s===s)};
function freshTarget(sl,k){const r=srng(hash('t'+S.seed+k));let tpl,res,tech;
 if(sl.kind==='npc'){tpl=NPC_TEMPL[sl.lv-1];res=tpl.res;tech=tpl.tech}
 else{const lvl=Math.min(4,Math.floor(Math.log10(sl.pts+10)-1.5));tpl=NPC_TEMPL[Math.max(0,lvl-1)];res=Math.round(sl.pts*(4+r()*8));tech=Math.max(0,tpl.tech-1);
  if(sl.kind==='inactive')tpl={def:scaleU(tpl.def,0.5+r()*0.8),ships:{}};}
 const R={m:Math.round(res*0.5),k:Math.round(res*0.32),g:Math.round(res*0.18)};
 const full={r:R,def:{...tpl.def},ships:{...tpl.ships}};
 return{full,r:{...R},def:{...tpl.def},ships:{...tpl.ships},tech:{weapons:tech,shielding:tech,armour:tech,espionage:tech},t:now()}}
function scaleU(o,f){const x={};for(const k in o){const v=Math.round(o[k]*f);if(v>0||GE.DEF[k]&&GE.DEF[k].max)x[k]=GE.DEF[k]&&GE.DEF[k].max?o[k]:v}return x}

// ---------- Flotten ----------
E.dist=function(a,b){if(a.g!==b.g)return 20000*Math.abs(a.g-b.g);if(a.s!==b.s)return 2700+95*Math.abs(a.s-b.s);if(a.p!==b.p)return 1000+5*Math.abs(a.p-b.p);return 5};
E.shipSpeed=function(id){const d=GE.SHIP[id];if(!d.drv)return 0;const m={combustion:0.1,impulse:0.2,hyperdrive:0.3}[d.drv];return d.sp*(1+m*E.tl(d.drv))};
E.fleetSpeed=ships=>{let v=Infinity;for(const id in ships)if(ships[id]>0)v=Math.min(v,E.shipSpeed(id));return v===Infinity?0:v};
E.flightTime=function(from,to,ships,pct){const v=E.fleetSpeed(ships);if(!v)return Infinity;const d=E.dist(from,to);
 return (10+35000/pct*Math.sqrt(10*d/v))/S.speed/(1+buff('speed'))};
E.fuel=function(from,to,ships,pct){const d=E.dist(from,to);let f=0;for(const id in ships)f+=ships[id]*GE.SHIP[id].fuel*d/35000*Math.pow(pct/100+1,2);
 return Math.round(f*(1-Math.min(0.4,0.02*E.tlEff('dynpower'))))+1};
E.cargoCap=ships=>{let c=0;for(const id in ships)c+=ships[id]*GE.SHIP[id].cargo;return c};
E.fleetSlots=()=>1+Math.floor(E.tl('computer')/2)+(cmdActive('admiral')?2:0)+(S.xslot||0);
E.GATE_CD=[60,45,30,20,10];E.gateCd=lv=>E.GATE_CD[Math.max(1,Math.min(5,lv||1))-1]*MIN;E.gateReady=pl=>!(pl&&pl.gcd>now());
E.bEff=(pl,id)=>Math.min(E.lv(pl,id),E.bCapLv(id));
E.slotsUsed=()=>S.fleets.filter(f=>f.mission!=='explore'&&!f.npc).length;
E.nebulaUsed=()=>S.fleets.filter(f=>f.mission==='explore').length;
// max. 8 Planeten; Bestandskonten mit 9 Planeten behalten sie (S.grandP)
E.maxPlanets=()=>Math.max(Math.min(8,1+Math.floor(E.tlEff('astro')/2)),S.grandP||0);
// ---------- Progression v1: kontoweites 24-h-Fenster (ab Kontoerstellung) mit PvE-Budgets ----------
E.WIN_MS=24*HOUR;E.NEB_MAX=12;E.NEB_DM_MAX=40;E.BUDGET_H={neb:6,npc:3,gift:0.5};
E.winId=()=>Math.floor(Math.max(0,now()-(S.created||0))/E.WIN_MS);
E.winEnd=()=>(S.created||0)+(E.winId()+1)*E.WIN_MS;
// Referenzproduktion je Stunde: Förderung aller Nicht-Mond-Planeten, echte Energie/Regler/Forschung/Offiziere, ohne temporäre Item-Buffs
E.refProd=function(){const o={m:0,k:0,g:0};E._nb=1;try{for(const id of S.order){const p=S.planets[id];if(!p||p.moon)continue;const pi=E.prodInfo(p);o.m+=Math.max(0,pi.m);o.k+=Math.max(0,pi.k);o.g+=Math.max(0,pi.g)}}finally{E._nb=0}return o};
E.pve=function(){const w=E.winId();let p=S.pve;if(!p||p.w!==w){p=S.pve={w,P:E.refProd(),n:0,npc:{m:0,k:0,g:0},dm:0,gift:0}}return p};
E.budget=kind=>{const p=E.pve(),h=E.BUDGET_H[kind];return{m:Math.floor(h*p.P.m),k:Math.floor(h*p.P.k),g:Math.floor(h*p.P.g)}};
E.recycleTake=function(key,cap){const d=S.debris[key];const out={m:0,k:0,g:0};if(!d)return out;const left=E.npcLeft(),pv=E.pve();const available={};for(const r of ['m','k'])available[r]=Math.max(0,d[r]-(d['n'+r]||0))+Math.min(d['n'+r]||0,left[r]);
 out.m=Math.min(available.m,cap/2);out.k=Math.min(available.k,cap/2);let rem=cap-out.m-out.k;let x=Math.min(available.m-out.m,rem);out.m+=x;rem-=x;out.k+=Math.min(available.k-out.k,rem);
 for(const r of ['m','k']){out[r]=Math.floor(out[r]);const own=Math.max(0,d[r]-(d['n'+r]||0)),npc=Math.max(0,out[r]-own);d[r]-=out[r];d['n'+r]=Math.max(0,(d['n'+r]||0)-npc);pv.npc[r]+=npc;}if(d.m+d.k<1)delete S.debris[key];return out;};
E.npcLeft=()=>{const b=E.budget('npc'),u=E.pve().npc;return{m:Math.max(0,b.m-u.m),k:Math.max(0,b.k-u.k),g:Math.max(0,b.g-u.g)}};
// Anteil eines Nebel-Starts: Versuch 1–3 je 25 %, Versuch 4–12 je 1/36 des Fensterbudgets
E.nebShare=n=>{const b=E.budget('neb');const f=n<=3?0.25:n<=E.NEB_MAX?1/36:0;return{m:Math.floor(b.m*f),k:Math.floor(b.k*f),g:Math.floor(b.g*f)}};
// Admin-Geschenk anwenden (idempotent über S.gifts)
E.applyGift=(id,dm)=>{S.gifts=S.gifts||{};if(S.gifts[id])return false;S.gifts[id]=1;E.addDM(dm,'a:'+id);emit('change');return true};
// Review F05: DM nur aus bestätigten, benannten Quellen (dmSrc); keine Pauschale je Speicherung
E.addDM=(n,src)=>{n=Math.floor(n)||0;if(n<=0)return;S.dm+=n;S.dmLed=(S.dmLed||0)+n;if(src){S.dmSrc=S.dmSrc||{};S.dmSrc[src]=(S.dmSrc[src]||0)+n}};
// Review F01: Rohstoffzuflüsse außerhalb der Produktion je Quelle buchen (Validator rechnet sie gegen)
E.bookIn=(src,o)=>{if(!src||!o)return;S.rIn=S.rIn||{};const v=Math.floor((+o.m||0)+(+o.k||0)+(+o.g||0));if(v>0)S.rIn[src]=(S.rIn[src]||0)+v};
E.progC=()=>S.prog||(S.prog={b:0,t:0,u:0,bv:0,tv:0,regular:0});
E.progress=function(type,v){const t=now();S.progress=(S.progress||[]).filter(x=>x.t>=t-7*24*HOUR);if(v>0)S.progress.push({t,type,v});};
E.protectedUntil=()=>Math.max((S.created||0)+7*24*HOUR,Math.min((S.created||0)+14*24*HOUR,(S.flags.tutEnd||Infinity)+24*HOUR));
E.colonies=()=>S.order.filter(id=>!S.planets[id].moon).length-1;
E.MISSIONS={attack:'Angriff',transport:'Transport',deploy:'Stationieren',spy:'Spionage',recycle:'Abbau',colonize:'Kolonisieren',explore:'Erkunden'};
E.missionsFor=function(g,s,p,kindHint){
 const sl=E.slot(g,s,p);const m=[];const deb=S.debris[ck(g,s,p)];
 if(sl.kind==='nebula')m.push('explore');
 if(sl.kind==='npc'||sl.kind==='inactive')m.push('attack','spy');
 if(sl.kind==='player')m.push(...(sl.real?(now()<E.protectedUntil()||sl.prot?['transport']:['attack','spy','transport']):sl.npcp?['attack','spy']:['spy']));
 if(sl.kind==='own')m.push('transport','deploy');
 if(sl.kind==='empty')m.push('colonize');
 if(deb&&(deb.m+deb.k)>0)m.push('recycle');
 return m;};
E.AID_PCT=0.2;E.AID_CD=48*3600e3;
E.send=function(pid,ships,to,mission,pct,cargo){
 const pl=S.planets[pid];pct=pct??100;cargo=cargo||{m:0,k:0,g:0};if(!pl)return 'Startplanet fehlt';if(!Number.isInteger(pct)||pct<10||pct>100)return 'Tempo muss zwischen 10 und 100 liegen';if(!to||!Number.isInteger(to.g)||to.g<1||to.g>9||!Number.isInteger(to.s)||to.s<1||to.s>499||!Number.isInteger(to.p)||to.p<1||to.p>16)return 'Ungültige Koordinate';if(['m','k','g'].some(r=>!Number.isFinite(cargo[r]??0)||(cargo[r]??0)<0))return 'Ungültige Ladung';
 ships={...ships};for(const id in ships){if(!GE.SHIP[id]||!Number.isSafeInteger(ships[id])||ships[id]<0)return 'Ungültige Schiffsanzahl';ships[id]=Math.floor(ships[id]);if(!(ships[id]>0))delete ships[id]}
 if(!Object.keys(ships).length)return 'Keine Schiffe ausgewählt';
 for(const id in ships){if(id==='ss')return 'Solarsatelliten können nicht fliegen';if((pl.ships[id]||0)<ships[id])return 'Nicht genug Schiffe'}
 const allowed=E.missionsFor(to.g,to.s,to.p);if(to.moon){if(!['transport','deploy'].includes(mission))return 'Mission nicht möglich'}
 else if(!allowed.includes(mission))return 'Mission an diesem Ziel nicht möglich';
 if(pl.g===to.g&&pl.s===to.s&&pl.p===to.p&&!!pl.moon===!!to.moon)return 'Start und Ziel sind identisch';
 const trainX=mission==='explore'&&!S.flags.expSafeDone;
 // Review V2: sichere Trainings-Erkundung (einmal je Konto, ohne Astrophysik, genau 1 Kleiner Transporter, keine Fracht)
 if(trainX&&!(S.tutorialPlan&&S.tutorialPlan.training)&&!(S.camp&&S.camp.cl&&S.camp.cl.T08)&&!(S.camp&&S.camp.skip))return 'Trainings-Erkundung erst nach der Aufgabe „Erster Frachter“';
 if(trainX){if(!(S.built.sc>=1))return 'Baue zuerst selbst einen Kleinen Transporter';const ks=Object.keys(ships);if(ks.length!==1||ks[0]!=='sc'||ships.sc!==1)return 'Trainings-Erkundung: genau 1 Kleiner Transporter';if(cargo.m+cargo.k+cargo.g>0)return 'Trainings-Erkundung ohne Ladung';if(E.nebulaUsed()>0)return 'Trainings-Erkundung läuft bereits'}
 if(mission==='explore'){if(!trainX&&E.tl('astro')<1)return 'Astrophysik Stufe 1 benötigt';if(!trainX&&E.nebulaUsed()>=E.nebulaSlots())return 'Alle Nebelplätze belegt (kontoweit; Astrophysik 1/4/9/12 → 1/2/3/4 Plätze)';if(E.nebFree()<=0)return 'Höchstens 25 Erkundungen je 24 h – nächste Freigabe '+new Date(E.nebNextFree()).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});if(Object.keys(ships).some(k=>k==='ss'))return 'Satelliten können nicht erkunden';if(pl.s!==to.s||pl.g!==to.g)return 'Nur der Nebel im eigenen System kann erkundet werden'}
 else if(E.slotsUsed()>=E.fleetSlots())return 'Alle Flottenslots belegt (Computertechnik erhöht die Slots)';
 if(mission==='spy'&&Object.keys(ships).some(k=>k!=='pr'))return 'Spionage nur mit Spionagesonden';
 if(mission==='spy'&&ships.pr>20)return 'Maximal 20 Sonden pro Spionage';
 if(mission==='colonize'){if(!ships.co)return 'Kolonieschiff benötigt';if(E.colonies()+S.fleets.filter(f=>f.mission==='colonize').length>=E.maxPlanets()-1)return 'Astrophysik zu niedrig für weitere Kolonien (je 2 Stufen +1)'}
 if(mission==='recycle'&&!ships.rc)return 'Recycler benötigt';
 const dst=to.moon?S.planets[S.planets[findOwn(to)]?.moonId]:S.planets[findOwn(to)];
 // Review V2 (F15): Sternentor/Wurmloch nur Schiffe ohne Fracht, 5 s, Abklingzeit 60/45/30/20/10 Min. an beiden Endpunkten (niedrigere Stufe zählt)
 let gate=null;if(mission==='deploy'&&dst){const gs=!pl.moon&&!dst.moon&&E.lv(pl,'stargate')&&E.lv(dst,'stargate')?'stargate':(pl.moon&&dst.moon&&E.lv(pl,'wormhole')&&E.lv(dst,'wormhole'))?'wormhole':null;
  if(gs&&E.gateReady(pl)&&E.gateReady(dst)){gate={gs,lv:Math.min(E.bEff(pl,gs),E.bEff(dst,gs)),dst};cargo={m:0,k:0,g:0}}} // Ladung bleibt am Start
 if(to.moon&&!dst)return 'Zielmond gehört nicht zu deinem Imperium';
 const fuel=E.fuel(pl,to,ships,pct);const cap=E.cargoCap(ships);
 for(const r of['m','k','g'])cargo[r]=Math.max(0,Math.floor(cargo[r]||0));
 if(cargo.m+cargo.k+cargo.g>Math.max(0,cap-fuel))return 'Ladung übersteigt Laderaum';
 if(pl.r.g<fuel+cargo.g)return `Zu wenig Gas (Treibstoff: ${Math.ceil(fuel)})`;
 if(pl.r.m<cargo.m||pl.r.k<cargo.k)return 'Zu wenig Rohstoffe für die Ladung';
 let dur=gate?5000:E.flightTime(pl,to,ships,pct)*1000;
 // Lieferung an andere Spieler: je Ressource höchstens 20 % des aktuellen Bestands des Startplaneten (vor Abzug von Ladung/Treibstoff)
 const s0=mission==='transport'&&!dst&&(E.mp||S.mp)?{m:Math.floor(pl.r.m),k:Math.floor(pl.r.k),g:Math.floor(pl.r.g)}:null;
 if(s0)for(const r of['m','k','g'])if(cargo[r]>Math.floor(s0[r]*E.AID_PCT))return 'Höchstens 20 % deines Bestands je Rohstoff pro Lieferung';
 pl.r.g-=fuel+cargo.g;pl.r.m-=cargo.m;pl.r.k-=cargo.k;for(const id in ships){pl.ships[id]-=ships[id];if(!pl.ships[id])delete pl.ships[id]}
 if(gate){const cd=E.gateCd(gate.lv);pl.gcd=now()+cd;gate.dst.gcd=now()+cd}
 const f={id:S.nextFleet++,mission,from:pid,fromC:{g:pl.g,s:pl.s,p:pl.p,moon:!!pl.moon},to:{g:to.g,s:to.s,p:to.p,moon:!!to.moon},ships,cargo,pct,depart:now(),arrive:now()+dur,dur,phase:'out'};
 if(mission==='attack')f.bonus=E.combatBonus(pl);if(gate)f.gate=gate.gs;if(s0)f.s0=s0;
 if(mission==='explore'){const N=E.NEB2;S.flags.nebula=1;f.nv=N.V;f.snap=E.nebSnap();S.nebT=(S.nebT||[]).filter(x=>x>now()-N.WIN);S.nebT.push(now());E.nebL().n++;
  // Haltezeit 30 echte Minuten; die erste (sichere) Tutorial-Erkundung bleibt kurz (30 Min. Spielzeit), damit das Tutorial nicht hängt
  if(!S.flags.expSafeDone){S.flags.expSafeDone=1;f.safe=1;f.hold=30*MIN/S.speed}else f.hold=N.HOLD}
 S.fleets.push(f);if(E.onSend)try{E.onSend(f)}catch(e){}emit('change');return null};
function findOwn(c){for(const id of S.order){const p=S.planets[id];if(!p.moon&&p.g===c.g&&p.s===c.s&&p.p===c.p)return id}return null}
E.findOwn=findOwn;
E.recall=function(fid){const f=S.fleets.find(x=>x.id===fid);if(!f||f.phase==='back'||f.npc)return;const t=now();
 if(f.phase==='pvp'){if(f.pvp&&f.pvp.sid)return 'Flotte wird bereits aufgelöst';f.phase='back';f.arrive=t+f.dur;delete f.pvp;emit('change');return null;}
 if(f.phase==='out'){const el=t-f.depart;f.phase='back';f.backAt=t+el;f.arrive=t+el}else if(f.phase==='hold'){f.phase='back';f.arrive=t+f.dur;}emit('change')};
function fleetEventTime(f){return f.phase==='pvp'||!Number.isFinite(f.arrive)?Infinity:f.arrive}
E.nextSharedEvent=function(to){let t=Infinity;for(const f of S.fleets)if(f.phase==='out'&&!f.pvp&&(f.npc||['attack','spy','recycle'].includes(f.mission)))t=Math.min(t,fleetEventTime(f));if(S.settings.raids&&S.nextRaid)t=Math.min(t,S.nextRaid);return t<=to?Math.max(S.t,t):Infinity;};
function returnFleet(f){const pl=S.planets[f.from]||S.planets[S.home];if(f.trainW)S.flags.trainWin=1;if(f.mission==='explore'){S.flags.expBack=(S.flags.expBack||0)+1;if(f.safe){if(f.resolved)S.flags.trainingBack=1;else S.flags.expSafeDone=0;}else if(f.resolved)S.flags.expRegBack=1;}for(const id in f.ships)pl.ships[id]=(pl.ships[id]||0)+f.ships[id];giveRes(pl,f.cargo);
 S.fleets=S.fleets.filter(x=>x!==f);if(f.mission!=='deploy')addLog(`Flotte ${f.id} ist zu ${pl.name} zurückgekehrt`,'fleet');emit('fleetback',f);if(f.mission==='explore'&&S.nebQ)nebQueueKick()}
function report(type,title,data){const r={id:S.nextRep++,t:now(),type,title,read:false,...data};S.reports.unshift(r);if(S.reports.length>80)S.reports.length=80;emit('report',r);return r}
E.report=report;
function processFleet(f){
 const t=f.arrive;
 if(f.npc){return raidArrive(f)}
 if(f.phase==='back'){returnFleet(f);return}
 if(f.phase==='hold'){if(f.nv>=2)nebulaResolve2(f);else nebulaResolve(f);return}
 if(f.pvp&&E.pvpArrive){f.phase='pvp';f.pvpAt=f.arrive;f.arrive=null;E.pvpArrive(f);return}
 // Ankunft
 const to=f.to,k=ck(to.g,to.s,to.p);
 const goBack=()=>{f.phase='back';f.arrive=t+f.dur;};
 switch(f.mission){
  case 'transport':{const id=to.moon?S.planets[findOwn(to)]?.moonId:findOwn(to);const pl=S.planets[id];if(pl){giveRes(pl,f.cargo);
    report('transport','Transport angekommen',{text:`Deine Flotte hat ${fmtR(f.cargo)} zu ${pl.name} [${to.g}:${to.s}:${to.p}] geliefert.`});if(id!==S.home&&!pl.moon){S.flags.transportCol=1;if((f.cargo.m||0)+(f.cargo.k||0)+(f.cargo.g||0)>=1000)S.flags.supply=1}}
    f.cargo={m:0,k:0,g:0};goBack();break}
  case 'deploy':{const id=to.moon?S.planets[findOwn(to)]?.moonId:findOwn(to);const pl=S.planets[id];if(!pl){goBack();break}
    for(const s in f.ships)pl.ships[s]=(pl.ships[s]||0)+f.ships[s];giveRes(pl,f.cargo);S.fleets=S.fleets.filter(x=>x!==f);
    report('transport','Flotte stationiert',{text:`${countShips(f.ships)} Schiffe wurden auf ${pl.name} [${to.g}:${to.s}:${to.p}] stationiert.`});if(id!==S.home)S.flags.deployCol=1;break}
  case 'spy':spyArrive(f);goBack();break;
  case 'attack':attackArrive(f);if(countShips(f.ships)>0)goBack();else S.fleets=S.fleets.filter(x=>x!==f);break;
  case 'recycle':{const cap=Math.min((f.ships.rc||0)*GE.SHIP.rc.cargo,Math.max(0,E.cargoCap(f.ships)-f.cargo.m-f.cargo.k-f.cargo.g));const got=E.recycleTake(k,cap);for(const r of ['m','k'])f.cargo[r]+=got[r];S.flags.recycled=1;E.bookIn('r:'+f.id,got);report('recycle','Recyclingbericht',{text:fmtR(got),res:got});goBack();break}
  case 'colonize':{const sl=E.slot(to.g,to.s,to.p);if(sl.kind!=='empty'||E.colonies()>=E.maxPlanets()-1){report('colonize','Kolonisierung gescheitert',{text:`Die Position [${to.g}:${to.s}:${to.p}] ist nicht mehr frei oder dein Imperium ist zu groß.`});goBack();break}
    const id='P'+(S.nextId++);const fields=E.colFields(to.g,to.s,to.p);const pl=newPlanet(id,'Kolonie',to.g,to.s,to.p,fields,poolPick(k));
    const pk=S.flags.firstCol?{m:0,k:0,g:0}:{m:500,k:300,g:100};S.flags.firstCol=1;pl.r={m:pk.m+f.cargo.m,k:pk.k+f.cargo.k,g:pk.g+f.cargo.g};f.ships.co--;if(!f.ships.co)delete f.ships.co;for(const s in f.ships)pl.ships[s]=(pl.ships[s]||0)+f.ships[s];
    S.planets[id]=pl;S.order.push(id);S.fleets=S.fleets.filter(x=>x!==f);S.flags.colonized=1;
    report('colonize','Neue Kolonie gegründet',{text:`Deine Siedler haben [${to.g}:${to.s}:${to.p}] erreicht. Der Planet hat ${fields} Felder und eine Temperatur von ${pl.temp} °C.`});addLog('Neue Kolonie gegründet!','fleet');break}
  case 'explore':f.phase='hold';f.arrive=t+f.hold;break;
  default:goBack();}
}
const fmtN=n=>Math.floor(n).toLocaleString('de-DE');
const fmtR=c=>`${fmtN(c.m||0)} Metall, ${fmtN(c.k||0)} Kristall, ${fmtN(c.g||0)} Gas`;
E.fmtN=fmtN;
const countShips=o=>Object.values(o).reduce((a,b)=>a+b,0);
E.countShips=countShips;
// Spionage
function spyArrive(f){const to=f.to;const sl=E.slot(to.g,to.s,to.p);const st=E.target(to.g,to.s,to.p);
 const n=f.ships.pr||0;const my=E.tl('espionage')+(cmdActive('technocrat')?2:0);const their=st?st.tech.espionage:Math.floor(Math.log10((sl.pts||100))*2);
 const score=n+2*(my-their);const data={target:{...to,name:sl.name,kind:sl.kind,lv:sl.lv,player:sl.player},score};
 if(st){data.r={...st.r};if(score>=2)data.ships={...st.ships};if(score>=3)data.def={...st.def};if(score>=5)data.tech={...st.tech}}
 else{data.r={m:Math.round((sl.pts||1000)*3),k:Math.round((sl.pts||1000)*2),g:Math.round((sl.pts||1000))};if(score>=2)data.ships={lf:Math.round((sl.pts||0)/400),cr:Math.round((sl.pts||0)/3000)};if(score>=3)data.def={rl:Math.round((sl.pts||0)/200),ll:Math.round((sl.pts||0)/300)};data.protected=true}
 const enemy=st?countShips(st.ships):Math.round((sl.pts||0)/400);const ch=Math.min(0.8,enemy*0.02/Math.max(1,n)*Math.max(0.3,1-0.1*(my-their)));
 data.counter=Math.round(ch*100);
 if(random()<ch){f.ships.pr=0;delete f.ships.pr;data.lost=true}
 if(sl.kind==='npc'&&sl.lv===1)S.flags.spyDeportees=1;
 report('spy',`Spionagebericht ${sl.name} [${to.g}:${to.s}:${to.p}]`,{spy:data})}
// ---------- Kampfsimulation ----------
// Review F18/F20: ein gemeinsamer Kampf-/Bonuskern für alle Pfade (Pionier, Kerne, Items; Snapshot bei Start/Ankunft)
E.combatBonus=function(pl){const pio=0.02*E.maxB('pioneer');return{at:gemBonus(pl,'at')+pio,sh:gemBonus(pl,'sh'),hull:gemBonus(pl,'hull')+buff('hull')}};
// Review F18: Verteidigungs-Wiederaufbau stochastisch je Einheit (70 %, Ingenieur 85 %)
E.rebuildDef=function(lossD,eng){const p=eng?0.85:0.7;const o={};for(const d in lossD)if(GE.DEF[d]){let n=0;for(let i=0;i<lossD[d];i++)if(random()<p)n++;if(n)o[d]=n}return o};
E.techOf=(scale)=>({weapons:E.tl('weapons'),shielding:E.tl('shielding'),armour:E.tl('armour')});
E.simulate=function(A,D,opt){
 // A,D: {units:{id:n}, tech:{weapons,shielding,armour}, bonus:{at,sh,hull}}
 const ids=[],side=[],hull=[],sh=[],hmax=[],shmax=[],atk=[];
 function addSide(S_,sd){for(const id in S_.units){const n=S_.units[id];if(!(n>0))continue;const d=GE.SHIP[id]||GE.DEF[id];const t=S_.tech||{};const b=S_.bonus||{};
  const H=d.hull*(1+0.1*(t.armour||0)+(b.hull||0))*0.1, SH=d.sh*(1+0.1*(t.shielding||0)+(b.sh||0)), AT=d.at*(1+0.1*(t.weapons||0)+(b.at||0));
  for(let i=0;i<n;i++){ids.push(id);side.push(sd);hull.push(H);hmax.push(H);sh.push(SH);shmax.push(SH);atk.push(AT)}}}
 addSide(A,0);addSide(D,1);
 const N=ids.length;const H=Float64Array.from(hull),SHc=Float64Array.from(sh),alive=new Uint8Array(N).fill(1);
 const count=sd=>{const o={};for(let i=0;i<N;i++)if(alive[i]&&side[i]===sd)o[ids[i]]=(o[ids[i]]||0)+1;return o};
 const startA=count(0),startD=count(1);const rounds=[];let res='draw';
 for(let r=0;r<6;r++){
  const idxA=[],idxD=[];for(let i=0;i<N;i++)if(alive[i])(side[i]?idxD:idxA).push(i);
  if(!idxA.length||!idxD.length)break;
  for(let i=0;i<N;i++)if(alive[i])SHc[i]=shmax[i];
  const st=[{shots:0,dmg:0,abs:0},{shots:0,dmg:0,abs:0}];
  const fire=(i,targets)=>{let again=true;while(again){const j=targets[(random()*targets.length)|0];const a=atk[i];st[side[i]].shots++;
    if(H[j]>0){if(a<0.01*shmax[j]){st[side[i]].abs+=a}else{let dm=a;if(SHc[j]>0){const ab=Math.min(SHc[j],dm);SHc[j]-=ab;dm-=ab;st[side[i]].abs+=ab}
     H[j]-=dm;st[side[i]].dmg+=dm;if(H[j]>0&&H[j]<0.7*hmax[j]&&random()<1-H[j]/hmax[j])H[j]=0}}
    const rf=(GE.RF[ids[i]]||{})[ids[j]];again=rf>1&&random()<(rf-1)/rf}};
  for(const i of idxA)fire(i,idxD);for(const i of idxD)fire(i,idxA);
  for(let i=0;i<N;i++)if(alive[i]&&H[i]<=0)alive[i]=0;
  rounds.push({a:count(0),d:count(1),sa:st[0],sd:st[1]});
 }
 const endA=count(0),endD=count(1);const nA=countShips(endA),nD=countShips(endD);
 res=nA&&!nD?'a':(!nA&&nD)?'d':(!nA&&!nD)?'draw':'draw';
 if(!countShips(startD)&&nA)res='a';
 const lossA={},lossD={};for(const k in startA)if(startA[k]-(endA[k]||0))lossA[k]=startA[k]-(endA[k]||0);for(const k in startD)if(startD[k]-(endD[k]||0))lossD[k]=startD[k]-(endD[k]||0);
 let dm=0,dk=0;for(const L of[lossA,lossD])for(const k in L)if(GE.SHIP[k]){dm+=L[k]*GE.SHIP[k].c[0]*0.3;dk+=L[k]*GE.SHIP[k].c[1]*0.3}
 const val=L=>{let v=0;for(const k in L){const d=GE.SHIP[k]||GE.DEF[k];v+=L[k]*(d.c[0]+d.c[1]+d.c[2])}return v};const sval=L=>{let v=0;for(const k in L){const d=GE.SHIP[k];if(d)v+=L[k]*(d.c[0]+d.c[1]+d.c[2])}return v};
 return{startA,startD,endA,endD,rounds,winner:res,lossA,lossD,debris:{m:Math.round(dm),k:Math.round(dk)},valA:val(lossA),valD:val(lossD),moonChance:E.moonPct(dm+dk),shipLoss:sval(lossA)+sval(lossD)};
};
function splitUnits(o){const ships={},def={};for(const k in o)(GE.DEF[k]?def:ships)[k]=o[k];return{ships,def}}
function lootCalc(res,cap){const av={m:res.m/2,k:res.k/2,g:res.g/2};const out={m:0,k:0,g:0};let c=cap;
 out.m=Math.min(av.m,c/3);c-=out.m;out.k=Math.min(av.k,c/2);c-=out.k;out.g=Math.min(av.g,c);c-=out.g;
 const m2=Math.min(av.m-out.m,c/2);out.m+=m2;c-=m2;const k2=Math.min(av.k-out.k,c);out.k+=k2;c-=k2;
 for(const r in out)out[r]=Math.floor(out[r]);return out}
E.addMoon=function(pl){if(!pl||pl.moon||pl.moonId)return null;const id='P'+(S.nextId++);const m=newPlanet(id,'Mond',pl.g,pl.s,pl.p,1,'moon');m.moon=true;m.parent=pl.id;m.temp=pl.temp-40;pl.moonId=id;S.planets[id]=m;S.order.push(id);return m};
E.lootCalc=lootCalc;E.splitUnits=(...a)=>splitUnits(...a);E.packBattle=(...a)=>packBattle(...a);
function attackArrive(f){const to=f.to;const sl=E.slot(to.g,to.s,to.p);const st=E.target(to.g,to.s,to.p);const k=ck(to.g,to.s,to.p);
 if(!st){report('info','Angriff abgebrochen',{text:'Dieser Planet steht unter Anfängerschutz.'});return}
 const src=S.planets[f.from];
 const B=E.simulate({units:f.ships,tech:E.techOf(),bonus:f.bonus||E.combatBonus(src)},
  {units:{...st.ships,...st.def},tech:st.tech});
 f.ships={...B.endA};
 const sp=splitUnits(B.endD);st.ships=sp.ships;
 // Verteidigung zu 70 % wiederaufgebaut
 const rebuilt=E.rebuildDef(B.lossD,false);
 st.def={...sp.def};for(const d in rebuilt)st.def[d]=(st.def[d]||0)+rebuilt[d];
 let loot={m:0,k:0,g:0},shards=null;
 if(B.winner==='a'){const cap=Math.max(0,E.cargoCap(f.ships)-(f.cargo.m+f.cargo.k+f.cargo.g));loot=lootCalc(st.r,cap);
  // Progression v1: NPC-/Inaktiven-Beute zählt gegen das NPC-Budget (3 h Referenzproduktion je Fenster)
  {const left=E.npcLeft(),pv=E.pve();for(const r in loot){loot[r]=Math.max(0,Math.min(loot[r],left[r]));pv.npc[r]+=loot[r]}E.bookIn('l:'+f.id,loot)}
  if(E.isTrain(to.g,to.s,to.p,sl))f.trainW=1;
  for(const r in loot){st.r[r]-=loot[r];f.cargo[r]+=loot[r]}
  }
 st.t=now();
 // Review F21: Trümmer aus NPC-Einheiten zählen beim Bergen gegen das NPC-Beutebudget; eigene Schiffstrümmer getrennt
 if(B.debris.m+B.debris.k>0){const d=S.debris[k]||(S.debris[k]={m:0,k:0});d.m+=B.debris.m;d.k+=B.debris.k;let nm=0,nk=0;for(const u in B.lossD)if(GE.SHIP[u]){nm+=B.lossD[u]*GE.SHIP[u].c[0]*0.3;nk+=B.lossD[u]*GE.SHIP[u].c[1]*0.3}d.nm=(d.nm||0)+Math.round(nm);d.nk=(d.nk||0)+Math.round(nk)}
 if(sl.kind==='npc'&&sl.lv===2)S.flags.atkPurged=1;if(sl.kind==='npc')S.flags.npcWins=(S.flags.npcWins||0)+1; if(sl.kind==='inactive')S.flags.atkInactive=1;
 S.pts.fightA=(S.pts.fightA||0);
 report('combat',`Kampf bei ${sl.name} [${to.g}:${to.s}:${to.p}]`,{battle:packBattle(B,'Du',sl.kind==='npc'?`${sl.name} (NPC Lv${sl.lv})`:`${sl.player} (inaktiv)`,{loot,shards,rebuilt,coord:to,attackerIsMe:true})});
}
function packBattle(B,nameA,nameD,extra){return{nameA,nameD,startA:B.startA,startD:B.startD,endA:B.endA,endD:B.endD,rounds:B.rounds.map(r=>({a:r.a,d:r.d,sa:r.sa,sd:r.sd})),winner:B.winner,lossA:B.lossA,lossD:B.lossD,debris:B.debris,valA:B.valA,valD:B.valD,moonChance:B.moonChance,...extra}}
// ---------- Nebel v2 „Nebelwirtschaft – 25 Erkundungen“ (Regelversion 2, ersetzt Budget/Quoten/Spiegelgefecht) ----------
// Konstanten zentral; Client und Server nutzen dieselbe engine.js. Laufende Flotten ohne nv bleiben bei Regelversion 1.
E.NEB2={V:2,MAX:25,WIN:864e5,HOLD:30*MIN,DM_MAX:40,DM:[2,6],
 W:{sc:4000,lc:12000,rc:24000,pr:100},WCAP:1e6,WEXP:0.65,RES_F:0.03,
 P:{pr:1,sc:0.25,lc:1,rc:1.5},PB:1e6,PEXP:0.75,
 POOL:{pr:10,sc:10,lc:15,rc:15,co:2,lf:25,hf:10,cr:7,bs:4,ic:1,de:1},
 EV:{res:0.5,pir:0.08,nav:0.02,delay:0.03,dm:0.04,item:0.03},
 SUB:[['planet',0.6,[0.5,0.3,0.2]],['wreck',0.24,[0.6,0.4,0]],['ast',0.16,[0.45,0.35,0.2]]],
 ITEMS:['armor1','energy1','power1','engine1'],CIVIL:['sc','lc','rc','pr','co'],
 QMIN:0.9};
// Astrophysik 1/4/9/12 → 1/2/3/4 parallele Nebelplätze (kontoweit)
E.nebulaSlots=()=>{const a=E.tlEff('astro');return a>=12?4:a>=9?3:a>=4?2:a>=1?1:(!S.flags.expSafeDone&&(S.built.sc||0)>=1?1:0)};
// rollierendes reales 24-h-Fenster (Tempo beschleunigt es nicht)
E.nebL=()=>S.nebL||(S.nebL={n:0,r:0,ships:{},res:{m:0,k:0,g:0}});
E.nebStarts=()=>{const t=now();return (S.nebT||[]).filter(x=>x>t-E.NEB2.WIN&&x<=t)};
E.nebFree=()=>Math.max(0,E.NEB2.MAX-E.nebStarts().length);
E.nebNextFree=()=>{const st=E.nebStarts();return st.length>=E.NEB2.MAX?st[st.length-E.NEB2.MAX]+E.NEB2.WIN:now()};
E.nebDMLeft=()=>{const t=now();const used=(S.nebDM||[]).filter(x=>x[0]>t-E.NEB2.WIN).reduce((a,x)=>a+x[1],0);return Math.max(0,E.NEB2.DM_MAX-used)};
// Ortung (Rohstoffe) und Sondenleistung (Schiffsfunde)
E.nebPower=ships=>{const N=E.NEB2;let W=0,P=0;for(const id in ships){W+=(N.W[id]||0)*ships[id];P+=(N.P[id]||0)*ships[id]}
 const We=W<=N.WCAP?W:N.WCAP*Math.pow(W/N.WCAP,N.WEXP);return{W,We,P}};
E.nebChance=(P,S_)=>0.10+0.15*P/(P+10000)+0.005*Math.min(S_,10);
E.nebBudget=(P,S_)=>P>0?E.NEB2.PB*(1+0.02*S_)*Math.pow(P/1e5,E.NEB2.PEXP):0;
E.nebResMean=(We,L)=>E.NEB2.RES_F*We*(1+0.02*L);
const shipVal=id=>{const c=GE.SHIP[id].c;return c[0]+c[1]+c[2]};E.shipVal=shipVal;
// Fundklassen: Voraussetzungen nach den originalen Anforderungen (Forschung kontoweit, Gebäude bestes Gebäude)
E.nebAllowed=()=>Object.keys(E.NEB2.POOL).filter(id=>{const rq=GE.SHIP[id].req||{};return Object.keys(rq).every(k=>(GE.TECH[k]?E.tl(k):E.maxB(k))>=rq[k])});
// Eskortenschutz: Kampfschiffe = flugfähig außer SC/LC/RC/PR/CO (Satelliten fliegen nicht); H mit unveränderter Grundhülle
E.nebEscort=(ships,T)=>{const N=E.NEB2;let H=0,Es=0;for(const id in ships){const d=GE.SHIP[id],n=ships[id];if(id==='ss')continue;
  if(N.CIVIL.includes(id))H+=n*d.hull*0.1;else Es+=n*(d.at*(1+0.1*(T.weapons||0))+d.sh*(1+0.1*(T.shielding||0)))}
 return 0.8*Es/(Es+500+0.004*H)};
E.nebSnap=()=>({esp:E.tl('espionage'),alloy:E.tl('alloy'),weapons:E.tl('weapons'),shielding:E.tl('shielding'),armour:E.tl('armour'),ok:E.nebAllowed()});
// Vorschau für die UI (keine Autorität für Auszahlungen)
E.nebPreview=(ships,cargoFree)=>{const T=E.nebSnap();const pw=E.nebPower(ships);const cap=cargoFree!=null?cargoFree:E.cargoCap(ships);
 const rm=E.nebResMean(pw.We,T.alloy);const b=E.nebBudget(pw.P,T.esp);const ch=E.nebChance(pw.P,T.esp);const esc=E.nebEscort(ships,T);
 const pir=(1-esc)/(1+0.02*(T.armour+T.shielding));const lossFrac=(0.08*0.006*pir+0.02*(0.9*0.02+0.1*0.075))*(cmdActive('guider')?0.65:1);const replacement=[0,0,0];for(const [id,n]of Object.entries(ships))for(let j=0;j<3;j++)replacement[j]+=n*GE.SHIP[id].c[j]*lossFrac;
 return{free:E.nebFree(),next:E.nebNextFree(),used:E.nebulaUsed(),slots:E.nebulaSlots(),cap,W:pw.W,We:pw.We,P:pw.P,chance:ch,
  replacement,res:[Math.min(cap,Math.floor(rm*0.7)),Math.min(cap,Math.floor(rm*1.3))],budget:[Math.floor(b*0.7),Math.floor(b*1.3)],escort:esc,
  pirLoss:[0.003*pir*(cmdActive('guider')?0.65:1),0.009*pir*(cmdActive('guider')?0.65:1)],dmLeft:E.nebDMLeft(),ok:T.ok}};
function nebLose(ships,frac){const lost={};for(const id in ships){const raw=ships[id]*frac;let n=Math.floor(raw)+(random()<raw%1?1:0);n=Math.min(n,ships[id]);if(n>0)lost[id]=n}return lost}
function nebulaResolve2(f){
 const N=E.NEB2,t=f.arrive,ships=f.ships,T=f.snap||E.nebSnap();const L=E.nebL();L.r=(L.r||0)+1;f.resolved=1;if(!f.safe){E.progC().regular=(E.progC().regular||0)+1;E.progress('neb',1);}
 const capFree=Math.max(0,E.cargoCap(ships)-(f.cargo.m+f.cargo.k+f.cargo.g));
 const pw=E.nebPower(ships);const ch=E.nebChance(pw.P,T.esp);const g=cmdActive('guider')?0.65:1;
 const rec={v:2,sent:{...ships}};let text='',title='Nebelbericht';
 const u=random();const E1=N.EV.res,E2=E1+ch,E3=E2+N.EV.pir,E4=E3+N.EV.nav,E5=E4+N.EV.delay,E6=E5+N.EV.dm,E7=E6+N.EV.item;
 let out=f.safe?'safe':u<E1?'res':u<E2?'ships':u<E3?'pirates':u<E4?'nav':u<E5?'delay':u<E6?'dm':u<E7?'item':'none';
 const giveFind=(why)=>{const z=random();let acc=0,sub=N.SUB[0];for(const s of N.SUB){acc+=s[1];if(z<acc){sub=s;break}}
  const amt=Math.min(capFree,E.nebResMean(pw.We,T.alloy)*rnd(0.7,1.3));const got={m:Math.floor(amt*sub[2][0]),k:Math.floor(amt*sub[2][1]),g:Math.floor(amt*sub[2][2])};
  for(const r in got){f.cargo[r]+=got[r];L.res[r]=(L.res[r]||0)+got[r]}rec.res=got;rec.sub=sub[0];
  const tx={planet:`Deine Flotte entdeckte einen verlassenen Planeten und belud die Frachträume: ${fmtR(got)}.`,wreck:`Ein uraltes Schiffswrack treibt im Nebel. Deine Crew zerlegte es: ${fmtR(got)}.`,ast:`Ein rohstoffreiches Asteroidenfeld! Die Abbautrupps förderten ${fmtR(got)}.`}[sub[0]];
  return (why?why+' ':'')+tx+(amt>=capFree&&capFree>0?' (Laderaum voll)':capFree<=0?' Kein freier Laderaum – nichts mitgenommen.':'')};
 const applyLoss=(lost)=>{for(const id in lost){f.ships[id]-=lost[id];if(f.ships[id]<=0)delete f.ships[id]}rec.loss=lost;const n=countShips(lost);
  if(!countShips(f.ships)){S.fleets=S.fleets.filter(z=>z!==f);rec.lost=true}return n};
 rec.outcome=out;
 switch(out){
  case 'safe':{const hp=S.planets[S.home];let pi={m:0,k:0,g:0};E._nb=1;try{pi=E.prodInfo(hp)}finally{E._nb=0}const got={m:Math.floor(Math.max(0,pi.m)*0.5),k:Math.floor(Math.max(0,pi.k)*0.5),g:Math.floor(Math.max(0,pi.g)*0.5)};const s=got.m+got.k+got.g;const lim=Math.min(capFree,5000);if(s>lim){const q=lim/Math.max(1,s);for(const r in got)got[r]=Math.floor(got[r]*q)}for(const r in got){f.cargo[r]+=got[r];L.res[r]=(L.res[r]||0)+got[r]}rec.res=got;text=`Deine erste Erkundung verlief sicher: Die Crew sammelte ${fmtR(got)}.`;break}
  case 'res':text=giveFind();break;
  case 'ships':{const b=E.nebBudget(pw.P,T.esp)*rnd(0.7,1.3);const cand=(T.ok||[]).filter(id=>N.POOL[id]&&shipVal(id)<=b);
    if(!cand.length){text=giveFind('Eine verlassene Rebellenstation – ohne brauchbare Schiffe, aber mit Vorräten.');rec.conv='ships';break}
    let sum=0;for(const id of cand)sum+=N.POOL[id];let x=random()*sum,pick=cand[cand.length-1];for(const id of cand){x-=N.POOL[id];if(x<0){pick=id;break}}
    const n=Math.floor(b/shipVal(pick));f.ships[pick]=(f.ships[pick]||0)+n;L.ships[pick]=(L.ships[pick]||0)+n;rec.ships={[pick]:n};rec.budget=Math.floor(b);
    text=`Eine verlassene Rebellenstation! ${fmtN(n)}× ${GE.SHIP[pick].n} schließen sich deiner Flotte an und fliegen mit nach Hause.`;break}
  case 'pirates':{const esc=E.nebEscort(ships,T);const fr=rnd(0.003,0.009)*(1-esc)/(1+0.02*((T.armour||0)+(T.shielding||0)))*g;rec.frac=fr;rec.escort=esc;
    const n=applyLoss(nebLose({...ships},fr));text=`Piraten überfielen deine Flotte. Nach einem kurzen Gefecht konnte sie entkommen${n?` – ${fmtN(n)} Schiffe gingen verloren`:' – ohne Verluste'}.`+(esc>0.05?` Deine Eskorte fing ${Math.round(esc*100)} % des Schadens ab.`:'')+(g<1?' Dein Guider verhinderte 35 % der Verluste.':'');if(rec.lost)text+=' Die gesamte Flotte ging verloren.';break}
  case 'nav':{const major=random()<0.1;const fr=(major?rnd(0.05,0.10):rnd(0.01,0.03))*g;rec.frac=fr;rec.major=major;
    const n=applyLoss(nebLose({...ships},fr));text=(major?'Ein schwerer Teilchensturm beschädigte die Flotte.':'Navigationsfehler im dichten Nebel.')+(n?` ${fmtN(n)} Schiffe gingen verloren.`:' Alle Schiffe kamen davon.')+(g<1?' Dein Guider verhinderte 35 % der Verluste.':'');if(rec.lost)text+=' Die gesamte Flotte ging verloren.';break}
  case 'delay':{const why=['Ein Asteroidenfeld versperrte den Rückweg.','Ein Reaktor fiel aus und musste repariert werden.','Ein Teilchensturm legte die Navigation lahm.'][ri(0,2)];const ex=f.dur*rnd(0.5,2);text=why+' Die Flotte kehrt verspätet zurück.';rec.delay=ex;f.phase='back';f.arrive=t+f.dur+ex;report('nebula',title,{text,neb:rec});return}
  case 'dm':{const left=E.nebDMLeft();if(left<=0){text=giveFind('Spuren Dunkler Materie – das Tageskontingent (40 DM) ist erreicht.');rec.conv='dm';break}
    const n=Math.min(left,ri(N.DM[0],N.DM[1]));S.nebDM=(S.nebDM||[]).filter(x=>x[0]>now()-N.WIN);S.nebDM.push([now(),n]);E.addDM(n,'n:'+f.id+':'+now());rec.dm=n;text=random()<0.5?`In einem verlassenen Schiff fand deine Crew ${n} Dunkle Materie.`:`Ein Alienwesen überließ deiner Flotte ${n} Dunkle Materie.`;break}
  case 'item':{const it=N.ITEMS[ri(0,N.ITEMS.length-1)];S.items[it]=(S.items[it]||0)+1;rec.items={[it]:1};text=`Im Nebel trieb ein Container mit Ausrüstung: 1× ${GE.ITEMS[it].n}.`;break}
  default:text=['Die Flotte durchkämmte den Nebel, fand aber nichts Verwertbares.','Leere. Nur kosmischer Staub, so weit die Sensoren reichen.','Seltsame Signale – doch ihre Quelle blieb verborgen.'][ri(0,2)];
 }
 report('nebula',title,{text,neb:rec});
 if(S.fleets.includes(f)){f.phase='back';f.arrive=t+f.dur}else nebQueueKick();
}
// Wiederholungsauftrag (für alle Spieler): Flottenvorlage, echter Bestand, pausiert mit Grund
E.nebRepeat=function(pid,ships,pct,count){count=Math.max(1,Math.min(E.NEB2.MAX,Math.floor(count)||1));
 const pl=S.planets[pid];if(!pl)return 'Planet fehlt';const to={g:pl.g,s:pl.s,p:16,moon:false};
 const e=E.send(pid,ships,to,'explore',pct);if(e)return e;const f=S.fleets[S.fleets.length-1];
 S.nebQ={pid,ships:{...f.ships},pct:pct||100,left:count-1,why:null,wait:0};f.q=1;if(!S.nebQ.left)S.nebQ=null;emit('change');return null};
E.nebStop=()=>{S.nebQ=null;emit('change')};
function nebQueueKick(){const q=S.nebQ;if(!q||q.left<=0){if(q&&q.left<=0)S.nebQ=null;return}
 if(S.fleets.some(f=>f.q))return; // die Auftragsflotte ist noch unterwegs
 const pl=S.planets[q.pid];if(!pl){q.why='Startplanet existiert nicht mehr';return}
 if(E.nebFree()<=0){q.wait=E.nebNextFree();q.why='Tageskontingent (25) erreicht – weiter ab '+new Date(q.wait).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});return}
 const ships={};for(const id in q.ships){const have=pl.ships[id]||0;if(have<Math.ceil(q.ships[id]*E.NEB2.QMIN)){q.why=`Zu wenige ${GE.SHIP[id].n} (${fmtN(have)}/${fmtN(q.ships[id])})`;q.wait=0;return}ships[id]=Math.min(have,q.ships[id])}
 const e=E.send(q.pid,ships,{g:pl.g,s:pl.s,p:16,moon:false},'explore',q.pct);
 if(e){q.why=e;q.wait=/Slots belegt/.test(e)?0:0;return}
 const f=S.fleets[S.fleets.length-1];f.q=1;q.left--;q.why=null;q.wait=0;if(q.left<=0)S.nebQ=null}
E.nebQueueKick=()=>{if(S.nebQ){S.nebQ.why=null;nebQueueKick();emit('change')}};
// ---------- Nebel Regelversion 1 (nur noch für Flotten, die vor der Umstellung gestartet sind) ----------
E.NEB={resCap:667,wreckCap:1334,astCap:4002,resMax:{m:10e6,k:6e6,g:8e6}};
function nebulaKey(f){return f.to.g+':'+f.to.s}
function nebulaResolve(f){
 const t=f.arrive;const ships=f.ships;const total=countShips(ships);const cap=E.cargoCap(ships)-(f.cargo.m+f.cargo.k+f.cargo.g);
 const combat=['lf','hf','cr','bs','ic','bo','de','dn','ib'].reduce((a,k)=>a+(ships[k]||0)*GE.SHIP[k].at,0);
 const combatShare=combat/Math.max(1,combat+total*5);
 const probes=ships.pr||0;
 const unstable=false;const pv=E.pve();
 // Budget-Anteil dieses Starts (beim Start reserviert); alte Flotten ohne Anteil: Anteil des aktuellen Fensters
 const share=f.safe?null:(f.share||E.nebShare(Math.min(E.NEB_MAX,Math.max(4,pv.n))));
 let W={res:30+(E.tl('espionage')>=6?8:0),wreck:9,ast:6,dm:10,ships:7+Math.min(25,Math.log10(probes+1)*5),items:6,gal:0,pirates:4+combatShare*14,aliens:2+combatShare*6,none:12,delay:6,early:3,black:1};
 if(unstable){W.res*=0.3;W.wreck*=0.3;W.ast*=0.3;W.none+=25}
 let sum=0;for(const k in W)sum+=W[k];let x=random()*sum,out='none';for(const k in W){x-=W[k];if(x<=0){out=k;break}}
 if(f.safe)out='safe';
 const rec={outcome:out,sent:{...ships},unstable};let text='',title='Nebelbericht';
 const bonus=1+0.02*E.tl('alloy');
 const fill=(capN,split,caps)=>{const eff=Math.min(cap,capN*GE.SHIP.rc.cargo);const tot=eff*rnd(0.5,1)*bonus;const got={};let i=0;
   for(const r of['m','k','g']){got[r]=Math.floor(Math.min(tot*split[i++],caps?caps[r]:Infinity,share?share[r]:Infinity))}const s=got.m+got.k+got.g;if(s>cap){const q=cap/s;for(const r in got)got[r]=Math.floor(got[r]*q)}
   for(const r in got)f.cargo[r]+=got[r];return got};
 const back=()=>{f.phase='back';f.arrive=t+f.dur};
 switch(out){
  case 'safe':{const hp=S.planets[S.home];let pi={m:0,k:0,g:0};E._nb=1;try{pi=E.prodInfo(hp)}finally{E._nb=0}const got={m:Math.floor(Math.max(0,pi.m)*0.5),k:Math.floor(Math.max(0,pi.k)*0.5),g:Math.floor(Math.max(0,pi.g)*0.5)};const s=got.m+got.k+got.g;const lim=Math.min(cap,5000);if(s>lim){const q=Math.max(0,lim)/s;for(const r in got)got[r]=Math.floor(got[r]*q)}for(const r in got)f.cargo[r]+=got[r];rec.res=got;text=`Deine erste Erkundung verlief sicher: Die Crew sammelte ${fmtR(got)}.`;break}
  case 'res':{const g=fill(E.NEB.resCap,[0.5,0.3,0.2],E.NEB.resMax);rec.res=g;text=`Deine Flotte entdeckte einen verlassenen Planeten voller Rohstoffe und belud die Frachträume: ${fmtR(g)}.`;break}
  case 'wreck':{const g=fill(E.NEB.wreckCap,[0.6,0.4,0]);rec.res=g;text=`Ein uraltes Schiffswrack treibt im Nebel. Deine Crew zerlegte es: ${fmtR(g)}.`;break}
  case 'ast':{const g=fill(E.NEB.astCap,[0.5,0.35,0.15]);rec.res=g;text=`Ein rohstoffreicher Asteroid! Die Abbautrupps förderten ${fmtR(g)}.`;break}
  case 'dm':{const n=Math.max(0,Math.min(25,E.NEB_DM_MAX-(pv.dm||0),Math.max(1,Math.round(total/4*rnd(0.4,1)))));pv.dm=(pv.dm||0)+n;E.addDM(n,'n:'+f.id+':'+now());rec.dm=n;if(!n){text='Die Flotte fand Spuren Dunkler Materie – doch das Tageskontingent (40 DM) ist ausgeschöpft.';break}text=random()<0.5?`In einem verlassenen Schiff fand deine Crew ${n} Dunkle Materie.`:`Ein Alienwesen überließ deiner Flotte ${n} Dunkle Materie.`;break}
  case 'ships':{ // Sonden-Trick: Fundmenge skaliert mit der Anzahl der Sonden (Wert-Budget, gedeckelt)
    const val=id=>{const c=GE.SHIP[id].c;return c[0]+c[1]+c[2]};let fv=0;for(const id in ships)fv+=ships[id]*val(id);
    const pshare=probes/Math.max(1,total);const budget=Math.min(fv*0.5,fv*rnd(0.03,0.12)*(1+pshare*2.5));
    const pool=budget>2e8?['lc','rc','cr','bs','de','ic']:budget>2e7?['sc','lc','rc','hf','cr','bs']:budget>1e6?['sc','lc','rc','lf','hf','cr']:['co','pr','sc','lc','lf','rc'];
    const got={};const parts=Math.min(pool.length,ri(1,4));let left=budget;
    for(let i=0;i<parts;i++){const id=pool[ri(0,pool.length-1)];const share=i===parts-1?left:left*rnd(0.3,0.7);left-=share;const n=Math.floor(share/val(id));if(n>0)got[id]=(got[id]||0)+n}
    // Progression v1: Schiffsfunde werden mit ihrem Kostenvektor gegen den Budget-Anteil verrechnet, kein garantiertes Ersatzschiff
    {const left={...(share||{m:0,k:0,g:0})};for(const id of Object.keys(got)){const c=GE.SHIP[id].c;let n=got[id];n=Math.min(n,...['m','k','g'].map((r,j)=>c[j]>0?Math.floor(left[r]/c[j]):Infinity));if(n>0){got[id]=n;['m','k','g'].forEach((r,j)=>left[r]-=n*c[j])}else delete got[id]}}
    if(!Object.keys(got).length){text='Eine verlassene Rebellenstation – leider ohne flugfähige Schiffe.';break}
    for(const id in got)f.ships[id]=(f.ships[id]||0)+got[id];rec.ships=got;text=`Eine verlassene Rebellenstation! Deine Flotte bringt ${Object.entries(got).map(([k,v])=>fmtN(v)+'× '+GE.SHIP[k].n).join(', ')} mit nach Hause.`;break}
  case 'items':{const lv2=random()<0.2;const types=['armor','energy','power','engine'];const it=types[ri(0,3)]+(lv2?'2':'1');const n=lv2?1:ri(1,10);S.items[it]=(S.items[it]||0)+n;rec.items={[it]:n};text=`Im Nebel trieben Container mit Ausrüstung: ${n}× ${GE.ITEMS[it].n}.`;break}
  case 'pirates':case 'aliens':{const ali=out==='aliens';const enemy={};for(const id in ships){const n=Math.ceil(ships[id]*rnd(0.1,0.35));if(n>0)enemy[id]=n}
    const tf=ali?1.3:0.7;const myT=E.techOf();const et={weapons:Math.round(myT.weapons*tf),shielding:Math.round(myT.shielding*tf),armour:Math.round(myT.armour*tf)};
    const B=E.simulate({units:ships,tech:myT,bonus:E.combatBonus(S.planets[f.from])},{units:enemy,tech:et,bonus:{at:ali?0.3:-0.3}});
    f.ships={...B.endA};rec.battle=packBattle(B,'Deine Erkundungsflotte',ali?'Aliens':'Piraten',{coord:f.to,attackerIsMe:true,nebula:true});
    text=ali?`Eine fremdartige Alienflotte griff an! Du hast ${countShips(B.lossA)} Schiffe verloren.`:`Piraten lauerten im Nebel! Du hast ${countShips(B.lossA)} Schiffe verloren.`;
    if(!countShips(f.ships)){if(cmdActive('guider')){for(const id in ships){const n=Math.floor(ships[id]*0.35);if(n)f.ships[id]=n}text+=' Dein Guider rettete 35 % der Flotte.'}else{S.fleets=S.fleets.filter(z=>z!==f);text+=' Die gesamte Flotte wurde zerstört.'}}
    break}
  case 'delay':{const why=['Ein Asteroidenfeld versperrte den Rückweg.','Ein Reaktor fiel aus und musste repariert werden.','Ein Teilchensturm legte die Navigation lahm.'][ri(0,2)];const ex=f.dur*rnd(0.5,2);text=why+' Die Flotte kehrt verspätet zurück.';rec.delay=ex;f.phase='back';f.arrive=t+f.dur+ex;report('nebula',title,{text,neb:rec});return}
  case 'early':{text=['Eine Raumanomalie schleuderte die Flotte zurück – sie kehrt früher heim.','Sonnenwind beschleunigt den Rückflug.'][ri(0,1)];f.phase='back';f.arrive=t+f.dur*0.5;report('nebula',title,{text,neb:rec});return}
  case 'black':{text='Ein Schwarzes Loch! Die gesamte Erkundungsflotte wurde verschluckt.';if(cmdActive('guider')){f.ships={};for(const id in ships){const n=Math.floor(ships[id]*0.35);if(n)f.ships[id]=n}text+=' Dein Guider rettete 35 % der Schiffe.';rec.lost=true;}else{S.fleets=S.fleets.filter(z=>z!==f);rec.lost=true;report('nebula',title,{text,neb:rec});return}break}
  default:text=['Die Flotte durchkämmte den Nebel, fand aber nichts Verwertbares.','Leere. Nur kosmischer Staub, so weit die Sensoren reichen.','Seltsame Signale – doch ihre Quelle blieb verborgen.'][ri(0,2)];
 }
 report('nebula',title,{text,neb:rec});
 if(S.fleets.includes(f))back();
}
// ---------- Piratenangriffe auf eigene Planeten ----------
// Progression v1: Punkte aus abgeschlossenen Stufen (deterministisch, serverseitig nachrechenbar)
E.dmaxUp=function(){try{const d=E.devPoints(S);S.dmax=Math.max(S.dmax||0,Math.floor(d.b+d.t))}catch(e){}return S.dmax}; // ZIP155: D_max monoton (Abriss senkt ihn nie)
E.devPoints=function(st){st=st||S;let b=0,t=0;for(const id of st.order||[]){const p=st.planets[id];if(!p||!p.b)continue;for(const k in p.b){if(!GE.BUILD[k])continue;for(let L=1;L<=(p.b[k]||0);L++){const c=costOf(GE.BUILD[k],L);b+=(c[0]+c[1]+c[2])/1000}}}
 for(const k in st.tech||{}){if(!GE.TECH[k])continue;for(let L=1;L<=(st.tech[k]||0);L++){const c=tRawCost(k,L);t+=2*(c[0]+c[1]+c[2])/1000}}return{b,t}};
E.fleetPoints=function(st){st=st||S;let fl=0;const add=(o,T)=>{for(const k in o||{}){const d=T[k];if(d)fl+=(+o[k]||0)*(d.c[0]+d.c[1]+d.c[2])/1000}};for(const id of st.order||[]){const p=st.planets[id];if(!p)continue;add(p.ships,GE.SHIP);add(p.def,GE.DEF)}for(const f of st.fleets||[])if(!f.npc)add(f.ships,GE.SHIP);for(const sv of st.saves||[])add(sv.ships,GE.SHIP);return fl}; // Review F24: Saveflug-Schiffe zählen
E.calcPoints=function(st){const d=E.devPoints(st),f=E.fleetPoints(st);return{b:Math.floor(d.b),t:Math.floor(d.t),f:Math.floor(f),dev:Math.floor(d.b+d.t),total:Math.floor(d.b+d.t+f)}};
E.totalPoints_old=function(){let fl=0;const add=(o,T)=>{for(const k in o){const d=T[k];if(d)fl+=o[k]*(d.c[0]+d.c[1]+d.c[2])/1000}};
 for(const id of S.order){const p=S.planets[id];add(p.ships,GE.SHIP);add(p.def,GE.DEF)}for(const f of S.fleets)if(!f.npc)add(f.ships,GE.SHIP);
 return Math.floor(S.pts.b+S.pts.t+fl)};
E.totalPoints=()=>E.calcPoints(S).total;
function scheduleRaid(t){S.nextRaid=t+rnd(10,24)*HOUR/Math.sqrt(S.speed)}
function launchRaid(t){const cands=S.order.filter(id=>!S.planets[id].moon);const pl=S.planets[cands[ri(0,cands.length-1)]];
 const pts=E.totalPoints();const lv=pts<20000?1:pts<100000?2:pts<500000?3:pts<2e6?4:5;let dv=0;for(const T of[[pl.def,GE.DEF],[pl.ships,GE.SHIP]])for(const k in T[0]){const d=T[1][k];if(d&&k!=='ss')dv+=T[0][k]*(d.c[0]+d.c[1]+d.c[2])}
 const budget=Math.max(40000,Math.min(pts*1000*0.08,Math.max(pts*1000*0.01,dv*rnd(0.6,1.15))));
 const types=lv<=1?['lf']:lv===2?['lf','hf']:lv===3?['lf','hf','cr']:lv===4?['hf','cr','bs']:['cr','bs','de'];const ships={};let b=budget;
 for(const ty of types){const d=GE.SHIP[ty];const v=d.c[0]+d.c[1]+d.c[2];const n=Math.floor(b/types.length/v);if(n>0)ships[ty]=n}ships.lc=Math.max(1,Math.round(budget/400000));
 const dur=Math.max(12*MIN,rnd(40,80)*MIN/Math.sqrt(S.speed));const f={id:S.nextFleet++,npc:true,mission:'attack',from:null,fromC:{g:pl.g,s:pl.s,p:16},to:{g:pl.g,s:pl.s,p:pl.p},target:pl.id,ships,cargo:{m:0,k:0,g:0},depart:t,arrive:t+dur,dur,phase:'out',tech:{weapons:Math.max(0,E.tl('weapons')-1),shielding:Math.max(0,E.tl('shielding')-1),armour:Math.max(0,E.tl('armour')-1)}};
 S.fleets.push(f);addLog(`⚠ ${E.lv(pl,'radar')>0?'Radar':'Frühwarnung'}: Piratenflotte im Anflug auf ${pl.name}!`,'warn');emit('raidwarn',f)}
E.raidsIncoming=()=>S.fleets.filter(f=>f.npc&&f.phase==='out'&&f.arrive>S.t).concat(E.extIncoming?E.extIncoming():[]);
E.fleetSave=function(pid){const pl=S.planets[pid];const f=E.raidsIncoming().find(x=>x.target===pid);if(!f)return 'Kein Angriff im Anflug';
 const sh={};let n=0;for(const k in pl.ships)if(k!=='ss'&&GE.SHIP[k]&&!GE.SHIP[k].stat&&pl.ships[k]>0){sh[k]=pl.ships[k];n+=sh[k]}if(!n)return 'Keine flugfähigen Schiffe';
 const fuel=Math.min(pl.r.g,Math.ceil(n*2));pl.r.g-=fuel;for(const k in sh)delete pl.ships[k];S.saves=S.saves||[];S.saves.push({pid,ships:sh,ret:f.arrive+15*MIN/Math.sqrt(S.speed)});
 addLog(`Saveflug: ${fmtN(n)} Schiffe von ${pl.name} in Sicherheit gebracht (${fmtN(fuel)} Gas)`,'fleet');S.flags.fleetSaved=1;emit('change');return null};
function saveReturn(s){S.saves=S.saves.filter(x=>x!==s);const pl=S.planets[s.pid]||S.planets[S.home];for(const k in s.ships)pl.ships[k]=(pl.ships[k]||0)+s.ships[k];addLog(`Saveflug zurück: Flotte wieder auf ${pl.name}`,'fleet')}
E.raidVisible=f=>{const pl=S.planets[f.target];return pl&&E.lv(pl,'radar')>0};
function raidArrive(f){const pl=S.planets[f.target];S.fleets=S.fleets.filter(x=>x!==f);if(!pl)return;
 const B=E.simulate({units:f.ships,tech:f.tech},{units:{...pl.ships,...pl.def},tech:E.techOf(),bonus:E.combatBonus(pl)});
 const sp=splitUnits(B.endD);const ssBefore=pl.ships.ss||0;pl.ships=sp.ships;const rebuilt={};
 Object.assign(rebuilt,E.rebuildDef(B.lossD,cmdActive('engineer')));
 pl.def={...sp.def};for(const d in rebuilt)pl.def[d]=(pl.def[d]||0)+rebuilt[d];
 let loot={m:0,k:0,g:0};if(B.winner==='a'){loot=lootCalc(pl.r,E.cargoCap(B.endA));for(const r in loot)pl.r[r]-=loot[r]}
 const k=ck(pl.g,pl.s,pl.p);if(B.debris.m+B.debris.k>0){const d=S.debris[k]||(S.debris[k]={m:0,k:0});d.m+=B.debris.m;d.k+=B.debris.k}
 let moon=false;if(!pl.moonId&&random()*100<B.moonChance){moon=!!E.addMoon(pl)}
 report('combat',`Piratenangriff auf ${pl.name} [${pl.g}:${pl.s}:${pl.p}]`,{battle:packBattle(B,'Piraten',pl.name+' (Du)',{loot,rebuilt,coord:{g:pl.g,s:pl.s,p:pl.p},attackerIsMe:false,moon})});
 if(moon)addLog('Aus den Trümmern hat sich ein Mond gebildet!','warn');}
// ---------- Kommandanten, Items, Shop, Galactonit ----------
E.hireCmd=function(k,days){const d=GE.COMMANDERS[k];if(!d||![7,30].includes(days))return 'Ungültiger Offiziersauftrag';const p=days===30?d.p30:d.p7;if(S.dm<p)return 'Zu wenig Dunkle Materie';S.dm-=p;S.cmd[k]=Math.max(now(),S.cmd[k]||0)+days*24*HOUR;emit('change');return null};
// Review V2 (F19): Items wirken 24 reale Stunden (unabhängig vom Tempo). Gleichartige Wirkung: nur die stärkste zählt (keine Addition).
// Gleiche Stärke verlängert um 24 h, höchstens 72 h im Voraus; am Deckel wird nichts verbraucht.
E.ITEM_MS=24*HOUR;E.ITEM_MAX=72*HOUR;
function itemSegments(it){const d=GE.ITEMS[it],t=now();if(!d)return[];
 return S.buffs.filter(b=>b.buff===d.buff&&b.end>t).map(b=>({v:b.v,it:b.it,duration:b.end-Math.max(t,b.start||t)})).filter(b=>b.duration>0);}
E.itemInfo=function(it){const d=GE.ITEMS[it];if(!d)return{capped:true,text:'Unbekannter Gegenstand'};
 const seg=itemSegments(it),used=seg.reduce((a,b)=>a+b.duration,0),capped=used+E.ITEM_MS>E.ITEM_MAX;
 const schedule=seg.concat({v:d.v,it,duration:E.ITEM_MS}).sort((a,b)=>b.v-a.v);let t=now();const parts=schedule.map(b=>{const x={...b,start:t,end:t+b.duration};t=x.end;return x});
 return{capped,end:t,segments:parts,text:capped?'Kein Platz für volle 24 Stunden (max. 72 h)':parts.map(b=>'+'+Math.round(b.v*100)+' % für '+(b.duration/HOUR).toFixed(1)+' h').join(' → ')};};
E.useItem=function(it){if(!(S.items[it]>0))return 'Nicht vorhanden';const inf=E.itemInfo(it);if(inf.capped)return inf.text;const d=GE.ITEMS[it];S.items[it]--;if(!S.items[it])delete S.items[it];
 S.buffs=S.buffs.filter(b=>b.buff!==d.buff&&b.end>now());for(const b of inf.segments)S.buffs.push({buff:d.buff,v:b.v,start:b.start,end:b.end,it:b.it});emit('change');return null;};
E.STORE=[
 {id:'armor1',n:GE.ITEMS.armor1.n,d:GE.ITEMS.armor1.d,dm:8,item:'armor1'},
 {id:'power1',n:GE.ITEMS.power1.n,d:GE.ITEMS.power1.d,dm:8,item:'power1'},
 {id:'energy1',n:GE.ITEMS.energy1.n,d:GE.ITEMS.energy1.d,dm:6,item:'energy1'},
 {id:'engine1',n:GE.ITEMS.engine1.n,d:GE.ITEMS.engine1.d,dm:6,item:'engine1'},
 {ic:'terraformer',id:'xfield',n:'Planetenerweiterung',d:'+3 Felder dauerhaft auf dem aktuellen Planeten (max. +15)',dm:60,xfield:3},
 {ic:'computer',id:'xslot',n:'Zusätzlicher Flottenslot',d:'+1 Flottenslot dauerhaft (max. 3 Käufe)',dm:120,xslot:1}];
E.buy=function(id,pid){const it=E.STORE.find(x=>x.id===id);if(!it)return 'Nicht im Angebot';if(S.dm<it.dm)return 'Zu wenig Dunkle Materie';const tp=S.planets[pid||S.cur];
 if(it.xfield&&(tp.moon||(tp.xf||0)>=15))return tp.moon?'Nur auf Planeten möglich':'Maximum erreicht (+15 Felder)';if(it.xslot&&(S.xslot||0)>=3)return 'Maximum erreicht (3 Zusatzslots)';S.dm-=it.dm;
 if(it.xfield)tp.xf=(tp.xf||0)+it.xfield;if(it.xslot)S.xslot=(S.xslot||0)+1;if(it.gen)S.gal.energy+=it.gen;
 if(it.give)giveRes(S.planets[pid||S.cur],it.give);if(it.item)S.items[it.item]=(S.items[it.item]||0)+1;
 emit('change');return null};
// Progression v1: einmal je 24-h-Fenster: 5 DM + 0,5 h Referenzproduktion
E.giftReady=()=>!E.pve().gift;
E.giftNext=()=>E.winEnd();
E.giftReward=function(){const b=E.budget('gift');return{m:b.m,k:b.k,g:b.g,dm:5}};
E.claimGift=function(paid){if(!E.giftReady())return 'Heute schon abgeholt';E.pve().gift=1;S.lastGift=now();if(!paid){const r=E.giftReward();E.addDM(r.dm,'g:'+E.winId());giveRes(S.planets[S.home],{m:r.m,k:r.k,g:r.g});E.bookIn('g:'+E.winId(),r)}addLog('Tagesgeschenk erhalten: 5 DM und Rohstoffe','gift');emit('change');return null};
// ---------- Galactonit v2: Steine nur aus PvP-Trümmerfeldern, 5 Steine → 1 Kern je Planet ----------
E.GAL={CORE:5,MIN_LOSS:1e5,PAIR:7*24*3600e3,TUT:1,CHANGE_LOSS:0.5,RISK:[0.5,0.4,0.3,0.2,0.1],PEACE_MS:7*24*3600e3,PEACE_NEB:20,PEACE_IND:0.25};
E.moonPct=d=>Math.min(20,Math.floor(Math.max(0,+d||0)/100000));
// Serverseitig: Galactonit-Wurf nach einem PvP-Kampf (einmal je Kampf). Rückgabe {a,d} Steine
// Review V2: Wurf-Schwelle = 100.000 Metall+Kristall im Trümmerfeld
E.galDebris=B=>((B&&B.debris&&(+B.debris.m||0)+(+B.debris.k||0))||0);
E.galRoll=function(B,moon,rnd){rnd=rnd||Math.random;if(!(E.galDebris(B)>=E.GAL.MIN_LOSS))return{a:0,d:0,why:'loss'};if(!(rnd()*100<B.moonChance))return{a:0,d:0,why:'roll'};return moon?{a:2,d:4}:{a:1,d:2}};
E.galSum=g=>{let n=+(g&&g.base)||0;for(const k in (g&&g.src)||{})n+=Math.max(0,+g.src[k]||0);return n};
E.galGrant=function(key,n){const g=S.gal;n=Math.max(0,Math.floor(+n||0));if(!n||g.src[key]!=null)return false;g.src[key]=n;g.st+=n;emit('change');return true};
E.cores=st=>{st=st||S;let n=0;for(const id of st.order||[]){const p=st.planets[id];if(p&&p.core)n++}return n};
E.makeCore=function(pid,fx){const pl=S.planets[pid];if(!pl||pl.moon)return 'Nur auf Planeten';if(!GE.CORES[fx])return 'Effekt unbekannt';if(pl.core)return 'Dieser Planet hat schon einen Kern';
 if(E.lv(pl,'galacto')<1)return 'Galactonit-Forschungszentrum auf diesem Planeten benötigt';if(S.gal.st<E.GAL.CORE)return `${E.GAL.CORE} Galactonit-Steine nötig`;
 S.gal.st-=E.GAL.CORE;pl.core=fx;S.flags.fused=1;S.flags.equipped=1;addLog(`Galactonit-Kern auf ${pl.name}: ${GE.CORES[fx].n}`,'ok');emit('change');return null};
// Effekt wechseln: 50 % Chance, dass der Kern dabei zerbricht
E.changeCore=function(pid,fx){const pl=S.planets[pid];if(!pl||!pl.core)return 'Kein Kern';if(!GE.CORES[fx]||fx===pl.core)return 'Anderen Effekt wählen';
 if(random()<E.coreRisk(pl)){pl.core=null;S.gal.lost=(S.gal.lost||0)+1;emit('change');return 'broken'}pl.core=fx;emit('change');return null};
// Review V2: Wechselbruchrisiko sinkt mit der Galactonitzentrumsstufe 50/40/30/20/10 %
E.coreRisk=pl=>{const L=Math.max(1,Math.min(5,E.lv(pl,'galacto')||1));return E.GAL.RISK[L-1]};
// Review V2 §7: friedliche Kernroute – höchstens 1 Stein je 7 reale Tage, frühestens nach 7 Kontotagen.
// Erfüllung: 20 reguläre Nebelauflösungen ODER Industrieprojekt (≥ ¼ der beim Start festgeschriebenen 24-h-Referenzproduktion an bezahlten, abgeschlossenen Ausbauten).
E.peace=()=>S.peace||(S.peace={st:0,ref:0,goal:0,r0:0,b0:0,last:0,n:0});
E.peaceStart=function(){const P=E.peace();if(P.st)return 'Projekt läuft bereits';const ref=E.refProd();P.st=now();P.ref=Math.floor((ref.m+ref.k+ref.g)*24);P.goal=Math.max(1,Math.ceil(P.ref*E.GAL.PEACE_IND));emit('change');return null;};
E.peaceInfo=function(){const P=E.peace(),t=now(),since=Math.max(P.st||t,P.last||0,t-E.GAL.PEACE_MS);
 const events=(S.progress||[]).filter(x=>x.t>=since&&x.t<=t);const neb=events.filter(x=>x.type==='neb').reduce((a,b)=>a+b.v,0),ind=events.filter(x=>x.type==='industry').reduce((a,b)=>a+b.v,0);
 const ready=Math.max((S.created||0)+E.GAL.PEACE_MS,(P.last||0)+E.GAL.PEACE_MS);
 return{active:!!P.st,neb,nebGoal:E.GAL.PEACE_NEB,ind,indGoal:P.goal,ready,timeOk:t>=ready,done:!!P.st&&(neb>=E.GAL.PEACE_NEB||ind>=Math.max(1,P.goal))};};
E.peaceKey=()=>'p'+(E.peace().n+1);
E.peaceApply=function(key,n){const P=E.peace();if(S.gal.src[key]!=null)return 'Bereits gebucht';const I=E.peaceInfo();if(key!==E.peaceKey()||n!==1||!I.timeOk||!I.done)return 'Projekt nicht erfüllt';if(!E.galGrant(key,n))return 'Bereits gebucht';P.n++;P.last=now();P.st=0;emit('change');return null;};
E.sockets=pl=>pl&&!pl.moon&&E.lv(pl,'galacto')>=1?1:0;
E.equippedOn=()=>null;
// ---------- Tutorial ----------
const anyColony=()=>E.colonies()>0;
const COND=[
 ()=>true,()=>E.maxB('metal_mine')>=1&&E.maxB('crystal_mine')>=1,()=>E.maxB('metal_mine')>=2,()=>E.maxB('power')>=2,()=>E.maxB('gas_mine')>=1,
 ()=>S.order.some(id=>S.planets[id].pct.gas_mine===60&&E.lv(S.planets[id],'gas_mine')>0),()=>E.maxB('robotics')>=2,()=>E.maxB('shipyard')>=1&&(S.built.rl||0)>=1,()=>!!S.flags.speedup,()=>!!S.flags.store,
 ()=>E.maxB('store')>=1,()=>!!S.flags.rename,()=>E.maxB('alliance')>=1&&!!S.ally,()=>E.maxB('lab')>=2&&E.tl('energy')>=1,
 ()=>E.maxB('shipyard')>=2&&E.tl('combustion')>=2&&(S.built.sc||0)>=1,()=>!!S.flags.spyDeportees,()=>!!S.flags.atkPurged,()=>E.tl('astro')>=1&&!!S.flags.nebula,
 ()=>!!S.flags.named,()=>!!S.flags.exported,()=>anyColony()&&E.tl('astro')>=2,()=>!!S.flags.transportCol,()=>!!S.flags.deployCol,()=>!!S.flags.atkInactive,()=>!!S.flags.recycled,
 ()=>E.maxB('radar')>=1,()=>E.maxB('galacto')>=1&&E.tl('discoverer')>=1,()=>!!S.flags.fused,()=>!!S.flags.equipped];
E.COND=COND;
E.giveReward=function(r,src){const pl=S.planets[S.home];giveRes(pl,r);if(src)E.bookIn(src,r);if(r.dm)E.addDM(r.dm,src||null);if(r.ships&&src){S.uIn=S.uIn||{};for(const id in r.ships)S.uIn[id]=(S.uIn[id]||0)+r.ships[id]}if(r.voucher)S.voucher=(S.voucher||0)+r.voucher;if(r.gal)E.galGrant('tut',1);
 if(r.gen)S.gal.energy+=r.gen;if(r.cmd)S.cmd[r.cmd[0]]=Math.max(now(),S.cmd[r.cmd[0]]||0)+r.cmd[1]*24*HOUR;
 if(r.ships)for(const id in r.ships){if(GE.DEF[id])pl.def[id]=(pl.def[id]||0)+r.ships[id];else pl.ships[id]=(pl.ships[id]||0)+r.ships[id]}emit('change')};
E.taskDone=()=>false; // Review B2: alte GE.TASKS-Auszahlung aus dem aktiven Spiel entfernt
E.claimTask=function(){return 'Nicht mehr verfügbar – Missionslog nutzen';if(!E.taskDone())return 'Aufgabe noch nicht erfüllt';const T=GE.TASKS[S.task];const r=T.r;const pl=S.planets[S.home];
 giveRes(pl,r);if(r.dm)E.addDM(r.dm);if(r.gal)E.galGrant('tut',1);
 if(r.gen)S.gal.energy+=r.gen;if(r.cmd)S.cmd[r.cmd[0]]=Math.max(now(),S.cmd[r.cmd[0]]||0)+r.cmd[1]*24*HOUR;
 if(r.ships)for(const id in r.ships){if(GE.DEF[id])pl.def[id]=(pl.def[id]||0)+r.ships[id];else pl.ships[id]=(pl.ships[id]||0)+r.ships[id]}
 addLog(`Aries: Aufgabe „${T.t}“ abgeschlossen – Belohnung erhalten!`,'task');S.task++;emit('task',S.task);emit('change');return null};
E.rewardText=function(r){const p=[];if(r.m)p.push(fmtN(r.m)+' Metall');if(r.k)p.push(fmtN(r.k)+' Kristall');if(r.g)p.push(fmtN(r.g)+' Gas');if(r.dm)p.push(r.dm+' DM');if(r.voucher)p.push(r.voucher+'× Beschleunigungsgutschein (10 Min.)');if(r.gal)p.push(r.gal+' Galactonit');if(r.gen)p.push(r.gen+' Galactonit-Energie');
 if(r.cmd)p.push(`${GE.COMMANDERS[r.cmd[0]].n} (${r.cmd[1]} Tage)`);if(r.ships)for(const id in r.ships)p.push(r.ships[id]+'× '+(GE.SHIP[id]||GE.DEF[id]).n);return p.join(' · ')};
// ---------- Zeitfortschritt (inkl. Offline-Nachholen) ----------
E.tick=function(to){to=to||now();let guard=0;const t0=S.t;
 while(guard++<100000){
  let next=to,kind=null,ref=null;
  for(const id of S.order){const pl=S.planets[id];if(pl.bq.length&&pl.bq[0].end<=next){next=pl.bq[0].end;kind='b';ref=pl}
   if(pl.sq.length){const e=sqEnd(pl.sq[0]);if(e<=next){next=e;kind='s';ref=pl}}}
  if(S.rq&&S.rq.end<=next){next=S.rq.end;kind='r'}
  for(const f of S.fleets)if(fleetEventTime(f)<=next){next=fleetEventTime(f);kind='f';ref=f}
  if(S.settings.raids&&S.nextRaid&&S.nextRaid<=next){next=S.nextRaid;kind='raid'}
  for(const s of S.saves||[])if(s.ret<=next){next=s.ret;kind='save';ref=s}
  if(S.nebQ&&S.nebQ.wait&&S.nebQ.wait<=next){next=S.nebQ.wait;kind='nq'}
  for(const b of S.buffs)for(const bt of [b.start||0,b.end])if(bt>S.t&&bt<=next){next=bt;kind='timer'}
  for(const end of Object.values(S.cmd||{}))if(end>S.t&&end<=next){next=end;kind='timer'}
  const boundary=(S.created||0)+(Math.floor(Math.max(0,S.t-(S.created||0))/(24*HOUR))+1)*24*HOUR;
  if(boundary<=next){next=boundary;kind='window'} // Review F19: Boni enden ereignisgenau (Offline = viele kurze Ticks)
  const weekEnd=(Math.floor(S.t/(7*24*HOUR))+1)*7*24*HOUR;if(weekEnd<=next){next=weekEnd;kind='week'}
  if(S.tutorialPlan&&S.tutorialPlan.wake&&S.tutorialPlan.wake<=next){next=S.tutorialPlan.wake;kind='plan'}
  for(const ce of cuEdges())if(ce>S.t&&ce<=next){next=ce;kind='cu'} // ZIP155 §2.6: Abschnittsgrenzen der Aufholreferenz
  next=Math.max(next,S.t);
  const dtH=(next-S.t)/HOUR;{const pc=E.clock,t0s=S.t;E.clock=()=>t0s;try{for(const id of S.order)produce(S.planets[id],dtH)}finally{E.clock=pc}}
  for(const id of S.order)progressYard(S.planets[id],next);
  S.t=next;
  const prev=E.clock;E.clock=()=>next; // Ereigniszeit als „jetzt“
  try{
  if(kind==='week'){if(E.weekly&&E.tutDone())E.weekly();}else if(kind==='window')E.pve();else if(kind==='b'){finishBuild(ref);E.dmaxUp()}else if(kind==='r'){finishResearch();E.dmaxUp()}else if(kind==='f')processFleet(ref);
  else if(kind==='timer'){S.buffs=S.buffs.filter(b=>b.end>next)}
  else if(kind==='raid'){launchRaid(next);scheduleRaid(next)}else if(kind==='save')saveReturn(ref);else if(kind==='nq'){S.nebQ.wait=0;nebQueueKick()}
  if(E.advanceTutorialPlan)E.advanceTutorialPlan();
  }finally{E.clock=prev}
  if(!kind)break;}
 if(S.settings.raids&&!S.nextRaid&&E.totalPoints()>=3000)scheduleRaid(S.t);
 if(!S.settings.raids)S.nextRaid=0;
 S.buffs=S.buffs.filter(b=>b.end>S.t);
 return S.t-t0;};
E.setSpeed=function(sp){S.speed=sp;emit('change')};
E.setRaids=function(enabled){if(typeof enabled!=='boolean')return 'Ungültiger Spielmodus';S.settings.raids=enabled;if(enabled)S.flags.pveMode=1;emit('change');return null;};
E.rename=function(pid,name){name=String(name||'').trim().slice(0,20);if(!name)return 'Name fehlt';S.planets[pid].name=name;S.flags.rename=1;emit('change');return null};
E.setPct=function(pid,id,v){if(!S.planets[pid]||!['metal_mine','crystal_mine','gas_mine','power','ss'].includes(id)||!Number.isInteger(v)||v<0||v>100)return 'Ungültiger Produktionsregler';S.planets[pid].pct[id]=v;if(v!==100)S.flags.pctTouched=1;emit('change')};
E.createAlly=function(name,tag){if(!E.maxB('alliance'))return 'Allianzdepot benötigt';name=String(name||'').trim();tag=String(tag||'').trim().toUpperCase().slice(0,5);if(name.length<3||tag.length<2)return 'Name (min. 3) und Kürzel (min. 2) angeben';S.ally={name,tag,created:now()};emit('change');return null};
E.abandon=function(pid){if(pid===S.home)return 'Der Heimatplanet kann nicht aufgegeben werden';const pl=S.planets[pid];if(S.fleets.some(f=>f.from===pid))return 'Flotten dieses Planeten sind unterwegs';
 S.colonized=S.colonized||{};const del=[pid];if(pl.moonId)del.push(pl.moonId);for(const d of del){delete S.planets[d];S.order=S.order.filter(x=>x!==d)}if(del.includes(S.cur))S.cur=S.home;emit('change');return null};
// ===== v41: Spielstand-Prüfung (Server rechnet nach und lehnt unmögliche Sprünge ab) =====
// prev/next = komplette Spielstände, dtMs = vom SERVER gemessene Zeit seit dem letzten akzeptierten Stand.
// Geprüft (nur Zuwächse – bestehende Stufen bleiben unangetastet):
//  1) Jede neue Gebäude-/Forschungsstufe erfüllt die Stufen-Regeln (GE.LVRULE, Labor-Stufe, Basis-req) und passt ins Lager.
//  2) Bauzeit: Summe der Bauzeiten (abzgl. Gratis-Fertigstellung) je Planet ≤ verstrichene Zeit × Bauschleifen + mit DM gekaufte Zeit.
//  3) Dunkle Materie wächst höchstens um die erreichbaren Belohnungen; Rohstoffe: Kosten ≤ Vorrat + Produktion + Belohnungen (großzügig).
E.validateSave=function(prev,next,dtMs,extraDM,galLed,evRes){extraDM=Math.max(0,+extraDM||0);const errs=[];if(!prev||!next||!next.planets)return errs;const keep=S;
 try{// Galactonit v2: Steine nur aus Server-Ledger (PvP) + einmal 1 Tutorial-Stein; Bestand + 5 je Kern (aktiv + zerbrochen) ≤ Basis + Quellen
  {const g0=prev.gal||{},g1=next.gal||{};if(g1.v>=2){const s0=g0.src||{},s1=g1.src||{};
   if(g0.v>=2&&(+g1.base||0)>(+g0.base||0))errs.push('Galactonit-Basis erhöht');if(g0.v>=2&&(+g1.lost||0)<(+g0.lost||0))errs.push('Galactonit-Kernverlust zurückgesetzt');
   for(const k in s0)if(s1[k]==null)errs.push('Galactonit-Quelle '+k+' entfernt');
   for(const k in s1){if(s0[k]!=null){if(+s1[k]!==+s0[k])errs.push('Galactonit-Quelle '+k+' geändert');continue}
    if(k==='tut'){if(+s1[k]>E.GAL.TUT)errs.push('Galactonit Tutorial > 1');continue}
    if(galLed&&!(galLed[k]!=null&&+galLed[k]===+s1[k]))errs.push('Galactonit '+k+' nicht vom Server belegt');else if(!galLed)errs.push('Galactonit '+k+' ohne Ledger')}
   if(Object.values(s1).some(x=>!(+x>=0)))errs.push('Galactonit-Quelle ungültig');
   const have=(+g1.st||0)+E.GAL.CORE*(E.cores(next)+(+g1.lost||0));const can=E.galSum(g1);if((+g1.st||0)<0||have>can)errs.push(`Galactonit ${have} > belegt ${can}`);
   for(const id of next.order||[]){const p=next.planets[id];if(p&&p.core&&(!GE.CORES[p.core]||p.moon))errs.push('Galactonit-Kern ungültig')}}}
S=next;const dt=Math.max(0,dtMs);const t0=+prev.t||0;const days=dt/864e5;
  // Progression v1: DM-Ledger statt Zeitgutschrift – nur verdiente DM (dmLed) dürfen den Bestand erhöhen bzw. Beschleunigung bezahlen
   // Review F05: DM nur aus bestätigten Quellen (dmSrc). Die bisherige Pauschale 60+50 je Tag entfällt; Altstände (rv<5) einmalig wie bisher.
   const v5=+prev.rv>=5;let earned=extraDM;const days1=Math.ceil(days+1e-9)+1;
   if(v5){const d0=prev.dmSrc||{},d1=next.dmSrc||{};let nS=0;const wk={};
    for(const k in d0)if(d1[k]==null||+d1[k]<+d0[k])errs.push('DM-Quelle '+k+' entfernt');
    for(const k in d1){const v=(+d1[k]||0)-(+d0[k]||0);if(!(v>=0)){errs.push('DM-Quelle '+k+' ungültig');continue}if(!v)continue;const ty=k.split(':')[0];
     if(ty==='a')continue; // Admin-Geschenke: serverseitig über extraDM belegt
     if(ty==='n'){if(v>25)errs.push('Nebel-DM '+k+' > 25');nS+=v;earned+=v;continue}
     if(ty==='g'){if(d0[k]!=null||v>5)errs.push('Tagesgeschenk-DM '+k);earned+=Math.min(v,5);continue}
     if(ty==='c'){const id=k.slice(2);const mx=(GE.CAMP_DM||{})[id];if(d0[k]!=null||mx==null||v>mx)errs.push('Kampagnen-DM '+k+' unbelegt');else earned+=v;continue}
     if(ty==='w'){const w=k.split(':')[1];wk[w]=(wk[w]||0)+1;if(d0[k]!=null||v>5||wk[w]+Object.keys(d0).filter(x=>x.startsWith('w:'+w+':')).length>3)errs.push('Wochenziel-DM '+k);else earned+=v;continue}
     errs.push('DM-Quelle '+k+' unbekannt')}
    if(nS>E.NEB_DM_MAX*days1)errs.push(`Nebel-DM ${nS} > ${E.NEB_DM_MAX*days1}`);
    const led=(+next.dmLed||0)-(+prev.dmLed||0);if(led>earned+0.5)errs.push(`DM-Ledger +${Math.round(led)} ohne Quelle (belegt ${Math.round(earned)})`)}
   else{const earnRaw=Math.max(0,(+next.dmLed||0)-(+prev.dmLed||0)-extraDM),earnCap=60+50*Math.ceil(days+1e-9);if(earnRaw>earnCap)errs.push(`DM-Ledger +${Math.round(earnRaw)} (erlaubt ${Math.round(earnCap)})`);earned=Math.min(earnRaw,earnCap)+extraDM;
    if(!(+prev.rv>=2))earned=Math.max(earned,Math.min(Math.max(0,(+next.dm||0)-(+prev.dm||0)),80+60*days))}
   const dmGain=(+next.dm||0)-(+prev.dm||0);if(dmGain>earned+(v5?0:5))errs.push(`DM +${Math.round(dmGain)} (verdient ${Math.round(earned)})`);
   // Review F01: Rohstoffzuflüsse nur aus gebuchten Quellen (rIn)
   let inAllow=0;{const r0=prev.rIn||{},r1=next.rIn||{};if(v5){for(const k in r0)if(r1[k]==null||+r1[k]<+r0[k])errs.push('Zufluss '+k+' entfernt');
    let npc=0,gift=0;const ref=(()=>{try{return E.refProd()}catch(e){return{m:0,k:0,g:0}}})();const refS=(ref.m+ref.k+ref.g);
    for(const k in r1){const v=(+r1[k]||0)-(+r0[k]||0);if(!(v>=0)){errs.push('Zufluss '+k+' ungültig');continue}if(!v)continue;const ty=k.split(':')[0];
     if(ty==='l'){npc+=v;inAllow+=v;continue}
     if(ty==='g'){gift+=v;inAllow+=v;continue}
     if(ty==='c'){if(v>(GE.CAMP_RES_MAX||5e6))errs.push('Zuschuss '+k+' zu hoch');else inAllow+=v;continue}
     if(ty==='w'){continue}
     if(ty==='e'){const id=k.slice(2);if(evRes&&!(evRes[id]!=null&&+evRes[id]+1>=v))errs.push('Ereignis-Zufluss '+k+' unbelegt');else inAllow+=v;continue}
     if(ty==='r'){inAllow+=v;continue}
     errs.push('Zufluss '+k+' unbekannt')}
    if(npc>E.BUDGET_H.npc*refS*days1*1.3+1000)errs.push(`NPC-Beute ${Math.round(npc)} > Budget`);
    if(gift>E.BUDGET_H.gift*refS*days1*1.3+1000)errs.push(`Tagesgeschenk-Rohstoffe ${Math.round(gift)} > Budget`)}}
  const dmSpent=Math.max(0,(+prev.dm||0)+earned-(+next.dm||0));const dmMs=Math.pow(dmSpent/0.75,1/0.9)*60e3+Math.max(0,(+((next.flags||{}).vUsed)||0)-(+((prev.flags||{}).vUsed)||0))*E.VOUCHER_MS;
  const tech0=prev.tech||{},tech1=next.tech||{};const qMax=((next.flags&&next.flags.tutDone)?4:2)+((next.cmd&&next.cmd.commander>(next.t||0))?1:0);/* = E.queueMax() für den geprüften Save */let costAll=0,resPrev=0,prodH=0,timeT=0;
  // Nebel v2: Startfenster (≤25 je rollierenden realen 24 h, keine gelöschten Starts) und Fund-Ledger (Schiffe/Rohstoffe je Auflösung begrenzt)
  const nebShip={},nebRes={m:0,k:0,g:0};let nebResAllow=0;
  {const N=E.NEB2,L0=prev.nebL||{n:0,r:0,ships:{},res:{}},L1=next.nebL||{n:0,r:0,ships:{},res:{}};const T0=(prev.nebT||[]).slice().sort((a,b)=>a-b),T1=(next.nebT||[]).slice().sort((a,b)=>a-b);
   const dn=(+L1.n||0)-(+L0.n||0),dr=(+L1.r||0)-(+L0.r||0);
   if(dn<0||dr<0)errs.push('Nebel-Zähler zurückgesetzt');
   const tMax=Math.max(+next.t||0,t0);const keep=T0.filter(x=>x>tMax-N.WIN);const set=new Set(T1);if(keep.some(x=>!set.has(x)))errs.push('Nebel-Starts gelöscht');
   const newT=T1.filter(x=>!T0.includes(x));if(newT.length>Math.max(0,dn))errs.push(`Nebel-Starts ${newT.length} ohne Zähler`);
   if(newT.some(x=>x>tMax+5*60e3||x<t0-N.WIN))errs.push('Nebel-Startzeit unplausibel');
   for(let i=0;i<T1.length;i++){let c=0;for(let j=i;j>=0&&T1[j]>T1[i]-N.WIN;j--)c++;if(c>N.MAX){errs.push(`Mehr als ${N.MAX} Nebel-Starts in 24 h`);break}}
   const newF=(next.fleets||[]).filter(f=>f.mission==='explore'&&!f.npc&&f.id>=(+prev.nextFleet||0));if(newF.length>Math.max(0,dn))errs.push('Nebelflotte ohne gezählten Start');
   if(newF.some(f=>!(f.nv>=2)))errs.push('Nebelflotte mit alter Regelversion');
   const openPrev=(prev.fleets||[]).filter(f=>f.mission==='explore'&&!f.npc&&f.nv>=2).length;if(dr>Math.max(0,dn)+openPrev)errs.push('Mehr Nebel-Auflösungen als Starts');
   // Obergrenze je Auflösung aus dem größeren Bestand (vorher/nachher) – eine Flotte kann höchstens den gesamten Bestand enthalten
   const tot=st=>{const o={};for(const id of st.order||[]){const p=st.planets[id];if(p)for(const k in p.ships||{})o[k]=(o[k]||0)+(p.ships[k]||0)}for(const f of st.fleets||[])if(!f.npc)for(const k in f.ships||{})o[k]=(o[k]||0)+(f.ships[k]||0);return o};
   const a0=tot(prev),a1=tot(next),mx={};for(const k of new Set([...Object.keys(a0),...Object.keys(a1)]))mx[k]=Math.max(a0[k]||0,a1[k]||0);
   const pw=E.nebPower(mx),cap=E.cargoCap(mx),esp=Math.max(tech0.espionage||0,tech1.espionage||0),alloy=Math.max(tech0.alloy||0,tech1.alloy||0);
   const k=Math.max(0,dr);const shipMax=k*E.nebBudget(pw.P,esp)*1.3+1;const resMax=k*Math.min(cap,E.nebResMean(pw.We,alloy)*1.3)+(k?2e5:0); // + sichere Tutorial-Erkundung (0,5 h Hauptweltproduktion)
   let sv=0;for(const u in L1.ships||{}){const d=(+L1.ships[u]||0)-(+(L0.ships||{})[u]||0);if(d<0){errs.push('Nebel-Ledger '+u+' gesunken');continue}if(d>0){if(!GE.SHIP[u]||!N.POOL[u]){errs.push('Nebelfund '+u+' nicht im Fundpool');continue}nebShip[u]=d;sv+=d*E.shipVal(u)}}
   if(sv>shipMax)errs.push(`Nebel-Schiffsfunde ${Math.round(sv)} > möglich ${Math.round(shipMax)}`);
   let rv=0;for(const r of['m','k','g']){const d=(+(L1.res||{})[r]||0)-(+(L0.res||{})[r]||0);if(d<0)errs.push('Nebel-Ledger Rohstoffe gesunken');nebRes[r]=Math.max(0,d);rv+=Math.max(0,d)}
   if(rv>resMax)errs.push(`Nebel-Rohstofffunde ${Math.round(rv)} > möglich ${Math.round(resMax)}`);nebResAllow=Math.min(rv,resMax)}
  for(const id of next.order||[]){const p1=next.planets[id],p0=prev.planets&&prev.planets[id];if(!p1||!p0||p1.moon)continue;
   resPrev+=(p0.r.m||0)+(p0.r.k||0)+(p0.r.g||0);try{const pi=E.prodInfo(p1);prodH+=Math.max(0,pi.m)+Math.max(0,pi.k)+Math.max(0,pi.g)}catch(e){prodH+=1e5}
   let tB=0;const sim={...p1,b:{...p0.b},bq:[]};
   for(const b of Object.keys(p1.b||{})){const a=p0.b[b]||0,z=p1.b[b]||0;if(z<=a)continue;
    for(let L=a+1;L<=z;L++){if(!GE.BUILD[b])continue;if(L>E.bCapLv(b))errs.push(`${b} ${L}: über Funktionsdeckel ${E.bCapLv(b)}`);const pq=(p0.bq||[]).find(q=>q.id===b&&q.lv===L&&!q.demo);const bad=E.bReqs({...sim,b:{...p1.b,[b]:L-1}},b,L,tech1).filter(x=>!x.ok);if(bad.length)errs.push(`${b} ${L}: Benötigt ${bad.map(x=>x.id+' '+x.need).join(', ')}`);
     const pL={...p1,b:{...p1.b,[b]:L-1}};
     // v45: schon im letzten Stand eingereiht → bezahlt; nur die Restzeit nach diesem Stand zählt (Offline-Fortschritt)
     if(pq){tB+=Math.max(0,Math.min(pq.end-Math.max(pq.start,t0),E.bTime(pL,b,L)*1000)-E.FREE_MS);continue}
     const c=E.bCost(b,L,pL);costAll+=c[0]+c[1]+c[2];if(!E.storeOk(p1,c))errs.push(`${b} ${L}: Lager zu klein`);
     tB+=Math.max(0,E.bTime(pL,b,L)*1000-E.FREE_MS)}}
   if(tB>dt*qMax+dmMs+120e3)errs.push(`Bauzeit ${Math.round(tB/60e3)} min in ${Math.round(dt/60e3)} min`);
  }
  // v42: Schiffe/Verteidigung: Zuwachs (Summe aller Planeten + Flotten) braucht Werft + Forschung (Basis-req); Kosten & Werftzeit zählen.
  // Toleranz 25 Einheiten je Typ (Funde im Nebel, Belohnungen).
  {const uGift={};{const u0=prev.uIn||{},u1=next.uIn||{};for(const k in u1){const d=(+u1[k]||0)-(+u0[k]||0);if(d<0){errs.push('Schiffsgeschenk-Ledger gesunken');continue}let mx=0;for(const t in GE.CAMP_SHIPS||{})mx+=(GE.CAMP_SHIPS[t][k]||0);if((+u1[k]||0)>mx)errs.push('Schiffsgeschenk '+k+' unbelegt');else if(d>0)uGift[k]=d}}
   const tot=(st,key)=>{const o={};for(const id of st.order||[]){const p=st.planets[id];if(!p)continue;for(const k in p[key]||{})o[k]=(o[k]||0)+(p[key][k]||0)}
    if(key==='ships'){for(const f of st.fleets||[])if(!f.npc)for(const k in f.ships||{})o[k]=(o[k]||0)+(f.ships[k]||0);for(const x of st.saves||[])for(const k in x.ships||{})o[k]=(o[k]||0)+(x.ships[k]||0)}return o};
   const yard=Math.max(0,...(next.order||[]).map(i=>((next.planets[i]||{}).b||{}).shipyard||0));const bmax=k=>Math.max(0,...(next.order||[]).map(i=>((next.planets[i]||{}).b||{})[k]||0));
   const yp={...(next.planets[next.home]||{}),b:{...((next.planets[next.home]||{}).b||{}),shipyard:yard}};let tU=0;
   const qd={};for(const id of prev.order||[]){const p=prev.planets[id];for(const q of (p&&p.sq)||[]){const left=Math.max(0,(q.n||0)-(q.done||0));if(!left)continue;const k=q.kind+':'+q.id;const o=qd[k]||(qd[k]={n:0,t:0});o.n+=left;o.t+=Math.max(0,q.start+q.ut*q.n-Math.max(q.start+q.ut*(q.done||0),t0))}}
   for(const [kind,tab,key] of [['ship',GE.SHIP,'ships'],['def',GE.DEF,'def']]){const h0=tot(prev,key),h1=tot(next,key);
    for(const u of Object.keys(h1)){let n=(h1[u]||0)-(h0[u]||0);if(n<=0||!tab[u])continue;
     if(kind==='ship'&&nebShip[u]){n-=Math.min(n,nebShip[u]);if(n<=0)continue}
      if(kind==='ship'&&uGift[u]){n-=Math.min(n,uGift[u]);if(n<=0)continue}
     const pq=qd[kind+':'+u];if(pq){const m=Math.min(n,pq.n);tU+=pq.t*(m/pq.n);n-=m;if(n<=0)continue}
     const bad=Object.keys(tab[u].req||{}).filter(k=>(GE.TECH[k]?(tech1[k]||0):bmax(k))<tab[u].req[k]);
     if(bad.length&&(n>25||v5))errs.push(`${u} +${n}: Benötigt ${bad.map(k=>k+' '+tab[u].req[k]).join(', ')}`);
     if(!bad.length){costAll+=n*(tab[u].c[0]+tab[u].c[1]+tab[u].c[2]);tU+=n*E.uTime(yp,kind,u)*1000}}}
   // Review F13: jede Werft hat ihre eigene Zeit (Kapazität = Anzahl Werften × dt); Altstände wie bisher
   const nY=Math.max(1,(next.order||[]).filter(i=>(((next.planets[i]||{}).b||{}).shipyard||0)>0).length);
   if(v5?(tU>dt*nY+dmMs+120e3&&tU>0):(tU>dt*1.5+dmMs+600e3&&tU>0))errs.push(`Werftzeit ${Math.round(tU/60e3)} min in ${Math.round(dt/60e3)} min`)}
  const home=next.planets[next.home]||next.planets[next.order[0]];
  for(const t of Object.keys(tech1)){const a=tech0[t]||0,z=tech1[t]||0;if(z<=a||!GE.TECH[t])continue;const labMax=Math.max(...(next.order||[]).map(i=>(next.planets[i].b||{}).lab||0));
   const lp={...home,b:{...(home.b||{}),lab:labMax}};
   for(let L=a+1;L<=z;L++){if(L>E.tCapLv(t))errs.push(`${t} ${L}: über Funktionsdeckel ${E.tCapLv(t)}`);const bad=E.tReqs(lp,t,L,{...tech1,[t]:L-1}).filter(x=>!x.ok);if(bad.length)errs.push(`${t} ${L}: Benötigt ${bad.map(x=>x.id+' '+x.need).join(', ')}`);
    const rq=prev.rq;if(rq&&rq.id===t&&rq.lv===L){timeT+=Math.max(0,Math.min(rq.end-Math.max(rq.start,t0),E.tTime(t,L,(prev.rq&&next.planets[prev.rq.pid])||(next.rq&&next.planets[next.rq.pid])||home)*1000)-E.FREE_MS);continue}
    const c=E.tCost(t,L,home);costAll+=c[0]+c[1]+c[2];timeT+=Math.max(0,E.tTime(t,L,(prev.rq&&next.planets[prev.rq.pid])||(next.rq&&next.planets[next.rq.pid])||home)*1000-E.FREE_MS)}}
  // Review F03: neue, noch offene Aufträge sind beim Einreihen bezahlt – Preis prüfen und in die Kostenbilanz aufnehmen
  if(v5){const key=q=>q.id+':'+q.lv+':'+q.start;for(const id of next.order||[]){const p1=next.planets[id],p0=prev.planets&&prev.planets[id];if(!p1)continue;const old=new Set(((p0&&p0.bq)||[]).map(key));
    for(const q of p1.bq||[]){if(old.has(key(q))||q.demo)continue;const c=E.bCost(q.id,q.lv,{...p1,b:{...p1.b,[q.id]:q.lv-1}});const pc=q.cost||[0,0,0];if(pc[0]+pc[1]+pc[2]<c[0]+c[1]+c[2]-1)errs.push(`Auftrag ${q.id} ${q.lv} unterbezahlt`);if(q.lv>E.bCapLv(q.id))errs.push(`Auftrag ${q.id} ${q.lv} über Deckel`);costAll+=c[0]+c[1]+c[2]}
    const so=new Set(((p0&&p0.sq)||[]).map(q=>q.id+':'+q.start+':'+q.n));for(const q of p1.sq||[]){if(so.has(q.id+':'+q.start+':'+q.n))continue;const d=E.unitDef(q.kind,q.id);if(!d){errs.push('Werftauftrag unbekannt');continue}costAll+=Math.max(0,(q.n||0)-(q.done||0))*(d.c[0]+d.c[1]+d.c[2])}}
   const rq=next.rq;if(rq&&!(prev.rq&&prev.rq.id===rq.id&&prev.rq.lv===rq.lv)){const c=E.tCost(rq.id,rq.lv,home);const pc=rq.cost||[0,0,0];if(pc[0]+pc[1]+pc[2]<c[0]+c[1]+c[2]-1)errs.push(`Forschung ${rq.id} ${rq.lv} unterbezahlt`);if(rq.lv>E.tCapLv(rq.id))errs.push(`Forschung ${rq.id} ${rq.lv} über Deckel`);costAll+=c[0]+c[1]+c[2]}}
  if(timeT>dt+dmMs+120e3)errs.push(`Forschungszeit ${Math.round(timeT/60e3)} min in ${Math.round(dt/60e3)} min`);
  // Review F01/F04: ohne Pauschaltoleranz – Vorrat + Produktion + gebuchte Zuflüsse + Fracht unterwegs + erstattbare offene Aufträge (Altstände einmalig wie bisher)
  let carry=0;for(const f of prev.fleets||[])if(!f.npc&&f.cargo)carry+=(+f.cargo.m||0)+(+f.cargo.k||0)+(+f.cargo.g||0);
  for(const id of prev.order||[]){const p=prev.planets[id];for(const q of (p&&p.bq)||[])if(!q.demo&&q.cost)carry+=q.cost[0]+q.cost[1]+q.cost[2];for(const q of (p&&p.sq)||[]){const d=E.unitDef(q.kind,q.id);if(d)carry+=Math.max(0,(q.n||0)-(q.done||0))*(d.c[0]+d.c[1]+d.c[2])}}
  if(prev.rq&&prev.rq.cost)carry+=prev.rq.cost[0]+prev.rq.cost[1]+prev.rq.cost[2];
  const allow=v5?resPrev+prodH*(dt/36e5)*1.5+inAllow+nebResAllow+carry+1000:resPrev+prodH*(dt/36e5)*1.5+300000+costAll*0.1+nebResAllow;if(costAll>allow)errs.push(`Kosten ${Math.round(costAll)} > möglich ${Math.round(allow)}`);
 }finally{S=keep}return errs};
E.fork=()=>makeEngine({GE});E.buildPreview=function(pl,id){const L=E.lv(pl,id),next={...pl,b:{...pl.b,[id]:L+1}},a=E.prodInfo(pl),b=E.prodInfo(next),o={prod:{m:b.m-a.m,k:b.k-a.k,g:b.g-a.g},energy:b.eProd-b.eUse,energyBefore:a.eProd-a.eUse};
 if(id==='lab'){const t=S.rq||{id:'weapons',lv:E.nextTL('weapons')};o.research={id:t.id,lv:t.lv,before:E.tTime(t.id,t.lv,pl),after:E.tTime(t.id,t.lv,next)};}
 if(['robotics','nanite'].includes(id)){const t='metal_mine',lv=Math.min(40,E.nextLevel(pl,t));o.build={before:E.bTime(pl,t,lv),after:E.bTime(next,t,lv)};}return o;};
E.techPreview=function(id){const a=E.refProd(),old=E.tl(id);S.tech[id]=old+1;let b;try{b=E.refProd();}finally{if(old)S.tech[id]=old;else delete S.tech[id];}return{m:b.m-a.m,k:b.k-a.k,g:b.g-a.g};};
root.ENGINE=E; if(typeof module!=='undefined')module.exports=E;return E;
})(typeof window!=='undefined'?window:globalThis);
