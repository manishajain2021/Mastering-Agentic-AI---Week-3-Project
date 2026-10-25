import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {Store} from './lib/store.mjs';
import {newCase,context,execute,review,updateCaseNumber,editNarrative,recordFeedback,event} from './lib/engine.mjs';
import {screen,exportNarrative} from './lib/domain.mjs';
import {checkAgentConnection} from './lib/connection.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const serviceToken=process.env.SERVICE_TOKEN;
if(!serviceToken||serviceToken.length<24||serviceToken.startsWith('replace-'))throw Error('Set SERVICE_TOKEN of at least 24 characters in .env.');
const port=Number(process.env.PORT||8780);
function localWorkspace(req){
 const origins=['http://127.0.0.1:'+port,'http://localhost:'+port];
 return origins.some(origin=>new URL(origin).host===req.headers.host)
  &&(!req.headers.origin||origins.includes(req.headers.origin))
  &&!['cross-site','same-site'].includes(req.headers['sec-fetch-site'])
  &&!['forwarded','x-forwarded-for','x-forwarded-host','cf-ray','cf-connecting-ip'].some(name=>req.headers[name]);
}
const store=new Store(process.env.SAR_DATA_DIR||path.join(root,'runtime'));await store.init();
const watchlist=JSON.parse(await fs.readFile(path.join(root,'data/watchlist.json'),'utf8'));
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(Buffer.byteLength(s)>250000)throw Error('Request too large');}return JSON.parse(s||'{}');}
async function retrieve(){
 const url=new URL(process.env.WEEK2_ASK_URL||'https://manishavgjain2021.app.n8n.cloud/webhook/aml-regulatory-ask');
 if(url.protocol!=='https:')throw Error('HTTPS research endpoint required');
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'What does the approved FinCEN guidance say about documenting decisions not to file a SAR?'}),signal:AbortSignal.timeout(20000)}).catch(e=>{e.retryable=true;throw e;});
 if(!r.ok){const e=Error('Research endpoint HTTP '+r.status);e.retryable=r.status===429||r.status>=500;throw e;}return r.json();
}
const prices={input:process.env.INPUT_USD_PER_MILLION?Number(process.env.INPUT_USD_PER_MILLION):NaN,output:process.env.OUTPUT_USD_PER_MILLION?Number(process.env.OUTPUT_USD_PER_MILLION):NaN,ceiling:Number(process.env.MAX_CASE_USD||1)};
async function dispatch(id){
 if(!process.env.N8N_RUN_URL)throw Error('N8N_RUN_URL is not configured. Import workflows and configure a reachable service first.');
 await checkAgentConnection(process.env.SERVICE_PUBLIC_URL,serviceToken);
 const url=new URL(process.env.N8N_RUN_URL);if(url.protocol!=='https:')throw Error('HTTPS n8n URL required.');
 const auth=process.env.N8N_RUN_KEY?{'X-SAR-Key':process.env.N8N_RUN_KEY}:{Authorization:'Bearer '+serviceToken};
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...auth},body:JSON.stringify({case_id:id}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('n8n dispatch failed: HTTP '+r.status);
}
const server=http.createServer(async(req,res)=>{
 const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
  const u=new URL(req.url,'http://localhost');
  const internal=u.pathname.startsWith('/internal/');
  if(!internal&&!localWorkspace(req))return send(403,{error:'The demo workspace is available only on this computer.'});
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(u.pathname)){
   const name=u.pathname==='/'?'index.html':u.pathname.slice(1);res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(await fs.readFile(path.join(root,'public',name)));return;
  }
  if(internal&&!equal(req.headers.authorization,'Bearer '+serviceToken))return send(401,{error:'Authentication required'});
  if(req.method==='GET'&&u.pathname==='/internal/health')return send(200,{ok:true,service:'sar-case-service'});
  if(req.method==='POST'&&u.pathname==='/internal/screen'){const b=await body(req);if(b.synthetic!==true||!Array.isArray(b.parties)||b.parties.length>20)throw Error('Supply synthetic=true and at most 20 parties');return send(200,{synthetic:true,list_name:'SYNTHETIC_WATCHLIST',results:screen(b.parties,watchlist)});}
  if(req.method==='POST'&&u.pathname==='/api/cases'){const c=newCase(await body(req));await store.create(c);return send(201,c);}
  if(req.method==='GET'&&u.pathname==='/api/cases/lookup')return send(200,await store.lookup(u.searchParams.get('reference')||''));
  const match=u.pathname.match(/^\/(api|internal)\/cases\/(CASE-[a-f0-9-]{36})(?:\/(context|execute|review|run|export|case-number|draft|feedback))?$/);
  if(!match)return send(404,{error:'Not found'});
  const [,surface,id,op]=match;
  if(req.method==='GET'&&!op&&surface==='api')return send(200,await store.get(id));
  if(req.method==='POST'&&op==='case-number'&&surface==='api'){const b=await body(req);return send(200,await store.update(id,c=>updateCaseNumber(c,b)));}
  if(req.method==='POST'&&op==='draft'&&surface==='api'){const b=await body(req);return send(200,await store.update(id,c=>editNarrative(c,b)));}
  if(req.method==='POST'&&op==='feedback'&&surface==='api'){const b=await body(req);return send(200,await store.update(id,c=>recordFeedback(c,b)));}
  if(req.method==='GET'&&op==='export'&&surface==='api'){const c=await store.update(id,c=>{if(c.status!=='Approved')throw Error('Approve the draft before exporting');event(c,'narrative_exported',{draft_version:c.draft.version});return c;});return send(200,{case_id:id,narrative:exportNarrative(c),generated_at:c.draft.created_at,time_zone:'America/New_York',synthetic:true,approval:c.events.filter(e=>e.type==='human_review').at(-1)});}
  if(req.method==='POST'&&op==='context'&&surface==='internal')return send(200,await store.update(id,c=>context(c)));
  if(req.method==='POST'&&op==='execute'&&surface==='internal'){const b=await body(req);return send(200,await store.update(id,c=>execute(c,b,{watchlist,retrieve,prices})));}
  if(req.method==='POST'&&op==='review'&&surface==='api'){const b=await body(req);return send(200,await store.update(id,c=>review(c,b)));}
  if(req.method==='POST'&&op==='run'&&surface==='api'){const c=await store.get(id);if(c.status!=='Investigating')throw Error('Case is not ready to run');await dispatch(id);await store.update(id,c=>{event(c,'investigation_started',{});});return send(202,{status:'Dispatched',case_id:id});}
  send(404,{error:'Not found'});
 }catch(e){send(e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Case not found':e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log('SAR prototype ready at http://127.0.0.1:'+port));
