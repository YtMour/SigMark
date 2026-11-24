import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSecurity,compareSummary,evaluateSecurity,identityConflictsOf,ruleVersion} from '../src/security-rules.ts';
const field=(group,key,value,status='AVAILABLE')=>({group,key,label:key,value,status,source:'QA'});
const check=(rows,id)=>evaluateSecurity({parameters:rows, model:'MI 8',androidApi:29,capturedAtEpochMs:Date.UTC(2026,10,20)}).find(row=>row.id===id);
test('missing and restricted readings do not imply boot, SELinux or physical identity',()=>{
  assert.equal(check([field('environment','verifiedBoot','green','RESTRICTED')],'boot').state,'unknown');
  assert.equal(check([field('system','selinux',null,'RESTRICTED')],'selinux').state,'unknown');
  assert.equal(check([],'identity').state,'unknown');
});
test('boot conflict overrides green; a custom root without other findings is context',()=>{
  assert.equal(check([field('environment','verifiedBoot','green'),field('environment','flashLock','1'),field('environment','vbmetaState','unlocked')],'boot').state,'review');
  assert.equal(check([field('environment','verifiedBoot','yellow'),field('environment','flashLock','1')],'boot').state,'context');
  assert.equal(check([field('environment','verifiedBoot','green'),field('environment','flashLock','1')],'boot').state,'observed');
});
test('test APK alone is not a device risk',()=>{
  assert.equal(check([field('app','appDebuggable','是')],'debug').state,'context');
});
test('patch rejects impossible dates and uses capture date, not viewer clock',()=>{
  assert.equal(check([field('system','patch','2026-02-30')],'patch').state,'unknown');
  assert.equal(check([field('system','patch','2026-11-25')],'patch').state,'review');
  assert.match(check([field('system','patch','2026-11-19')],'patch').finding,/1 天/);
});

test('identity declarations are only compared inside one observer, three pairs at a time',()=>{
  const shape=[['system','board'],['system','boardPlatform'],['cpu','hardware'],['system','bootHardware'],
    ['system','sku'],['system','hardwareSku']];
  const rows=values=>values.map((entry,index)=>Array.isArray(entry)?
    field(shape[index][0],shape[index][1],entry[0],entry[1]):field(shape[index][0],shape[index][1],entry));
  const same=['rk3588','rk3588','mt6985','MT6985','GR1YH','gr1yh'];
  const observed=check(rows(same),'identity_fields');
  assert.equal(observed.title,'身份字段一致性');
  assert.equal(observed.state,'observed');
  assert.match(observed.finding,/主板 Build=rk3588 \/ 属性=rk3588/);
  assert.match(observed.finding,/不是独立验证/);
  for(const [index,title] of [[0,'主板'],[2,'硬件'],[4,'SKU']]){
    const conflicting=rows(same).map((row,position)=>position===index+1?{...row,value:'other-'+title}:row);
    const conflict=check(conflicting,'identity_fields');
    assert.equal(conflict.state,'review',title);
    assert.match(conflict.finding,/同一观察者内部两组声明不一致，先核对 ROM 属性改写/);
    assert.match(conflict.finding,new RegExp(title+' Build='),title);
    assert.doesNotMatch(conflict.finding,/真伪|真假|伪造/);
  }
  const onePair=[['rk3588','AVAILABLE'],['rk3588','AVAILABLE'],['','UNAVAILABLE'],['','RESTRICTED'],
    ['','NOT_ARCHIVED'],['','NOT_ARCHIVED']];
  assert.equal(check(rows(onePair),'identity_fields').state,'observed');
  const onePairConflict=rows(onePair).map(row=>row.key==='boardPlatform'?{...row,value:'rk3588s'}:row);
  assert.equal(check(onePairConflict,'identity_fields').state,'review');
  assert.equal(check(rows([['rk3588','AVAILABLE'],['','NOT_ARCHIVED']]),'identity_fields').state,'unknown');
  assert.equal(check([],'identity_fields').state,'unknown');
  assert.equal(check(rows(same.map(value=>[value,'RESTRICTED'])),'identity_fields').state,'unknown');
});

test('security changes separate expected unlock, regressions and missing fields',()=>{
  const before=[field('environment','flashLock','1'),field('system','patch','2026-11-19'),field('app','debuggerConnected','否')];
  const after=[field('environment','flashLock','0'),field('system','patch','2025-11-19'),field('app','debuggerConnected','是'),field('environment','keyguardSecure','是')];
  const changes=compareSecurity(before,after,true);
  const verdict=Object.fromEntries(changes.map(row=>[row.key,row.verdict]));
  assert.equal(verdict['environment.flashLock'],'expected');
  assert.equal(verdict['system.patch'],'review');
  assert.equal(verdict['app.debuggerConnected'],'review');
  assert.equal(verdict['environment.keyguardSecure'],'not_archived');
});

