const fs=require('fs'),vm=require('vm'),path=require('path'),zlib=require('zlib');
const {create,clone,SOURCE}=require('./harness.cjs');const h=create();
vm.runInContext(fs.readFileSync(path.join(SOURCE,'server/supabase/functions/ge/protocol.js'),'utf8'),h.ctx);
const rows=JSON.parse(fs.readFileSync('/workspace/nc_bak/ge_save.json'));const now=Date.now();h.t=now;
for(const r of rows){const st=JSON.parse(zlib.gunzipSync(Buffer.from(r.z,'base64')));st.debris=st.debris||{};st.npc=st.npc||{};st.mp=1;
 const errs=[];let n1,n2;
 try{n1=h.ctx.commandState(clone(st),[],now,{});}catch(e){errs.push('empty: '+e.message)}
 try{n2=h.ctx.commandState(clone(n1),[],now,{});}catch(e){errs.push('again: '+e.message)}
 // ein Bauauftrag als Aktion
 let built='-';try{const pid=n1.order[0];const n3=h.ctx.commandState(clone(n1),[{seq:1,t:now,type:'build',args:[pid,'metal_mine']}],now,{});built=n3.planets[pid].bq.length+' q, metal '+Math.round(n1.planets[pid].r.m)+'→'+Math.round(n3.planets[pid].r.m)}catch(e){built='ERR '+e.message}
 const p=n1&&n1.planets[n1.order[0]];
 console.log(r.name_l,'rv',st.rv,'→',n1&&n1.rv,'b',JSON.stringify(p&&p.b),'dm',st.dm,'→',n1&&n1.dm,'tut',JSON.stringify(n1&&n1.camp&&n1.camp.cl),'errs',JSON.stringify(errs),'idem',n1&&n2&&JSON.stringify(n1.planets)===JSON.stringify(n2.planets),'build',built);}
