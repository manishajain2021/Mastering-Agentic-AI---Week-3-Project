import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {analyze,screen,validateCase,allowedActions} from '../lib/domain.mjs';
import {newCase,context,execute,review,retry,updateCaseNumber,editNarrative,recordFeedback} from '../lib/engine.mjs';
import {Store} from '../lib/store.mjs';
const list=JSON.parse(await fs.readFile(new URL('../data/watchlist.json',import.meta.url),'utf8'));
const fixture=()=>({synthetic:true,concern:'Analyst requests review of repeated synthetic payments.',parties:[{id:'P01',name:'Avery Rowan Vale',identifier:'SYN-P001',date_of_birth:'1982-04-16'},{id:'P02',name:'Taylor Wren Solace',identifier:'SYN-P999'}],transactions:[{id:'T01',date:'2026-10-20',amount:'0.10',currency:'USD',sender:'P01',recipient:'P02'},{id:'T02',date:'2026-10-21',amount:'0.20',currency:'USD',sender:'P01',recipient:'P02'}]});
const deps={watchlist:list,retrieve:async()=>({status:'answered',answer:'Public evidence',sources:[]})};
const completion=(action,extra={})=>({usage:{prompt_tokens:100,completion_tokens:50},choices:[{message:{content:JSON.stringify({action,reason:'Test fixture decision',...extra})}}]});
const step=(c,action,extra={})=>execute(c,{version:c.version,completion:completion(action,extra)},deps);

test('short review reasons are accepted while blank reasons remain invalid',async()=>{
 const c=newCase(fixture());await step(c,'screen_watchlist');
 assert.throws(()=>review(c,{version:c.version,action:'resume',reviewer:'Reviewer',dispositions:[{party_id:'P01',decision:'dismissed',reason:'  '}]}),/nonempty reason/);
 review(c,{version:c.version,action:'resume',reviewer:'Reviewer',dispositions:[{party_id:'P01',decision:'dismissed',reason:'test'}]});
 assert.equal(c.status,'Investigating');assert.equal(c.dispositions.P01.reason,'test');
});