test('expecting unlock does not mask inconsistent lock evidence',()=>{
  const base=[field('environment','flashLock','1')];
  const after=[field('environment','flashLock','0'),field('environment','vbmetaState','locked')];
  assert.equal(compareSecurity(base,after,true).find(row=>row.key==='environment.flashLock').verdict,'review');
});

test('rule version and the field-set-17 checks exist without deciding root or injection',()=>{
  assert.equal(ruleVersion,'rom-evidence/4');
  const ids=evaluateSecurity({parameters:[],model:'MI 8',androidApi:34}).map(row=>row.id);
  for(const id of ['hook','trace','profile','drm','rom','identity_fields'])assert(ids.includes(id),id);
});

test('inferred SELinux is stated as an inference and stays an observed reading',()=>{
  const direct=field('system','selinux','Enforcing（强制模式）');
  const inferred=field('system','selinux','Enforcing（强制模式，推断）');
  const basis=field('system','selinuxEvidence','inferred_mac');
  const inference=check([inferred,basis],'selinux');
  assert.equal(inference.state,'observed');
  assert.match(inference.finding,/报告只能推断为强制模式：节点被策略拒绝读取，DAC 允许读取，permissive 下本应可读/);
  assert.match(inference.finding,/推断/);
  assert.equal(check([direct],'selinux').state,'observed');
  assert.doesNotMatch(check([direct],'selinux').finding,/推断/);
  assert.equal(check([field('system','selinux','Permissive（宽容模式）')],'selinux').state,'review');
  assert.match(check([field('system','selinux','Enforcing'),basis],'selinux').finding,/推断/);
});

test('a denied SELinux node is not downgraded when only the read basis is inferred',()=>{
  const restricted=check([{...field('system','selinux',null,'RESTRICTED'),reason:'ACCESS_DENIED',errno:13},field('system','selinuxEvidence','exact')],'selinux');
  assert.equal(restricted.state,'unknown');
  assert.match(restricted.finding,/受限节点或应用进程域不能代替实时模式/);
});

test('SELinux direct and inferred readings are the same mode, not a change',()=>{
  const direct=[field('system','selinux','Enforcing（强制模式）'),field('system','selinuxEvidence','exact')];
  const inferred=[field('system','selinux','Enforcing（强制模式，推断）'),field('system','selinuxEvidence','inferred_mac')];
  const rows=compareSecurity(direct,inferred);
  const mode=rows.find(row=>row.key==='system.selinux');
  assert.equal(mode.verdict,'context');
  assert.match(mode.note,/模式一致/);
  assert.match(mode.note,/由直接读取变为推断/);
  assert.match(compareSecurity(inferred,direct).find(row=>row.key==='system.selinux').note,/由推断变为直接读取/);
  assert.equal(rows.find(row=>row.key==='system.selinuxEvidence').verdict,'context');
  const permissive=[field('system','selinux','Permissive（宽容模式）'),field('system','selinuxEvidence','exact')];
  assert.equal(compareSecurity(direct,permissive).find(row=>row.key==='system.selinux').verdict,'review');
});

test('a restricted side is restricted, a missing side is not archived, never a change',()=>{
  const baseline=[field('system','selinux','Enforcing（强制模式）')];
  const blocked=[{...field('system','selinux',null,'RESTRICTED'),reason:'ACCESS_DENIED',errno:13}];
  const restricted=compareSecurity(baseline,blocked).find(row=>row.key==='system.selinux');
  assert.equal(restricted.verdict,'restricted');
  assert.match(restricted.note,/不判定变化/);
  assert.equal(compareSecurity([],blocked).find(row=>row.key==='system.selinux').verdict,'not_archived');
  assert.equal(compareSecurity(baseline,[field('system','selinux','Enforcing（强制模式）')])
    .find(row=>row.key==='system.selinux').verdict,'unchanged');
});

test('hook, tracer, profile, DRM and ROM readings request review without declaring a cause',()=>{
  const hook=check([field('environment','hookSignals','frida / zygisk'),field('environment','rootMountHints','none'),
    field('environment','rootManagerVisible','none')],'hook');
  assert.equal(hook.state,'review');
  assert.match(hook.finding,/不是设备已注入或已 Root 的结论/);
  const clean=check([field('environment','hookSignals','none'),field('environment','rootMountHints','none'),
    field('environment','rootManagerVisible','none')],'hook');
  assert.equal(clean.state,'observed');
  assert.match(clean.finding,/不能反证/);
  assert.equal(check([field('environment','hookSignals','none')],'hook').state,'unknown');
  assert.equal(check([field('app','debuggerConnected','否'),field('environment','tracerPid','4211')],'trace').state,'review');
  assert.equal(check([field('app','debuggerConnected','否'),field('environment','tracerPid','0')],'trace').state,'observed');
  assert.equal(check([field('app','debuggerConnected','否')],'trace').state,'unknown');
  const traced=compareSecurity([field('environment','tracerPid','0')],[field('environment','tracerPid','4211')])
    .find(row=>row.key==='environment.tracerPid');
  assert.equal(traced.verdict,'review');
});

