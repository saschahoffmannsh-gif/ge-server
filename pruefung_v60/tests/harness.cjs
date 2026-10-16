'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=path.resolve(__dirname,'..');
const SOURCE=fs.existsSync(path.join(ROOT,'client/js/engine.js'))?ROOT:path.join(ROOT,'source/galaxy-empire-code');
const clone=x=>JSON.parse(JSON.stringify(x));
function random(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
function stub(){return {style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},remove(){},querySelector(){return stub()},querySelectorAll(){return[]},addEventListener(){},getBoundingClientRect(){return {left:0,top:0,width:0,height:0,right:0,bottom:0}}}}
function create(seed=123,opts={}){
 let clock=Date.UTC(2026,9,15),rand=random(seed),forced=[];
 const math=Object.create(Math);math.random=()=>forced.length?forced.shift():rand();
 class ClockDate extends Date {constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}}
 const storage=new Map();const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const context={console,Math:math,Date:ClockDate,Float64Array,Uint8Array,TextEncoder,TextDecoder,Response,Request,Headers,Blob,CompressionStream,DecompressionStream,URL,crypto:globalThis.crypto,atob,btoa,
  localStorage,sessionStorage:localStorage,document:{body:stub(),hidden:false,visibilityState:'visible',createElement:()=>stub(),querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},
  setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},addEventListener(){},requestAnimationFrame(){},navigator:{},innerWidth:400,innerHeight:800,
  PANELS:{settings:()=>['','']},GAME:{},save(){},renderAll(){},renderPanel(){},toast(){},err:x=>x,esc:String,$:()=>null,IC:{},A:{img:()=>''},pl:()=>context.ENGINE.planet(),fmt:String,ft:String,setHTML(){},closePop(){}};
 context.window=context;context.globalThis=context;context.module={exports:{}};
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(SOURCE,'client/js/data.js'),'utf8'),context,{filename:'data.js'});
 context.GE=context.module.exports;context.module={exports:{}};
 if(opts.dataPatch)opts.dataPatch(context.GE,context);
 let eng=fs.readFileSync(path.join(SOURCE,'client/js/engine.js'),'utf8');
 if(opts.enginePatch)eng=opts.enginePatch(eng);
 if(opts.exposeNeb)eng=eng.replace('root.ENGINE=E;', 'E.__auditResolve=nebulaResolve2;root.ENGINE=E;');
 if(opts.instrument){eng=eng.replace('const add=pi[r]*dtH;','const add=pi[r]*dtH;const auditBefore=pl.r[r];').replace('else if(pl.r[r]<cap)pl.r[r]=Math.min(cap,pl.r[r]+add);}', 'else if(pl.r[r]<cap)pl.r[r]=Math.min(cap,pl.r[r]+add);if(root.__auditProduction)root.__auditProduction(r,pl.r[r]-auditBefore,Math.max(0,add-(pl.r[r]-auditBefore)));}')};
 vm.runInContext(eng,context,{filename:'engine.js'});
 const E=context.ENGINE;context.E=E;E.clock=()=>clock;
 const start=(speed=10)=>{context.S=E.newGame({seed,speed});if(opts.multiplayer!==false){context.S.planets.P1.temp=40;E.mp=true}return context.S};
 start();
 if(opts.campaign!==false){let src=fs.readFileSync(path.join(SOURCE,'client/js/campaign.js'),'utf8');if(opts.campaignPatch)src=opts.campaignPatch(src);src=src.replace('})(typeof window', 'window.AUDIT_CAMP={done,claimSide,wk,curMain,tReward,needCost,storeFor,WK_DEF,claimWeek};})(typeof window');vm.runInContext(src,context,{filename:'campaign.js'});context.CAMP.init()}
 if(opts.campaign!==false)vm.runInContext(fs.readFileSync(path.join(SOURCE,'client/js/planning.js'),'utf8'),context);
 if(opts.campaign!==false&&fs.existsSync(path.join(SOURCE,'client/js/actions.js')))vm.runInContext(fs.readFileSync(path.join(SOURCE,'client/js/actions.js'),'utf8'),context);
 if(opts.after)opts.after(E,context.GE,context);
 return{E,GE:context.GE,ctx:context,root:ROOT,source:SOURCE,clone,
  get S(){return context.S},get t(){return clock},set t(v){clock=v},
  tick(t){clock=t;E.tick(t);return context.S},force(...v){forced=v},
  reset(){start();if(context.CAMP)context.CAMP.init();return context.S},
  load(s){context.S=E.load(s);return context.S},run(src){return vm.runInContext(src,context)}};
}
module.exports={create,ROOT,SOURCE,clone,random};
