import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessRisk,registeredUnlock} from '../src/risk-assessment.ts';

const at=Date.parse('2026-11-23T12:00:00Z');
const e=(id,value,status='AVAILABLE',reason)=>{const [group,key]=id.split('.');return {group,key,label:id,value,status,source:'fixture',reason};};
const core=[e('environment.verifiedBoot','green'),e('environment.flashLock','1'),e('system.selinux','Enforcing（强制模式）'),
  e('environment.keyguardSecure','是'),e('environment.storageEncryption','已启用'),e('system.patch','2026-11-01')];
const row=(parameters=core,assetId='asset',time=at)=>({id:'current',assetId,report:{
  parameters,capturedAtEpochMs:time,fieldSetVersion:10,model:'QA',androidApi:34,appVersion:'1.1.0'}});
function replace(key,value,status='AVAILABLE',reason){
  return [...core.filter(p=>p.group+'.'+p.key!==key),e(key,value,status,reason)];
}
test('blue requires all core protections and never claims independent trust',()=>{
  const d=assessRisk(row());
  assert.equal(d.level,'blue');
  assert.equal(d.attestation,'not_verified');
  assert.equal(d.abuseAssessment,'not_evaluated');
  assert.deepEqual(d.triggered,[]);
  assert.equal(assessRisk(row([e('environment.flashLock','1')])).level,'gray');
});
test('keystore errors recommend retry while a missing or restricted probe does not raise the risk level',()=>{
  const id='environment.keyProtection';
  const failed=assessRisk(row([...core,e(id,null,'ERROR','READ_FAILED')]));
  assert.equal(failed.level,'yellow');
  assert.deepEqual(failed.triggered,['KEYSTORE_TEST']);
  assert.equal(failed.attestation,'not_verified');
  for(const [value,status] of [['Software','AVAILABLE'],[null,'RESTRICTED'],[null,'UNAVAILABLE']]){
    const assessed=assessRisk(row([...core,e(id,value,status)]));
    assert.equal(assessed.level,'blue');
    assert(!assessed.rules.some(rule=>rule.code==='KEYSTORE_TEST'));
  }
});
test('policy denial and unarchived evidence differ and neither is a failure',()=>{
  const selinux={...e('system.selinux',null,'RESTRICTED','ACCESS_DENIED'),errno:13};
  const d=assessRisk(row([...core.filter(f=>f.key!=='selinux'),selinux]));
  assert.equal(d.level,'gray');
  assert.deepEqual(d.triggered,['SELINUX_MODE']);
  assert.deepEqual(d.rules.find(r=>r.code==='SELINUX_MODE').evidence[0],
    {key:'system.selinux',value:null,status:'RESTRICTED',source:'fixture',reason:'ACCESS_DENIED',errno:13});
  const old=assessRisk(row([]));
  assert.equal(old.rules.find(r=>r.code==='SELINUX_MODE').evidence[0].status,'NOT_ARCHIVED');
});
test('same-declaration App mismatches trigger review without external evidence or identity proof',()=>{
  const source=[...core,e('system.model','QA'),e('system.board','board'),e('system.boardPlatform','platform')];
  const old={...row(source),identityReview:{different:6}};
  const read=d=>d.rules.find(r=>r.code==='APP_IDENTITY_CONSISTENCY');
  assert.equal(assessRisk(old).level,'blue');
  assert.equal(read(assessRisk(old)).state,'unknown');
  const report=assessRisk(row([...source,e('system.propertyModel','Different')]));
  assert.equal(report.level,'yellow');
  assert.deepEqual(report.triggered,['APP_IDENTITY_CONSISTENCY']);
  assert.equal(report.attestation,'not_verified');
  assert.equal(read(report).evidence.find(r=>r.key==='system.propertyModel').value,'Different');
  const blocked=assessRisk(row([...source,e('system.propertyModel',null,'RESTRICTED','ACCESS_DENIED')]));
  assert.equal(blocked.level,'blue');
  assert.equal(read(blocked).state,'unknown');
});
test('direct red outranks missing/weak signals; conflict or weak protection is yellow',()=>{
  const d=assessRisk(row([e('environment.verifiedBoot','red'),e('environment.keyguardSecure','否')]));
  assert.equal(d.level,'red');
  assert.deepEqual(d.triggered,['BOOT_STATE','LOCKSCREEN']);
  assert.equal(assessRisk(row(replace('environment.flashLock','0'))).level,'yellow');
  assert.equal(assessRisk(row(replace('system.selinux','Permissive（宽容模式）'))).level,'yellow');
  assert.equal(assessRisk(row(replace('system.patch','2025-01-01'))).level,'yellow');
});
test('registered, earlier, same-asset expectation only downgrades explicit unlock',()=>{
  const unlocked=row([e('environment.verifiedBoot','orange'),e('environment.flashLock','0'),...core.slice(2)]);
  const prior={...row(core,'asset',at-1000),id:'prior'};
  const saved={id:'saved',reportId:'prior',state:'ready',name:'实验基线',expectUnlock:true};
  const policy=registeredUnlock(unlocked,prior,saved);
  assert.equal(assessRisk(unlocked).level,'yellow');
  assert.equal(assessRisk(unlocked,undefined,policy).rules[0].state,'expected');
  assert.equal(assessRisk(unlocked,undefined,policy).level,'blue');
  assert.equal(assessRisk(row(replace('environment.verifiedBoot','red')),undefined,policy).level,'red');
  assert.equal(assessRisk(row(replace('environment.flashLock','0')),undefined,policy).level,'yellow');
  assert.equal(registeredUnlock(unlocked,prior,undefined,true),null);
  assert.equal(registeredUnlock(unlocked,{...prior,assetId:'another'},saved),null);
  assert.equal(registeredUnlock(unlocked,{...prior,report:{...prior.report,capturedAtEpochMs:at}},saved),null);
  assert.equal(registeredUnlock(unlocked,prior,saved,false),null);
  assert.equal(registeredUnlock(unlocked,prior,{...saved,state:'missing'}),null);
});
test('virtual declaration alone is context; publish mismatch needs a matching tuple reference',()=>{
  const signed=row([...core,e('app.certSha256','a'.repeat(64)),e('cpu.hardware','ranchu'),
    e('app.appDebuggable','是'),e('system.type','userdebug')]);
  assert.equal(assessRisk(signed,{state:'unregistered'}).level,'blue');
  assert.equal(assessRisk(signed,{state:'registered',signerSha256:'b'.repeat(64)}).level,'yellow');
  assert.equal(assessRisk(signed,{state:'registered',signerSha256:'a'.repeat(64)}).level,'blue');
});