test('profile, DRM and ROM declarations stay environment clues',()=>{
  assert.equal(check([field('environment','userProfile','owner')],'profile').state,'observed');
  const secondary=check([field('environment','userProfile','secondary')],'profile');
  assert.equal(secondary.state,'review');
  assert.match(secondary.finding,/多用户或分身环境，需核对测试条件/);
  assert.equal(check([field('environment','drmSecurityLevel','L1')],'drm').state,'observed');
  assert.equal(check([field('environment','drmSecurityLevel','L3')],'drm').state,'context');
  assert.equal(check([field('environment','drmSecurityLevel',null,'RESTRICTED')],'drm').state,'unknown');
  assert.equal(check([field('environment','verityMode','disabled'),field('environment','buildDebuggable','关闭')],'rom').state,'review');
  assert.equal(check([field('environment','buildDebuggable','开启')],'rom').state,'review');
  assert.equal(check([field('system','partitionBuildDates','system 2024-01-05 · vendor 2023-12-11')],'rom').state,'context');
  assert.equal(check([],'rom').state,'unknown');
});

test('compare summary counts verdicts per category and keeps review out of changes',()=>{
  const base=[field('environment','verifiedBoot','green'),field('environment','flashLock','1'),
    field('system','selinux','Enforcing（强制模式）'),field('system','patch','2026-11-01'),
    field('app','debuggerConnected','否'),field('environment','keyguardSecure','是'),
    field('environment','storageEncryption','已启用'),field('environment','hookSignals','none')];
  const after=base.map(row=>row.key==='hookSignals'?{...row,value:'frida'}:row);
  const rows=compareSecurity(base,after);
  const summary=compareSummary(rows);
  assert.equal(summary.total,rows.length);
  assert.equal(summary.unchanged,7);
  assert.equal(summary.changed,0);
  assert.equal(summary.restricted,0);
  assert.equal(summary.notArchived,1);
  assert.equal(summary.insufficient,0);
  assert.deepEqual(summary.byCategory.boot,{unchanged:2,changed:0,restricted:0,notArchived:1,insufficient:0});
  assert.deepEqual(summary.byCategory.runtime,{unchanged:1,changed:0,restricted:0,notArchived:0,insufficient:0});
  assert.deepEqual(summary.byCategory.identity,{unchanged:0,changed:0,restricted:0,notArchived:0,insufficient:0});
  assert.equal(rows.find(row=>row.key==='environment.hookSignals').verdict,'review');
  assert.equal(rows.find(row=>row.key==='environment.hookSignals').category,'runtime');
  assert.equal(rows.find(row=>row.key==='environment.verifiedBoot').category,'boot');
  assert.equal(rows.find(row=>row.key==='system.patch').category,'rom');
  assert.equal(rows.find(row=>row.key==='environment.keyguardSecure').category,'protection');
});

test('identity field rows compare as identity readings without judging the device',()=>{
  const before=[field('system','boardPlatform','rk3588'),field('system','bootHardware','mt6985'),field('system','hardwareSku','GR1YH')];
  const after=[field('system','boardPlatform','rk3588s'),field('system','bootHardware','mt6985'),field('system','hardwareSku','GR1YH')];
  const rows=compareSecurity(before,after);
  for(const key of ['system.boardPlatform','system.bootHardware','system.hardwareSku']){
    const row=rows.find(item=>item.key===key);
    assert(row,key);
    assert.equal(row.category,'identity',key);
  }
  assert.equal(rows.find(row=>row.key==='system.boardPlatform').verdict,'changed');
  assert.equal(rows.find(row=>row.key==='system.bootHardware').verdict,'unchanged');
  const summary=compareSummary(rows);
  assert.equal(summary.byCategory.identity.changed,1);
  assert.equal(summary.byCategory.identity.unchanged,2);
  assert.equal(summary.byCategory.identity.notArchived,0);
});


test('identity conflicts are exposed as pairs for the reader banner',()=>{
  const conflict=identityConflictsOf([
    field('system','board','mt6985'),field('system','boardPlatform','gs101'),
    field('cpu','hardware','mtk'),field('system','bootHardware','MTK'),
    field('system','sku','23078PND5G')]);
  assert.equal(conflict.length,1);
  assert.deepEqual(conflict[0],{title:'主板',leftKey:'system.board',rightKey:'system.boardPlatform',left:'mt6985',right:'gs101'});
  assert.equal(identityConflictsOf([field('system','board','mt6985')]).length,0);
  assert.equal(identityConflictsOf([
    field('system','board','mt6985'),field('system','boardPlatform',null,'RESTRICTED')]).length,0);
  assert.equal(identityConflictsOf([
    field('system','board','mt6985'),field('system','boardPlatform','MT6985')]).length,0);
});
