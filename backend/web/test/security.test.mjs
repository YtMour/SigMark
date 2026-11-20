import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareSecurity,evaluateSecurity} from '../src/security-rules.ts';
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

test('security changes separate expected unlock, regressions and missing fields',()=>{
  const before=[field('environment','flashLock','1'),field('system','patch','2026-11-19'),field('app','debuggerConnected','否')];
  const after=[field('environment','flashLock','0'),field('system','patch','2025-11-19'),field('app','debuggerConnected','是'),field('environment','keyguardSecure','是')];
  const changes=compareSecurity(before,after,true);
  const verdict=Object.fromEntries(changes.map(row=>[row.key,row.verdict]));
  assert.equal(verdict['environment.flashLock'],'expected');
  assert.equal(verdict['system.patch'],'review');
  assert.equal(verdict['app.debuggerConnected'],'review');
  assert.equal(verdict['environment.keyguardSecure'],'insufficient');
});

test('expecting unlock does not mask inconsistent lock evidence',()=>{
  const base=[field('environment','flashLock','1')];
  const after=[field('environment','flashLock','0'),field('environment','vbmetaState','locked')];
  assert.equal(compareSecurity(base,after,true).find(row=>row.key==='environment.flashLock').verdict,'review');
});
