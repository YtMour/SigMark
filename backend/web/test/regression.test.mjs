import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkCondition,regressionResult} from '../src/regression.ts';
const row=(id,parameters,fieldSetVersion)=>({id,batch:'qa',assetId:'private-asset',report:{model:'QA',capturedAtEpochMs:1,parameters,fieldSetVersion}});
test('coverage distinguishes unavailable readings from fields not archived, and export omits asset identifiers',()=>{
  const base=row('a',[
    {group:'system',key:'a',status:'AVAILABLE'},
    {group:'system',key:'b',status:'AVAILABLE'},
  ],5);
  const current=row('b',[
    {group:'system',key:'a',status:'RESTRICTED'},
    {group:'system',key:'c',status:'AVAILABLE'},
  ],6);
  const result=regressionResult(base,current,[],{sameAsset:false,expectUnlock:true});
  assert.deepEqual(result.counts,{bothArchived:1,baselineOnly:1,currentOnly:1,lostValue:1,gainedValue:0});
  assert.equal(result.context.differentFieldSets,true);
  assert.equal(result.context.expectUnlock,false);
  assert.equal(JSON.stringify(result).includes('private-asset'),false);
});
test('compare default network without confusing VPN, unknown or no route',()=>{
  assert.equal(networkCondition('wifi','wifi','vpn').state,'mismatch');
  assert.equal(networkCondition('wifi','wifi','unknown').state,'insufficient');
  assert.equal(networkCondition('none','none','none').state,'matched');
  assert.equal(networkCondition('', 'wifi','cellular').state,'not_required');
});
