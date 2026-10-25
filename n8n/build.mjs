import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root=new URL('./',import.meta.url);
const base='https://REPLACE-WITH-YOUR-CASE-SERVICE';
const n=(name,type,parameters,x,y=300,extra={})=>({id:randomUUID(),name,type:'n8n-nodes-base.'+type,typeVersion:type==='httpRequest'?4.2:type==='code'?2:type==='if'?2.2:type==='respondToWebhook'?1.1:type==='noOp'?1:2,position:[x,y],parameters,...extra});
const http=(name,url,body,x,auth='service')=>n(name,'httpRequest',{method:'POST',url,sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:30000},authentication:auth==='model'?'predefinedCredentialType':'genericCredentialType',...(auth==='model'?{nodeCredentialType:'openAiApi'}:{genericAuthType:'httpHeaderAuth'})},x);
function workflow(name,nodes,links){const connections={};for(const [from,to,output=0] of links){connections[from]??={main:[]};connections[from].main[output]??=[];connections[from].main[output].push({node:to,type:'main',index:0});}return {name,nodes,connections,settings:{executionOrder:'v1',executionTimeout:240,saveExecutionProgress:true},active:false,pinData:{}};}
const run=workflow('SAR 01 - Agent Investigation Loop',[
 n('Run Case','webhook',{httpMethod:'POST',path:'sar-agent-run',authentication:'headerAuth',responseMode:'onReceived',options:{}},0),
 n('Read Case ID','code',{jsCode:"const b=$input.first().json.body??$input.first().json;if(!/^CASE-[a-f0-9-]{36}$/.test(b.case_id))throw Error('Invalid case ID');return [{json:{case_id:b.case_id}}];"},220),
 http('Load Context',`=${base}/internal/cases/{{ $json.case_id || $json.id }}/context`,'={{ JSON.stringify({}) }}',440),
 n('Can Continue','if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:'={{ $json.continue }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},660),
 {...http('Choose Next Tool','https://api.openai.com/v1/chat/completions','={{ JSON.stringify($json.request) }}',880,'model'),onError:'continueRegularOutput'},
 n('Bind Decision To Case','code',{jsCode:"const ctx=$('Load Context').item.json;return [{json:{case_id:ctx.case_id,version:ctx.version,completion:$input.first().json}}];"},1100),
 http('Execute Bounded Tool',`=${base}/internal/cases/{{ $json.case_id }}/execute`,'={{ JSON.stringify({version:$json.version,completion:$json.completion}) }}',1320),
 n('Paused Or Complete','noOp',{},880,540)
],[['Run Case','Read Case ID'],['Read Case ID','Load Context'],['Load Context','Can Continue'],['Can Continue','Choose Next Tool',0],['Can Continue','Paused Or Complete',1],['Choose Next Tool','Bind Decision To Case'],['Bind Decision To Case','Execute Bounded Tool'],['Execute Bounded Tool','Load Context']]);
const screen=workflow('SAR 02 - Synthetic Watchlist API',[
 n('Screen Parties','webhook',{httpMethod:'POST',path:'sar-synthetic-screen',authentication:'headerAuth',responseMode:'responseNode',options:{}},0),
 http('Screen Synthetic Parties',base+'/internal/screen','={{ JSON.stringify($json.body) }}',240),
 n('Return Screening','respondToWebhook',{respondWith:'json',responseBody:'={{ JSON.stringify($json) }}',options:{}},480)
],[['Screen Parties','Screen Synthetic Parties'],['Screen Synthetic Parties','Return Screening']]);
for(const [file,w] of [['SAR_01_Agent_Loop.json',run],['SAR_02_Synthetic_Screening.json',screen]])await fs.writeFile(new URL(file,root),JSON.stringify(w,null,2));
console.log('Built two inactive workflows; credentials and service URLs require configuration.');
