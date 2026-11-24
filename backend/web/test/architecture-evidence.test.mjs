import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {architectureEvidence} from '../src/architecture-evidence.ts';

test('shared app/web architecture cases: width, translation, unknowns and evidence conflict',()=>{
  const fixture=new URL('../../../app/src/test/resources/runtime-architecture.tsv',import.meta.url);
  for(const row of readFileSync(fixture,'utf8').trim().split(/\r?\n/)){
    const [process,abis,machine,expected]=row.split('\t');
    assert.equal(architectureEvidence(...[process,abis,machine].map(s=>s==='-'?undefined:s)),expected,row);
  }
});