test('friendly case sequences are unique across concurrent creates, dates, restarts and deletion',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sar-sequence-'));
 try{const store=new Store(dir);await store.init();
  const cases=Array.from({length:8},()=>newCase(fixture()));cases[0].created_at='2026-10-25T01:00:00Z';
  await Promise.all(cases.map(c=>store.create(c)));
  assert.equal(new Set(cases.map(c=>c.case_sequence)).size,8);assert.match(cases[0].case_label,/AML Case 0001 · 2026-10-24/);
  assert.equal((await store.lookup(cases[3].case_label)).id,cases[3].id);
  assert.equal((await store.lookup('AML Case 0004')).id,cases[3].id);
  await fs.unlink(store.file(cases[7].id));
  const restarted=new Store(dir);await restarted.init();const next=newCase(fixture());next.created_at='2026-10-26T18:00:00Z';await restarted.create(next);
  assert.equal(next.case_sequence,9);assert.match(next.case_label,/0009 · 2026-10-26/);
  const legacy=newCase(fixture());await restarted.save(legacy);const migrated=new Store(dir);await migrated.init();assert.equal((await migrated.get(legacy.id)).case_sequence,10);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('case number is separate from immutable system ID and rejects stale updates',()=>{
 const c=newCase({...fixture(),case_number:' AML-2026-001 '});const id=c.id;
 assert.equal(c.input.case_number,'AML-2026-001');const before=c.version;
 updateCaseNumber(c,{version:c.version,case_number:'AML-2026-002',id:'FORGED'});
 assert.equal(c.id,id);assert.equal(c.input.case_number,'AML-2026-002');
 assert.throws(()=>updateCaseNumber(c,{version:before,case_number:'old'}),/Case changed/);
 assert.throws(()=>updateCaseNumber(c,{version:c.version,case_number:'bad\nnumber'}),/Case number/);
});

test('narrative edits revoke approval and feedback belongs to its exact version',()=>{
 const c=newCase(fixture());c.draft={text:'Original narrative',version:1,approved:true,created_at:'2026-10-24T20:00:00.000Z'};c.status='Approved';
 recordFeedback(c,{version:c.version,rating:'down',reviewer:'Analyst',comment:'Needs more detail'});
 assert.equal(c.status,'Approved');assert.equal(c.draft.approved,true);assert.equal(c.feedback[0].draft_version,1);assert.equal(c.feedback[0].narrative_source,'generated');
 const stale=c.version;
 editNarrative(c,{version:c.version,reviewer:'Editor',text:'Revised factual narrative'});
 assert.equal(c.status,'Ready for Review');assert.equal(c.draft.approved,false);assert.equal(c.draft.version,2);assert.equal(c.draft.revisions[0].text,'Original narrative');
 assert.throws(()=>editNarrative(c,{version:stale,reviewer:'Editor',text:'stale'}),/Case changed/);
 assert.throws(()=>recordFeedback(c,{version:c.version,rating:'up',reviewer:' '}),/Analyst name/);
 recordFeedback(c,{version:c.version,rating:'up',reviewer:'Analyst'});assert.equal(c.feedback[1].draft_version,2);assert.equal(c.feedback[1].narrative_source,'analyst_edited');
 assert.throws(()=>editNarrative(c,{version:c.version,reviewer:'Editor',text:' '}),/Narrative text/);
 review(c,{version:c.version,action:'approve',reviewer:'Approver'});assert.equal(c.status,'Approved');
});

test('identifier and no match do not require optional DOB, even if planner asks repeatedly',async()=>{
 const c=newCase(fixture());await step(c,'screen_watchlist');
 review(c,{version:c.version,action:'resume',reviewer:'Regression reviewer',dispositions:[{party_id:'P01',decision:'confirmed_synthetic_match',record_id:'SYN001',reason:'Synthetic identifiers match'}]});
 assert.equal(context(c).request.messages[0].content.includes('Date of birth is OPTIONAL'),true);
 assert.equal(allowedActions(c).includes('request_human'),false);
 await step(c,'request_human',{question:'Please provide date of birth or additional identifying information for Taylor Wren Solace (P02).'});
 assert.equal(c.status,'Investigating');assert.equal(c.analysis.transaction_count,2);assert.equal(c.question,undefined);
 await step(c,'request_human',{question:'Please confirm P01 again and provide P02 DOB.'});
 assert.equal(c.status,'Ready for Review');assert.equal(c.input.parties[1].date_of_birth,'');
 assert.equal(c.events.filter(e=>e.type==='optional_identity_request_skipped').length,2);
 assert.equal(c.draft.approved,false);
});

test('missing identifier and unresolved screening still allow meaningful review',async()=>{
 const b=fixture();delete b.parties[1].identifier;const c=newCase(b);await step(c,'screen_watchlist');
 assert.equal(c.status,'Awaiting Human');assert.equal(c.draft,null);
 review(c,{version:c.version,action:'resume',reviewer:'Regression reviewer',dispositions:[{party_id:'P01',decision:'dismissed',reason:'Synthetic fixture reviewer decision'}]});
 assert.equal(allowedActions(c).includes('request_human'),true);
 await step(c,'request_human',{question:'Please provide a synthetic identifier for P02.'});
 assert.equal(c.status,'Awaiting Human');assert.match(c.question,/identifier/);
});
test('strict validation and decimal arithmetic',()=>{const i=validateCase(fixture());assert.equal(analyze(i).totals.USD,'0.30');assert.throws(()=>validateCase({...fixture(),synthetic:false}));const b=fixture();b.transactions[0].date='2026-02-30';assert.throws(()=>validateCase(b));});
test('currencies remain separate',()=>{const b=fixture();b.transactions[1].currency='EUR';assert.deepEqual(analyze(validateCase(b)).totals,{USD:'0.10',EUR:'0.20'});});
test('name and identifier matches require review',()=>{const r=screen(fixture().parties,list);assert.equal(r[0].status,'potential_match');assert.equal(r[0].candidates[0].identifier_match,true);assert.equal(r[1].status,'no_match');});
test('conflicting identity cannot be confirmed',async()=>{const b=fixture();b.parties[0].identifier='SYN-OTHER';const c=newCase(b);await step(c,'screen_watchlist');assert.throws(()=>review(c,{version:c.version,action:'resume',reviewer:'Test reviewer',dispositions:[{party_id:'P01',decision:'confirmed_synthetic_match',record_id:'SYN001',reason:'Identity reviewed'}]}));});
test('end-to-end pause, resume, factual draft and approval',async()=>{const c=newCase(fixture());await step(c,'analyze_transactions');await step(c,'screen_watchlist');assert.equal(c.status,'Awaiting Human');assert.deepEqual(allowedActions(c),[]);review(c,{version:c.version,action:'resume',reviewer:'Test reviewer',dispositions:[{party_id:'P01',decision:'confirmed_synthetic_match',record_id:'SYN001',reason:'Synthetic identifiers match'}]});await step(c,'create_draft',{claims:[{text:'Invented unverified allegation',evidence_ids:['T01']}]});assert.equal(c.status,'Ready for Review');assert.match(c.draft.text,/Total USD: 0.30/);assert.ok(!c.draft.text.includes('Invented'));review(c,{version:c.version,action:'approve',reviewer:'Test reviewer'});assert.equal(c.status,'Approved');assert.equal(c.draft.approved,true);});
test('premature draft after dismissed screening runs analysis first and preserves review',async()=>{
 const c=newCase(fixture());await step(c,'screen_watchlist');
 review(c,{version:c.version,action:'resume',reviewer:'Reviewer',dispositions:[{party_id:'P01',decision:'dismissed',reason:'test'}]});
 const disposition=structuredClone(c.dispositions.P01);
 await step(c,'create_draft',{claims:[{text:'Unverified claim'}]});
 assert.equal(c.status,'Investigating');assert.equal(c.analysis.totals.USD,'0.30');assert.equal(c.draft,null);assert.deepEqual(c.dispositions.P01,disposition);
 assert.equal(c.events.at(-2).detail.action,'analyze_transactions');
 await step(c,'create_draft');assert.equal(c.status,'Ready for Review');assert.equal(c.draft.approved,false);assert.ok(!c.draft.text.includes('Unverified claim'));
});
test('draft cannot skip required tools',async()=>{const c=newCase(fixture());await step(c,'create_draft');assert.equal(c.status,'Awaiting Human');assert.equal(c.draft,null);});
test('stale duplicate decisions do not rerun',async()=>{const c=newCase(fixture());const version=c.version;await step(c,'analyze_transactions');await assert.rejects(execute(c,{version,completion:completion('screen_watchlist')},deps),/Stale/);assert.equal(c.steps,1);});
test('bounded transient retries and terminal errors',async()=>{let calls=0;const result=await retry(async()=>{if(++calls<3){const e=Error('timeout');e.retryable=true;throw e;}return 'ok';},{sleep:async()=>{}});assert.equal(result,'ok');assert.equal(calls,3);calls=0;await assert.rejects(retry(async()=>{calls++;throw Error('bad auth');},{sleep:async()=>{}}));assert.equal(calls,1);});
test('tool failure persists incomplete status',async()=>{const c=newCase(fixture());await execute(c,{version:c.version,completion:completion('retrieve_guidance')},{watchlist:list,retrieve:async()=>{throw Error('bad auth');}});assert.equal(c.status,'Awaiting Human');assert.equal(c.guidance,undefined);assert.equal(c.failed_tool,'retrieve_guidance');});
test('case budget stops before additional tools',()=>{const c=newCase(fixture());c.steps=8;assert.equal(context(c).continue,false);assert.equal(c.status,'Awaiting Human');});
test('unknown and injected planner actions fail closed',async()=>{const c=newCase(fixture());await step(c,'send_filing');assert.equal(c.status,'Awaiting Human');assert.equal(c.draft,null);});
test('atomic store survives fresh instance and serializes updates',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sar-test-'));try{const s=new Store(dir);const c=newCase(fixture());await s.save(c);await Promise.all([s.update(c.id,x=>{x.steps++;}),s.update(c.id,x=>{x.steps++;})]);const other=new Store(dir);assert.equal((await other.get(c.id)).steps,2);await assert.rejects(s.get('../outside'));}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('workflow imports contain connected bounded loop and no credentials',async()=>{const w=JSON.parse(await fs.readFile(new URL('../n8n/SAR_01_Agent_Loop.json',import.meta.url),'utf8'));assert.equal(w.active,false);assert.equal(w.nodes.some(n=>n.credentials),false);assert.equal(w.connections['Execute Bounded Tool'].main[0][0].node,'Load Context');assert.equal(w.nodes.find(n=>n.name==='Run Case').parameters.authentication,'headerAuth');});
test('persistent transient failure exhausts three attempts and pauses',async()=>{let calls=0;await assert.rejects(retry(async()=>{calls++;const e=Error('temporary failure');e.retryable=true;throw e;},{sleep:async()=>{}}));assert.equal(calls,3);const c=newCase(fixture());await execute(c,{version:c.version,completion:completion('retrieve_guidance')},{watchlist:list,retrieve:async()=>{const e=Error('temporary failure');e.retryable=true;throw e;}});assert.equal(c.status,'Awaiting Human');assert.equal(c.events.filter(e=>e.type==='tool_retry').length,2);assert.equal(c.guidance,undefined);});
test('invalid model JSON pauses without invoking tools',async()=>{const c=newCase(fixture());await execute(c,{version:c.version,completion:{choices:[{message:{content:'invalid JSON'}}]}},deps);assert.equal(c.status,'Awaiting Human');assert.equal(c.analysis,undefined);assert.equal(c.screening,undefined);});
test('estimated cost threshold prevents further tool execution',async()=>{const c=newCase(fixture());await execute(c,{version:c.version,completion:completion('analyze_transactions')},{...deps,prices:{input:1000000,output:0,ceiling:50}});assert.equal(c.status,'Awaiting Human');assert.equal(c.analysis,undefined);assert.equal(c.usage.estimated_model_usd,100);});
