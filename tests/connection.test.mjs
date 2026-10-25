import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAgentConnection} from '../lib/connection.mjs';
test('broken tunnel fails clearly before agent dispatch',async()=>{
 for(const fetchImpl of [async()=>{throw Error('ENOTFOUND');},async()=>({ok:false}),async()=>({ok:true,json:async()=>({ok:false})})])await assert.rejects(checkAgentConnection('https://example.invalid','private-token',{fetchImpl}),/connection is unavailable.*case is saved/);
 await assert.rejects(checkAgentConnection('', 'token'),/not configured/);
});
test('healthy tunnel check uses authenticated service endpoint',async()=>{
 let called=false;await checkAgentConnection('https://example.invalid','private-token',{fetchImpl:async(url,options)=>{called=true;assert.equal(url.href,'https://example.invalid/internal/health');assert.equal(options.headers.Authorization,'Bearer private-token');assert.ok(options.signal);return {ok:true,json:async()=>({ok:true})};}});assert.equal(called,true);
});
