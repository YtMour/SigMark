import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {buildVerification} from '../src/verification-package.ts';
import {overlayChannels,overlayHasConflict,overlayNote} from '../src/overlay-evidence.ts';

// Real reading from the field-set 25 phone run: image paths agree, sku degraded to a
// comma-separated list because ro.boot.hardware.sku is rewritten per UID.
const agreed='rro:oriole / vendor_dir:oriole / product_dir:oriole / sku:g9s9b,gb7n6,gr1yh / soc:gs101';
const conflicted='rro:oriole / vendor_dir:oriole / product_dir:corot / sku:g9s9b / conflict:device_codename / soc:gs101';

const field=(id,value,status='AVAILABLE')=>{
  const [group,key]=id.split('.');
  return {group,key,value,label:key,source:'APP_DIR_LIST',status};
};
const report=(id,at,fieldSet,parameters)=>({id,assetId:'asset',receivedAt:new Date(at+3000).toISOString(),
  batch:'test',report:{schemaVersion:4,fieldSetVersion:fieldSet,model:'test',appVersion:'2.0.0',androidApi:34,
    capturedAtEpochMs:at,parameters}});
const catalog={schemaVersion:1,dictionaryVersion:'sigmark-lan-fields/16',latestFieldSet:25,items:[
  {key:'environment.overlayEvidence',minSchemaVersion:4,sinceFieldSet:25,unit:'overlay_evidence',
    valueKind:'enum_text',temporal:'configuration'},
  {key:'environment.overlayDeviceCodename',minSchemaVersion:4,sinceFieldSet:12,temporal:'configuration'},
]};
const sheet=value=>({schemaVersion:1,current:report('current',1700000500000,25,[
  field('environment.overlayDeviceCodename','oriole'),field('environment.overlayEvidence',value)]),
  history:[],historyLimit:12,hasEarlier:false,registeredBaselines:[]});

test('the overlay evidence string keeps its format marker and is never shortened',()=>{
  const v=buildVerification(sheet(agreed),'','','overview',catalog,undefined);
  assert.equal(v.catalogVersion,'sigmark-lan-fields/16');
  const row=v.fields.find(f=>f.key==='environment.overlayEvidence');
  assert.equal(row.spec.unit,'overlay_evidence');
  assert.equal(row.spec.valueKind,'enum_text');
  assert.equal(row.current.value,agreed);
  assert.equal(row.comparison,'no_baseline');
  const text=JSON.stringify(v);
  assert(text.includes('"unit":"overlay_evidence"'));
  assert(text.includes(JSON.stringify(agreed).slice(1,-1)),'the archived string survives the packet verbatim');
  assert(!text.includes('…')&&!text.includes('...'));
});

test('channels are read by name only, and conflict is a separate channel',()=>{
  assert.deepEqual(overlayChannels(agreed),['rro','vendor_dir','product_dir','sku','soc']);
  assert.equal(overlayHasConflict(agreed),false);
  assert.deepEqual(overlayChannels(conflicted),['rro','vendor_dir','product_dir','sku','conflict','soc']);
  assert.equal(overlayHasConflict(conflicted),true);
  // No payload parsing: a colon-free chunk is its own channel, and empty input stays empty.
  assert.deepEqual(overlayChannels('none'),['none']);
  assert.deepEqual(overlayChannels(''),[]);
  assert.deepEqual(overlayChannels(null),[]);
});

test('both overlay rows explain themselves and only a conflict channel adds the warning',()=>{
  const codename=overlayNote('environment.overlayDeviceCodename','oriole');
  assert(codename.text.includes('overlay 目录与文件名'));
  assert.equal(codename.conflict,'');

  const plain=overlayNote('environment.overlayEvidence',agreed);
  assert(plain.text.includes('channel:payload'));
  assert(plain.text.includes('sku: 只是旁证'),'the parallel sku list has to be explained');
  assert(plain.text.includes('不是计量单位'),'overlay_evidence is a format marker, not a unit');
  assert.equal(plain.conflict,'');

  const hit=overlayNote('environment.overlayEvidence',conflicted);
  assert(hit.conflict.includes('conflict:'));
  assert(hit.conflict.includes('不据此判定设备真伪'));

  assert.equal(overlayNote('environment.other','x'),undefined);
});

test('web source keeps no field count or dictionary version literal of its own',()=>{
  const dir=new URL('../src/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>/\.tsx?$/.test(n))){
    const source=readFileSync(new URL(name,dir),'utf8');
    assert(!/\b23[45]\b/.test(source),name+' hardcodes a static key count');
    assert(!source.includes('sigmark-lan-fields/'),name+' hardcodes a dictionary version');
  }
});