test('architecture conflicts request review but compatible and missing evidence do not escalate',()=>{
  const abi=e('cpu.abis','arm64-v8a, armeabi-v7a');
  const kernel=e('cpu.kernelMachine','aarch64');
  const withBits=(bits,k=kernel)=>assessRisk(row([...core,abi,k,bits]));
  assert.equal(withBits(e('cpu.processBitness','32')).level,'blue');
  assert.equal(withBits(e('cpu.processBitness',null,'RESTRICTED','ACCESS_DENIED')).level,'blue');
  assert.equal(assessRisk(row(core)).rules.find(r=>r.code==='RUNTIME_ARCHITECTURE').evidence[0].status,'NOT_ARCHIVED');
  const report=withBits(e('cpu.processBitness','64'),e('cpu.kernelMachine','i686'));
  assert.equal(report.level,'yellow');
  assert.deepEqual(report.triggered,['RUNTIME_ARCHITECTURE']);
  assert.equal(report.attestation,'not_verified');
  assert.equal(report.rules.find(r=>r.code==='RUNTIME_ARCHITECTURE').evidence[2].value,'i686');
});

test('legacy SELinux inference and current node denial remain unconfirmed',()=>{
  const d=assessRisk(row(replace('system.selinux','Enforcing（强制模式，推断）')));
  const rule=d.rules.find(r=>r.code==='SELINUX_MODE');
  assert.equal(rule.state,'unknown');
  assert.match(rule.finding,/实时模式未确认/);
  assert.deepEqual(d.triggered,['SELINUX_MODE']);
  assert.equal(d.level,'gray');
  const blocked=assessRisk(row([...core.filter(p=>p.key!=='selinux'),
    e('system.selinux',null,'RESTRICTED','ACCESS_DENIED'),e('system.selinuxEvidence','inferred_mac')]));
  assert.equal(blocked.level,'gray');
  const evidence=blocked.rules.find(r=>r.code==='SELINUX_MODE').evidence;
  assert.equal(evidence.find(f=>f.key==='system.selinux').status,'RESTRICTED');
  assert.equal(evidence.find(f=>f.key==='system.selinuxEvidence').value,'inferred_mac');
  assert.equal(assessRisk(row(replace('system.selinux','Permissive（宽容模式）'))).level,'yellow');
});
