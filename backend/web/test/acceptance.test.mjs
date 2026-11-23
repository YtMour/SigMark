import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptance,acceptanceComparison} from '../src/acceptance.ts';

const make=(time,outcome,fixture='sigmark-avc/1',location='precise')=>{
  const row=(group,key,value)=>({group,key,value,status:'AVAILABLE',source:'fixture'});
  return {report:{capturedAtEpochMs:time,parameters:[
    row('environment','captureLocationAccess',location),
    ...(outcome?[row('media','avcFirstFrame',outcome),row('media','avcFixture',fixture)]:[]),
  ]}};
};
test('acceptance comparison keeps not-run, failed, and incompatible samples separate',()=>{
  const baseline=make(1,'pass');
  assert.equal(acceptance(make(2,null)).output.status,'NOT_ARCHIVED');
  assert.equal(acceptanceComparison(baseline,make(2,null),true).media,'insufficient');
  assert.equal(acceptanceComparison(baseline,make(2,'fail'),false).media,'cross_asset');
  assert.equal(acceptanceComparison(baseline,make(1,'fail'),true).media,'invalid_order');
  assert.equal(acceptanceComparison(baseline,make(2,'fail','sigmark-avc/2'),true).media,'different_fixture');
  assert.equal(acceptanceComparison(baseline,make(2,'fail'),true).media,'regression');
  assert.equal(acceptanceComparison(make(1,'fail'),make(2,'pass'),true).media,'recovered');
  assert.equal(acceptanceComparison(baseline,make(2,'pass'),true).media,'both_pass');
  assert.equal(acceptanceComparison(baseline,make(2,'pass','sigmark-avc/1','not_granted'),true).context.location,'changed');
});
