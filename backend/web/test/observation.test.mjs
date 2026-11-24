import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fields,shellObservationFields,identityObservationFields,rootObservationFields,parseObservation,compareObservation,followupFor} from '../src/observation.mjs';

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

test('v2 evidence is allowlisted and battery differences respect time and units',()=>{
  const sample={...document,schema:'sigmark-adb-evidence/2',observer:'ADB_SHELL',
    readings:{...document.readings,'environment.vbmetaState':'locked','battery.temperature':'265','battery.voltage':'4100',
      'battery.sysBatteryTemp':'300'}};
  const info=read(sample);
  assert.equal(info.readings['battery.sysBatteryTemp'],undefined);
  assert.equal(info.readings['battery.temperature'],'265');
  assert.throws(()=>read({...sample,observer:'APP'}));
  assert.throws(()=>read({...sample,readings:{...sample.readings,'battery.temperature':'26500'}}));
  const app={status:'AVAILABLE',value:'26.5 °C'};
  assert.match(compareObservation('battery.temperature',app,'265'),/参考差值内/);
  assert.match(compareObservation('battery.temperature',app,'265',false),/仅展示/);
  assert.match(compareObservation('system.selinux',{status:'AVAILABLE',value:'Enforcing（强制模式）'},'Permissive',false),/仅展示/);
  assert.match(compareObservation('battery.temperature',app,'350'),/超出/);
});

test('app node denial offers battery API without replacing the node',()=>{
  const node={group:'battery',key:'sysBatteryTemp',status:'RESTRICTED',value:null};
  assert.match(followupFor(node,new Map([['battery.temperature',{status:'AVAILABLE',value:'27 °C'}]])),/27 °C/);
  assert.equal(node.value,null);
});

test('LTE carrier aggregate is separate evidence, never an inferred per-cell bandwidth',()=>{
  const node={group:'cellular',key:'cellLTEBandwidth',status:'UNAVAILABLE',reason:'MODEM_NOT_REPORTED',value:null};
  assert.match(followupFor(node,new Map()),/推不出单小区带宽/);
  assert.match(followupFor(node,new Map([['cellular.carrierBandwidths',{status:'AVAILABLE',value:'10000 kHz'}]])),/10000 kHz.*不等同/);
});

test('ADB never fills a restricted or unarchived App reading',()=>{
  const key='system.selinux';
  assert.equal(compareObservation(key,{status:'RESTRICTED',value:'Enforcing（强制模式）'},'Enforcing'),'缺少一方读数');
  assert.equal(compareObservation(key,undefined,'Enforcing'),'缺少一方读数');
  assert.equal(compareObservation(key,{status:'AVAILABLE',value:'Enforcing（强制模式）'},'Enforcing'),'读数一致');
  assert.equal(compareObservation(key,{status:'AVAILABLE',value:'Permissive（宽容模式）'},'Enforcing'),'读数不同，核对采样时点');
});

const v3 = {
  schema:'sigmark-adb-evidence/3', observer:'ADB_SHELL', observedAtEpochMs:1795422795043, model:'Pixel 6',
  readings:{...Object.fromEntries(shellObservationFields.map(([key])=>[key,null])),
    'system.selinux':'Enforcing','system.bootloader':'slider-14.5-12088207','environment.verityMode':'enforcing',
    'environment.buildDebuggable':'0','battery.sysBatteryTemp':'265','app.package':'dropped'},
};
test('v3 shell observation carries the readings the app is refused',()=>{
  const info=read(v3);
  assert.equal(info.readings['system.bootloader'],'slider-14.5-12088207');
  assert.equal(info.readings['environment.verityMode'],'enforcing');
  assert.equal(info.readings['environment.buildDebuggable'],'0');
  assert.equal(info.readings['battery.sysBatteryTemp'],'265');
  assert.equal(info.readings['app.package'],undefined);
  assert.throws(()=>read({...v3,observer:'APP'}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'environment.verityMode':'Enforcing'}}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'environment.buildDebuggable':'true'}}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'battery.sysBatteryTemp':'1500'}}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'system.bootloader':'bad\u0000value'}}));
  const missing={...v3,readings:{...v3.readings}}; delete missing.readings['system.bootloader'];
  assert.throws(()=>read(missing));
});

