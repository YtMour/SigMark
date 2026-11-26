import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildVerification} from '../src/verification-package.ts';

// Field set 24 adds two kernel-side readings. The web never keeps its own field or unit
// table: it reads the catalog the backend serves, so the only thing worth asserting here is
// that an unknown unit string survives untouched and that a set-24-only row is reported as a
// field-set gap instead of a regression.
const field=(id,value,status='AVAILABLE')=>{
  const [group,key]=id.split('.');
  return {group,key,value,label:key,source:'TEST',status};
};
const report=(id,at,fieldSet,parameters)=>({id,assetId:'asset',receivedAt:new Date(at+3000).toISOString(),
  batch:'test',report:{schemaVersion:4,fieldSetVersion:fieldSet,model:'test',appVersion:'1.8.0',androidApi:34,
    capturedAtEpochMs:at,parameters}});
const catalog={schemaVersion:1,dictionaryVersion:'sigmark-lan-fields/15',latestFieldSet:24,items:[
  {key:'cpu.cpuCapacity',minSchemaVersion:4,sinceFieldSet:24,unit:'capacity_profile',valueKind:'enum_text',temporal:'configuration'},
  {key:'memory.cmaTotal',minSchemaVersion:4,sinceFieldSet:24,unit:'MiB',valueKind:'display_text',temporal:'configuration'},
]};
const shared=[field('memory.totalRam','7.5 GiB'),field('cpu.cpuParts','0x41:0xd05×4 / 0x41:0xd0b×2')];
const before=report('before',1700000000000,23,shared);
const current=report('current',1700000500000,24,[...shared,
  field('cpu.cpuCapacity','160/498/1024'),field('memory.cmaTotal','652 MiB')]);

test('kernel capacity profile and reserved CMA pool keep the catalog unit and read as a field-set gap',()=>{
  const sheet={schemaVersion:1,current,history:[before],historyLimit:12,hasEarlier:false,registeredBaselines:[]};
  const v=buildVerification(sheet,'before','','overview',catalog,undefined);
  assert.equal(v.scope,'same_asset_comparison');
  assert.equal(v.catalogVersion,'sigmark-lan-fields/15');

  const capacity=v.fields.find(f=>f.key==='cpu.cpuCapacity');
  assert.equal(capacity.spec.unit,'capacity_profile');
  assert.equal(capacity.spec.valueKind,'enum_text');
  assert.equal(capacity.current.value,'160/498/1024');
  assert.equal(capacity.baseline,null);
  assert.equal(capacity.comparison,'field_set_gap');

  const cma=v.fields.find(f=>f.key==='memory.cmaTotal');
  assert.equal(cma.spec.unit,'MiB');
  assert.equal(cma.spec.valueKind,'display_text');
  assert.equal(cma.current.value,'652 MiB');
  assert.equal(cma.comparison,'field_set_gap');

  // Rows both reports carry are still compared as readings, not as new fields.
  assert.equal(v.fields.find(f=>f.key==='memory.totalRam').comparison,'unchanged');
  assert.equal(v.fields.find(f=>f.key==='cpu.cpuParts').current.value,'0x41:0xd05×4 / 0x41:0xd0b×2');
});

test('the packet carries the unit strings verbatim and never normalizes an unknown unit',()=>{
  const sheet={schemaVersion:1,current,history:[],historyLimit:12,hasEarlier:false,registeredBaselines:[]};
  const v=buildVerification(sheet,'','','overview',catalog,undefined);
  const capacity=v.fields.find(f=>f.key==='cpu.cpuCapacity');
  assert.equal(capacity.comparison,'no_baseline');
  assert.equal(capacity.spec.unit,'capacity_profile');
  const text=JSON.stringify(v);
  assert(text.includes('"unit":"capacity_profile"'));
  assert(text.includes('"unit":"MiB"'));
  assert(text.includes('"value":"160/498/1024"'));
  assert(text.includes('"value":"652 MiB"'));
  // No MiB conversion: the archived reading is the kernel's own text.
  assert(!text.includes('652.0'));
});
