import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLab,suggestedBaseline,evidenceDelta} from '../src/lab-model.ts';
const p=(key,value,status='AVAILABLE',reason)=>{const [group,k]=key.split('.');return {group,key:k,value,status,source:'fixture',label:key,reason};};
const r=(id,time,parameters)=>({id,report:{capturedAtEpochMs:time,parameters}});
test('old/unarchived, newly restricted and source-only changes are different',()=>{
  const old=p('system.selinux','1');
  assert.equal(evidenceDelta(old,undefined),'not_comparable');
  assert.equal(evidenceDelta(old,p('system.selinux',null,'RESTRICTED','ACCESS_DENIED')),'lost');
  assert.equal(evidenceDelta({...old,source:'other'},old),'provenance');
  assert.equal(evidenceDelta(undefined,old),'not_comparable');
});
test('only eligible history is compared; raw policy null is kept and dynamic rows are tagged',()=>{
  const baseline=r('eligible',1,[p('system.patch','2024-01-01')]);
  const current=r('current',2,[p('system.patch','2024-01-01'),p('system.selinux',null,'RESTRICTED','ACCESS_DENIED'),
    p('network.checkStartTransport','wifi'),p('network.checkEndTransport',null,'UNAVAILABLE')]);
  const sheet={current,history:[baseline]};
  assert.equal(suggestedBaseline(sheet)?.id,baseline.id);
  assert.equal(buildLab(sheet,r('different',1,[])).baselineId,null);
  const result=buildLab(sheet,baseline);
  assert.equal(result.restricted.policy,1);
  assert.equal(result.counts.not_comparable,3);
  assert.equal(result.rows.find(row=>row.key==='network.checkStartTransport').dynamic,true);
  assert.equal(result.transition.before,'wifi');
  assert.equal(result.transition.after,null);
});
