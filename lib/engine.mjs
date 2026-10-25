import {randomUUID} from 'node:crypto';
import {validateCase,analyze,screen,allowedActions,unresolved,renderNarrative,plannerSystem,identitiesResolved,normalizeCaseNumber} from './domain.mjs';
export const now=()=>new Date().toISOString();
export function newCase(input){return {id:'CASE-'+randomUUID(),input:validateCase(input),version:1,status:'Investigating',created_at:now(),updated_at:now(),steps:0,usage:{input_tokens:0,output_tokens:0,estimated_model_usd:null},dispositions:{},events:[],draft:null};}
export function event(c,type,detail){c.events.push({at:now(),type,detail});c.updated_at=now();}
export function updateCaseNumber(c,b){if(b.version!==c.version)throw Error('Case changed. Open the case again before saving its number.');const value=normalizeCaseNumber(b.case_number);const previous=c.input.case_number||'';c.input.case_number=value;c.version++;event(c,'case_number_updated',{previous,case_number:value});return c;}
export function editNarrative(c,b){
 if(b.version!==c.version)throw Error('Case changed. Open the case again before saving your edit.');
 if(!c.draft||!['Ready for Review','Approved'].includes(c.status))throw Error('Wait for a completed draft before editing.');
 if(typeof b.reviewer!=='string'||!b.reviewer.trim()||b.reviewer.length>100)throw Error('Editor name is required.');
 if(typeof b.text!=='string'||!b.text.trim()||b.text.length>20000)throw Error('Narrative text is required (maximum 20,000 characters).');
 c.draft.revisions??=[];c.draft.revisions.push({version:c.draft.version,text:c.draft.text,replaced_at:now(),editor:b.reviewer.trim()});
 c.draft.text=b.text.trim();c.draft.version++;c.draft.approved=false;c.draft.last_edited_at=now();c.draft.edited_by=b.reviewer.trim();c.status='Ready for Review';c.version++;
 event(c,'narrative_edited',{reviewer:b.reviewer.trim(),draft_version:c.draft.version,approval_required:true});return c;
}
export function recordFeedback(c,b){
 if(b.version!==c.version)throw Error('Case changed. Open the case again before saving feedback.');
 if(!c.draft||!['Ready for Review','Approved'].includes(c.status))throw Error('Wait for a narrative before giving feedback.');
 if(!['up','down'].includes(b.rating))throw Error('Choose thumbs up or thumbs down.');
 if(typeof b.reviewer!=='string'||!b.reviewer.trim()||b.reviewer.length>100)throw Error('Analyst name is required for feedback.');
 if(b.comment!==undefined&&(typeof b.comment!=='string'||b.comment.length>2000))throw Error('Feedback comment must be at most 2,000 characters.');
 c.feedback??=[];const entry={rating:b.rating,reviewer:b.reviewer.trim(),comment:(b.comment||'').trim(),draft_version:c.draft.version,narrative_source:c.draft.last_edited_at?'analyst_edited':'generated',at:now()};c.feedback.push(entry);c.version++;event(c,'narrative_feedback',entry);return c;
}
export function context(c){
 const actions=allowedActions(c);const remaining=16000-c.usage.input_tokens-c.usage.output_tokens;
 if(c.steps>=8||remaining<2500){c.status='Awaiting Human';c.question='Run budget reached. Review progress; this version does not automatically reset budgets.';event(c,'budget_stop',c.question);}
 const more=allowedActions(c).length>0;
 return {case_id:c.id,version:c.version,continue:more,case:c,request:more?{model:'gpt-4.1-mini',temperature:0,max_completion_tokens:1000,response_format:{type:'json_object'},messages:[{role:'system',content:plannerSystem},{role:'user',content:JSON.stringify({allowed_actions:actions,case:{input:c.input,analysis:c.analysis,screening:c.screening,dispositions:c.dispositions,guidance_status:c.guidance?.status,guidance_attempted:c.guidance_attempted,review_answers:c.review_answers,remaining_steps:8-c.steps}})}]}:null};
}
export async function retry(fn,{attempts=3,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onRetry=()=>{}}={}){for(let i=0;i<attempts;i++){try{return await fn();}catch(e){if(i===attempts-1||(!e.retryable&&e.name!=='TimeoutError'))throw e;onRetry(i+1);await sleep(200*(2**i));}}}
export async function execute(c,body,{watchlist,retrieve,prices={}}){
 if(body.version!==c.version)throw Error('Stale execution: reload case context.');
 if(!allowedActions(c).length)throw Error('Case is paused or complete.');
 if(c.steps>=8)throw Error('Step budget exhausted.');
 const u=body.completion?.usage;
 if(u){for(const k of ['prompt_tokens','completion_tokens'])if(!Number.isSafeInteger(u[k])||u[k]<0)throw Error('Invalid usage record');c.usage.input_tokens+=u.prompt_tokens;c.usage.output_tokens+=u.completion_tokens;}
 if(Number.isFinite(prices.input)&&Number.isFinite(prices.output))c.usage.estimated_model_usd=(c.usage.input_tokens*prices.input+c.usage.output_tokens*prices.output)/1e6;
 c.steps++;c.version++;
 if(c.usage.input_tokens+c.usage.output_tokens>16000||(c.usage.estimated_model_usd!==null&&c.usage.estimated_model_usd>=prices.ceiling)){c.status='Awaiting Human';c.question='Usage budget reached. No further tools were executed.';event(c,'budget_stop',c.question);return c;}
 let decision;
 try{decision=JSON.parse(body.completion.choices[0].message.content);
  if(decision.action==='create_draft'&&!c.analysis&&c.screening&&identitiesResolved(c)&&!unresolved(c)){
   event(c,'planner_sequence_repaired',{requested_action:'create_draft',executed_action:'analyze_transactions',reason:'Transaction analysis must complete before drafting; existing screening dispositions are preserved.'});
   decision={action:'analyze_transactions',reason:'Calculate verified transaction totals before drafting.',claims:[]};
  }
  if(decision.action==='request_human'&&identitiesResolved(c)){
   event(c,'optional_identity_request_skipped',{requested_question:String(decision.question||'').slice(0,1000),reason:'All parties have an identifier with no match or a recorded screening disposition; optional identity details do not block the factual draft.'});
   decision={action:c.analysis?'create_draft':'analyze_transactions',reason:'Continue verified case work; optional identity clarification is not required.',claims:[]};
  }
  if(!allowedActions(c).includes(decision.action))throw Error('Disallowed tool selection');}
 catch(e){const actions=allowedActions(c);c.status='Awaiting Human';c.question='Planner failed or returned an invalid action. Review the saved case before retrying.';event(c,'planner_error',{message:String(e.message).slice(0,200),requested_action:typeof decision?.action==='string'?decision.action.slice(0,80):null,allowed_actions:actions});return c;}
 const action=decision.action;event(c,'agent_decision',{action,reason:String(decision.reason||'').slice(0,400)});
 try{
  if(action==='analyze_transactions')c.analysis=analyze(c.input);
  if(action==='screen_watchlist'){
   c.screening=screen(c.input.parties,watchlist);c.screened_at=now();
   if(unresolved(c)){c.status='Awaiting Human';c.question='Review each potential synthetic watchlist match. Confirm a candidate or dismiss it with a reason.';}
  }
  if(action==='retrieve_guidance'){
   c.guidance_attempted=true;
   c.guidance=await retry(retrieve,{onRetry:n=>event(c,'tool_retry',{tool:action,attempt:n})});
   if(!['answered','abstained'].includes(c.guidance?.status))throw Error('Invalid Week 2 response');
  }
  if(action==='request_human'){c.status='Awaiting Human';c.question=String(decision.question||'Please provide missing case context.').slice(0,1000);}
  if(action==='create_draft'){
   // Free-form model claims are held for human review, not inserted into the verified narrative.
   c.model_suggestions=Array.isArray(decision.claims)?decision.claims.slice(0,10):[];
   c.draft={version:1,text:renderNarrative(c),created_at:now(),evidence_ids:c.input.transactions.map(t=>t.id),approved:false};c.status='Ready for Review';
  }
  event(c,'tool_completed',action);
 }catch(e){c.status='Awaiting Human';c.question=`Tool ${action} failed. Screening/research must not be treated as successful. Retry after resolving the connection.`;c.failed_tool=action;event(c,'tool_failed',{tool:action,message:String(e.message).slice(0,200)});}
 return c;
}
export function review(c,b){
 if(b.version!==c.version)throw Error('Stale case version. Refresh first.');
 if(typeof b.reviewer!=='string'||!b.reviewer.trim()||b.reviewer.length>100)throw Error('Reviewer name is required.');
 if(b.action==='approve'){
  if(c.status!=='Ready for Review'||!c.draft||unresolved(c))throw Error('A reviewed draft is required before approval.');
  c.draft.approved=true;c.status='Approved';
 }else if(b.action==='resume'){
  if(c.status!=='Awaiting Human')throw Error('Case is not awaiting input.');
  const pendingMatch=unresolved(c);
  const lastAction=c.events.filter(e=>e.type==='agent_decision').at(-1)?.detail.action;
  if(!pendingMatch&&lastAction==='request_human'&&(typeof b.answer!=='string'||!b.answer.trim()))throw Error('Clarification or review note is required to answer the agent question.');
  if(c.steps>=8||c.usage.input_tokens+c.usage.output_tokens>=13500)throw Error('Budget exhausted; create a new case after review.');
  for(const d of b.dispositions||[]){
   const s=c.screening?.find(x=>x.party_id===d.party_id);
   if(!s||s.status!=='potential_match'||!['confirmed_synthetic_match','dismissed'].includes(d.decision)||typeof d.reason!=='string'||!d.reason.trim())throw Error('Valid candidate disposition and a nonempty reason are required.');
   if(d.decision==='confirmed_synthetic_match'){
    const candidate=s.candidates.find(x=>x.record_id===d.record_id);
    if(!candidate||candidate.conflicts.length)throw Error('Cannot confirm a candidate with conflicting supplied identifiers.');
   }
   c.dispositions[d.party_id]={...d,reviewer:b.reviewer,at:now()};
  }
  if(unresolved(c))throw Error('Resolve all potential matches before resuming.');
  if(c.failed_tool==='retrieve_guidance'){delete c.guidance_attempted;delete c.guidance;}
  delete c.failed_tool;c.review_answers=String(b.answer||'').slice(0,2000);c.status='Investigating';delete c.question;
 }else throw Error('Use resume or approve.');
 c.version++;event(c,'human_review',{reviewer:b.reviewer,action:b.action,answer:c.review_answers,dispositions:b.action==='resume'?(b.dispositions||[]).map(d=>({...c.dispositions[d.party_id]})):[]});return c;
}
