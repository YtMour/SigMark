import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bootEvidence,compareSecurity,evaluateSecurity,releaseQuery} from '../src/security-rules.ts';
const field=(group,key,value)=>({group,key,value,source:'fixture',label:key,status:'AVAILABLE'});
test('Android and Web use the same boot cases; an unchanged contradiction still needs review',()=>{
  const cases=readFileSync(new URL('../../../app/src/test/resources/security-boot.tsv',import.meta.url),'utf8');
  for(const row of cases.trim().split(/\r?\n/)){
    const [a,b,c,expected]=row.split('\t');
    assert.equal(bootEvidence(...[a,b,c].map(x=>x==='-'?undefined:x)),expected,row);
  }
  const rows=[field('environment','verifiedBoot','green'),field('environment','flashLock','0')];
  assert.equal(compareSecurity(rows,rows,true).find(x=>x.key==='environment.flashLock').verdict,'review');
});
test('only an exact publication tuple matches the reported signer',()=>{
  const sha='a'.repeat(64);
  const params=Object.entries({package:'com.sigmark.app',channel:'lan-debug',certSha256:sha,version:'0.18.0 (20)'}).map(([k,v])=>field('app',k,v));
  assert.equal(releaseQuery('0.17.0',params),'');
  assert.equal(new URLSearchParams(releaseQuery('0.18.0',params)).get('code'),'20');
  const state=ref=>evaluateSecurity({fieldSetVersion:7,parameters:params},ref).find(x=>x.id==='signer').state;
  assert.equal(state({state:'registered',signerSha256:sha}),'observed');
  assert.equal(state({state:'registered',signerSha256:'b'.repeat(64)}),'review');
  assert.equal(state({state:'unregistered'}),'unknown');
});
test('partition additions are not regressions; component rollback requires same provider',()=>{
  const fields=(provider,code)=>[field('system','webViewProvider',provider),field('system','webViewCode',code)];
  const a=fields('provider.a','100'),b=[...fields('provider.a','88'),field('system','partition_vendor','fp')];
  assert.equal(compareSecurity(a,b).find(x=>x.key==='system.webViewCode').verdict,'review');
  assert.equal(compareSecurity(a,b).find(x=>x.key==='system.partition_vendor').verdict,'insufficient');
  assert.equal(compareSecurity(a,fields('provider.b','12')).find(x=>x.key==='system.webViewCode').verdict,'changed');
  assert(!evaluateSecurity({fieldSetVersion:6,parameters:[]}).some(x=>x.id==='keystore'));
});
