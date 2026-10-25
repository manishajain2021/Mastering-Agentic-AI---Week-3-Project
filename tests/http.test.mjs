import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
test('Local workspace without token, protected service, durable review and export',async()=>{
 const app=randomBytes(24).toString('hex'),service=randomBytes(24).toString('hex');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sar-http-'));
 const port=18783;const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,APP_TOKEN:app,SERVICE_TOKEN:service,PORT:String(port),SAR_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Service exit '+code)));setTimeout(()=>reject(Error('Service start timeout')),5000).unref();});
  const call=(route,token,data)=>fetch('http://127.0.0.1:'+port+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const target='http://127.0.0.1:'+port;
  assert.equal((await fetch(target+'/api/cases',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:'{}'})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const r=http.get(target+'/',{headers:{Host:'public.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});
  assert.equal(hostStatus,403);
  assert.equal((await fetch(target+'/',{headers:{'CF-Ray':'tunnel-request'}})).status,403);
  assert.equal((await fetch(target+'/',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const input={synthetic:true,concern:'Synthetic HTTP integration example.',parties:[{id:'P01',name:'Taylor Wren Solace'},{id:'P02',name:'Case Sample Person'}],transactions:[{id:'T01',date:'2026-10-20',amount:'25.10',currency:'USD',sender:'P01',recipient:'P02'}]};
  const r=await fetch(target+'/api/cases',{method:'POST',headers:{'Content-Type':'application/json',Origin:target},body:JSON.stringify(input)});assert.equal(r.status,201);let c=await r.json();
  assert.equal((await fetch(target+'/api/cases/'+c.id)).status,200);
  assert.equal((await call('/internal/cases/'+c.id+'/context',app,{})).status,401);
  assert.equal((await call('/api/cases/'+c.id+'/export',app)).status,400);
  for(const action of ['analyze_transactions','screen_watchlist','create_draft']){
   const ctx=await (await call('/internal/cases/'+c.id+'/context',service,{})).json();
   c=await (await call('/internal/cases/'+c.id+'/execute',service,{version:ctx.version,completion:{usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:JSON.stringify({action})}}]}})).json();
  }
  assert.equal(c.status,'Ready for Review');
  const reviewed=await call('/api/cases/'+c.id+'/review',app,{version:c.version,action:'approve',reviewer:'Integration reviewer'});assert.equal(reviewed.status,200);
  const exported=await call('/api/cases/'+c.id+'/export',app);assert.equal(exported.status,200);const download=await exported.json();assert.match(download.narrative,/25.10/);assert.match(download.narrative,/^Generated on: .+America\/New_York/);assert.equal(download.generated_at,c.draft.created_at);assert.equal(download.time_zone,'America/New_York');assert.match(download.narrative,/Parties involved:\nTaylor Wren Solace \(P01\)\nCase Sample Person \(P02\)/);
  c=await (await call('/api/cases/'+c.id,app)).json();const id=c.id;assert.equal(c.events.at(-1).type,'narrative_exported');assert.equal(c.events.at(-1).detail.draft_version,1);
  c=await (await call('/api/cases/'+c.id+'/case-number',app,{version:c.version,case_number:'AML-2026-TEST',id:'forged'})).json();assert.equal(c.id,id);assert.equal(c.input.case_number,'AML-2026-TEST');
  c=await (await call('/api/cases/'+c.id+'/feedback',app,{version:c.version,rating:'down',reviewer:'Quality reviewer',comment:'Please expand the narrative.'})).json();assert.equal(c.feedback[0].draft_version,1);assert.equal(c.status,'Approved');
  c=await (await call('/api/cases/'+c.id+'/draft',app,{version:c.version,reviewer:'Editor',text:'Revised factual narrative: USD 25.10.'})).json();assert.equal(c.status,'Ready for Review');assert.equal(c.draft.version,2);
  assert.equal((await call('/api/cases/'+c.id+'/export',app)).status,400);
  const again=await call('/api/cases/'+c.id+'/review',app,{version:c.version,action:'approve',reviewer:'Approver'});assert.equal(again.status,200);
  const revised=await (await call('/api/cases/'+c.id+'/export',app)).json();assert.ok(revised.narrative.includes(c.case_label));assert.match(revised.narrative,/Revised factual narrative/);
  const found=await fetch(target+'/api/cases/lookup?reference='+encodeURIComponent(c.case_label));assert.equal(found.status,200);assert.equal((await found.json()).id,c.id);
 }finally{if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await fs.rm(dir,{recursive:true,force:true});}
});
