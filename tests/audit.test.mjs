import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
const scope={actionNames:{analyze_transactions:'Calculated transaction totals'}};
vm.runInNewContext(source.slice(source.indexOf('function caseHistory(c)')),scope);
test('audit history presents chronological Case actions without usage or raw planner data',()=>{
 const c={created_at:'2026-10-24T12:00:00Z',input:{parties:[{id:'P01',name:'Sample Party'}]},dispositions:{},events:[
  {at:'2026-10-24T12:02:00Z',type:'tool_completed',detail:'analyze_transactions'},
  {at:'2026-10-24T12:01:00Z',type:'agent_decision',detail:{action:'analyze_transactions',reason:'private planner detail'}},
  {at:'2026-10-24T12:03:00Z',type:'human_review',detail:{action:'resume',reviewer:'Analyst',dispositions:[{party_id:'P01',decision:'dismissed',reason:'Different identifier'}]}},
  {at:'2026-10-24T12:04:00Z',type:'narrative_exported',detail:{draft_version:1}},
 ]};
 const rows=scope.caseHistory(c);assert.equal(rows[0].text,'Case created.');assert.equal(rows.length,5);assert.match(rows[2].text,/Review saved/);assert.match(rows[3].text,/Different identifier/);assert.match(rows[4].text,/prepared for download/);assert.ok(!JSON.stringify(rows).includes('private planner detail'));
});
