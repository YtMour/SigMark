import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fields,parseObservation,compareObservation} from '../src/observation.mjs';

const document = {schema:'sigmark-adb-evidence/1',observedAtEpochMs:1795422795043,model:'MI 8',
  readings:{...Object.fromEntries(fields.map(([key])=>[key,null])),'system.selinux':'Enforcing','device.serial':'unneeded'}};
const read = (data=document)=>parseObservation(JSON.stringify(data));
test('observation accepts only projected keys and explicit unknowns',()=>{
  assert.equal(read().readings['system.selinux'],'Enforcing');
  assert.equal(read().readings['device.serial'],undefined);
  assert.throws(()=>read({...document,readings:{}}));
  assert.throws(()=>read({...document,observedAtEpochMs:1e17}));
  assert.throws(()=>read({...document,readings:{...document.readings,'system.selinux':'unknown'}}));
});

test('ADB never fills a restricted or unarchived App reading',()=>{
  const key='system.selinux';
  assert.equal(compareObservation(key,{status:'RESTRICTED',value:'Enforcing（强制模式）'},'Enforcing'),'缺少一方读数');
  assert.equal(compareObservation(key,undefined,'Enforcing'),'缺少一方读数');
  assert.equal(compareObservation(key,{status:'AVAILABLE',value:'Enforcing（强制模式）'},'Enforcing'),'读数一致');
  assert.equal(compareObservation(key,{status:'AVAILABLE',value:'Permissive（宽容模式）'},'Enforcing'),'读数不同，核对采样时点');
});