test('inferred SELinux and context-rewritten properties are compared, not merged',()=>{
  assert.match(compareObservation('system.selinux',
    {status:'AVAILABLE',value:'Enforcing（强制模式，推断）'},'Enforcing'),/推断值.*直接读取/);
  assert.equal(compareObservation('system.selinux',
    {status:'AVAILABLE',value:'Enforcing（强制模式）'},'Enforcing'),'读数一致');
  assert.match(compareObservation('system.bootloader',
    {status:'AVAILABLE',value:'corot-1.0.9'},'slider-14.5-12088207'),/可能被 ROM 改写/);
  assert.equal(compareObservation('environment.buildDebuggable',
    {status:'AVAILABLE',value:'关闭'},'0'),'读数一致');
  assert.match(compareObservation('environment.buildDebuggable',
    {status:'AVAILABLE',value:'关闭'},'1'),/读数不同/);
  assert.equal(compareObservation('battery.sysBatteryTemp',
    {status:'RESTRICTED',value:null},'265'),'缺少一方读数');
  assert.equal(compareObservation('battery.sysBatteryTemp',
    {status:'AVAILABLE',value:'265'},'265'),'在参考差值内（可能同源）');
  assert.match(compareObservation('battery.sysBatteryTemp',
    {status:'AVAILABLE',value:'265'},'300'),/超出/);
});

test('placeholder system properties are rejected instead of compared',()=>{
  assert.throws(()=>read({...v3,readings:{...v3.readings,'system.bootloader':'unknown'}}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'environment.verityMode':'null'}}));
  assert.throws(()=>read({...v3,readings:{...v3.readings,'environment.verityMode':'unknown'}}));
});

const v4 = {
  schema:'sigmark-adb-evidence/4', observer:'ADB_SHELL', observedAtEpochMs:1795422795043, model:'Pixel 6',
  readings:{...Object.fromEntries(identityObservationFields.map(([key])=>[key,null])),
    'system.selinux':'Enforcing','system.boardPlatform':'gs101','system.bootHardware':'oriole',
    'system.hardwareSku':'GR1YH','system.vendorSpl':'2026-07-05'},
};
test('v4 identity declarations are compared side by side, never merged',()=>{
  const info=read(v4);
  assert.equal(info.readings['system.boardPlatform'],'gs101');
  assert.equal(info.readings['system.bootHardware'],'oriole');
  assert.equal(info.readings['system.hardwareSku'],'GR1YH');
  assert.throws(()=>read({...v4,readings:{...v4.readings,'system.boardPlatform':'MT6985'}}));
  assert.throws(()=>read({...v4,readings:{...v4.readings,'system.boardPlatform':'unknown'}}));
  assert.throws(()=>read({...v4,readings:{...v4.readings,'system.hardwareSku':'GR1YH;rm'}}));
  assert.match(compareObservation('system.boardPlatform',
    {status:'AVAILABLE',value:'mt6985'},'gs101'),/身份字段不一致/);
  assert.equal(compareObservation('system.boardPlatform',
    {status:'AVAILABLE',value:'gs101'},'gs101'),'读数一致');
  assert.match(compareObservation('system.bootHardware',
    {status:'AVAILABLE',value:'mtk'},'oriole',false),/仅展示/);
  assert.equal(compareObservation('system.hardwareSku',
    {status:'RESTRICTED',value:null},'GR1YH'),'缺少一方读数');
});

const v5 = {
  schema:'sigmark-adb-evidence/5', observer:'ROOT', observedAtEpochMs:1795422795043, model:'Pixel 6',
  readings:{...Object.fromEntries(rootObservationFields.map(([key])=>[key,null])),
    'system.selinux':'Enforcing','system.selinuxPolicy':'sha256:'+'c'.repeat(64),
    'system.boardPlatform':'gs101','battery.sysBatteryTemp':'265'},
};
test('root observation is a separate observer and carries the policy digest',()=>{
  const info=read(v5);
  assert.equal(info.observer,'ROOT');
  assert.match(info.readings['system.selinuxPolicy'],/^sha256:[0-9a-f]{64}$/);
  assert.throws(()=>read({...v5,observer:'ADB_SHELL'}));
  assert.throws(()=>read({...v5,readings:{...v5.readings,'system.selinuxPolicy':'sha256:xyz'}}));
  const missing={...v5,readings:{...v5.readings}}; delete missing.readings['system.selinuxPolicy'];
  assert.throws(()=>read(missing));
  assert.equal(read(v4).observer,'ADB_SHELL');
  assert.equal(compareObservation('system.selinuxPolicy',{status:'RESTRICTED',value:null},
    'sha256:'+'c'.repeat(64)),'缺少一方读数');
});
