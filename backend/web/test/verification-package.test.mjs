import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildVerification,compareProbe,experiment,objectiveOf} from '../src/verification-package.ts';

const field=(id,value,status='AVAILABLE',reason,errno)=>{
  const [group,key]=id.split('.');
  return {group,key,value,label:key,source:'TEST',status,reason,errno};
};
const base=(id,assetId,at,fieldSet,parameters)=>({id,assetId,receivedAt:new Date(at+3000).toISOString(),batch:'test',
  report:{schemaVersion:4,fieldSetVersion:fieldSet,model:'test',appVersion:'1.3.0',androidApi:34,
    capturedAtEpochMs:at,parameters,feedback:'not for export'}});
const old=base('old','asset',1700000000000,9,[field('battery.level','30%'),field('environment.verifiedBoot','green')]);
const newer=base('new','asset',1700000500000,12,[
  field('battery.level','70%'),field('environment.verifiedBoot','orange'),field('environment.flashLock','0'),
  field('system.selinux',null,'RESTRICTED','ACCESS_DENIED',13),field('runtime.glesProbeResult','pass'),field('runtime.glesProbeStage','done'),
  field('environment.capturePlan','network'),field('network.checkStartTransport','wifi'),field('network.checkEndTransport','cellular'),
  field('network.checkEndValidated','yes'),field('network.checkElapsed','3500 ms')]);
const saved={id:'saved',reportId:old.id,name:'registered',state:'ready',expectUnlock:true,expectedNetwork:'wifi'};
const sheet={schemaVersion:1,current:newer,history:[],historyLimit:12,hasEarlier:true,
  registeredBaselines:[saved],registeredReport:old};
const catalog={schemaVersion:1,dictionaryVersion:'fixture',latestFieldSet:12,items:[
  {key:'runtime.glesProbeResult',minSchemaVersion:4,sinceFieldSet:12,temporal:'experiment'},
  {key:'battery.level',minSchemaVersion:2,temporal:'snapshot'},
]};
test('packet preserves the registered policy, field provenance, and privacy across field sets',()=>{
  const v=buildVerification(sheet,'','saved','overview',catalog,undefined);
  assert.equal(v.scope,'same_asset_comparison');
  assert.equal(v.risk.rules.find(r=>r.code==='BOOT_STATE').state,'expected');
  assert.equal(v.strength.independentVerification,'not_performed');
  assert.equal(v.source.baseline.reportId,old.id);
  assert.equal(v.fields.find(f=>f.key==='runtime.glesProbeResult').comparison,'field_set_gap');
  assert.equal(v.fields.find(f=>f.key==='battery.level').comparison,'context_or_experiment');
  assert.equal(v.fields.find(f=>f.key==='system.selinux').current.errno,13);
  assert.equal(v.coverage.length,12);
  assert.equal(v.experiments.find(x=>x.current.id==='route').current.state,'passed');
  assert(!/not for export|assetId/.test(JSON.stringify(v)));
});
test('URL never authorizes a foreign/stale baseline or unlock exception',()=>{
  for(const report of [{...old,assetId:'other'},{...old,trashedAt:'2026-01-01'},{...old,report:{...old.report,capturedAtEpochMs:newer.report.capturedAtEpochMs}}]){
    const v=buildVerification({...sheet,registeredReport:report},'','saved','rom',catalog,undefined);
    assert.equal(v.source.baseline,null);
    assert.equal(v.baselineUnavailable,true);
    assert.equal(v.risk.rules.find(r=>r.code==='BOOT_STATE').state,'review');
  }
  assert.equal(buildVerification({...sheet,registeredReport:undefined},'','saved','rom',catalog,undefined).policy,null);
});
test('experiment distinguishes other plan, unvalidated target, failure, and observed outcome',()=>{
  assert.equal(objectiveOf('arbitrary'),'overview');
  assert.equal(experiment(old,'gles').state,'not_recorded');
  const romOnly={...newer,report:{...newer.report,parameters:[field('environment.capturePlan','rom')]}};
  assert.equal(experiment(romOnly,'route').state,'not_run');
  const raw=newer.report.parameters.filter(f=>f.key!=='checkEndValidated');
  const sample=params=>({...newer,report:{...newer.report,parameters:params}});
  assert.equal(experiment(sample(raw),'route').state,'incomplete');
  assert.equal(experiment(sample([...raw,field('network.checkEndValidated','no')]),'route').state,'failed');
  assert.equal(experiment(newer,'route').timing.startEpochMs,null);
  assert.equal(experiment(newer,'route').timing.duration,'3500 ms');
});
test('USB positive and repeat count use observed endpoints, never foreign reports or legacy timestamps',()=>{
  const params=[field('environment.capturePlan','usb'),field('runtime.usbStartCount','0'),field('runtime.usbEndCount','1'),
    field('runtime.usbOutcome','increase'),field('runtime.usbElapsed','930 ms'),
    field('runtime.usbStartAt','1700000000000'),field('runtime.usbEndAt','1700000000930')];
  const current={...newer,report:{...newer.report,fieldSetVersion:13,parameters:params}};
  const older={...old,report:{...old.report,fieldSetVersion:13,parameters:params}};
  const item=buildVerification({...sheet,current,history:[older,{...older,id:'foreign',assetId:'other'}]},'','','usb',undefined,undefined).experiments[0];
  assert.equal(item.current.state,'passed');
  assert.equal(item.current.timing.endEpochMs,1700000000930);
  assert.deepEqual(item.observedRuns,{total:2,passed:2,failed:0,incomplete:0,historyLimited:true});
  assert.equal(experiment(old,'usb').state,'not_recorded');
});
test('ROM test comparison distinguishes actual regression, timeout and changed conditions',()=>{
  const rom=(row,result,version,stage,fixture='sigmark-avc/1')=>({...row,report:{...row.report,fieldSetVersion:13,parameters:[
    field('environment.capturePlan','rom'),field('runtime.glesProbeResult',result),field('runtime.glesProbeStage',stage),
    field('runtime.glesProbeVersion',version),field('media.avcFixture',fixture),field('media.avcFirstFrame',result),
  ]}});
  const a=rom(old,'pass','3.2','done');
  const b=rom(newer,'fail','3.2','readback');
  const cmp=(left,right,id)=>compareProbe(experiment(left,id),experiment(right,id),left,right);
  assert.equal(cmp(a,b,'gles'),'regression');
  assert.equal(cmp(a,rom(newer,'not_completed','3.2','timeout'),'gles'),'not_comparable');
  assert.equal(cmp(a,rom(newer,'fail','3.0','readback'),'gles'),'different_conditions');
  assert.equal(cmp(a,{...b,assetId:'foreign'},'gles'),'not_comparable');
  assert.equal(cmp(a,b,'avc'),'regression');
  assert.equal(cmp(a,rom(newer,'fail','3.2','readback','sigmark-avc/2'),'avc'),'different_fixture');
});
test('field set 17 keeps the same 1×1 ROM comparison as field sets 12 through 16',()=>{
  const rom=(row,result,stage)=>({...row,report:{...row.report,fieldSetVersion:17,parameters:[
    field('environment.capturePlan','rom'),field('runtime.glesProbeResult',result),field('runtime.glesProbeStage',stage),
    field('runtime.glesProbeVersion','3.2'),field('media.avcFixture','sigmark-avc/1'),field('media.avcFirstFrame',result),
  ]}});
  const a=rom(old,'pass','done'),b=rom(newer,'fail','readback');
  assert.equal(compareProbe(experiment(a,'gles'),experiment(b,'gles'),a,b),'regression');
  assert.equal(experiment(b,'gles').state,'failed');
});

test('overall capture compares local experiments with ROM captures while interactive experiments stay separate',()=>{
  const run=(row,plan)=>({...row,report:{...row.report,fieldSetVersion:20,parameters:[
    field('environment.capturePlan',plan),
    field('media.avcFixture','sigmark-avc/1'),field('media.avcFirstFrame','pass'),
    field('runtime.glesProbeResult','pass'),field('runtime.glesProbeStage','done'),field('runtime.glesProbeVersion','3.2'),
  ]}});
  const a=run(old,'rom'),b=run(newer,'full');
  for(const probe of ['avc','gles']){
    assert.equal(experiment(b,probe).state,'passed');
    assert.equal(compareProbe(experiment(a,probe),experiment(b,probe),a,b),'both_pass');
  }
  for(const probe of ['usb','route','gnss'])assert.equal(experiment(b,probe).state,'not_run');
  const noEvidence=(plan)=>({...b,report:{...b.report,parameters:[field('environment.capturePlan',plan)]}});
  assert.equal(experiment(noEvidence('full'),'avc').state,'not_recorded');
  assert.equal(experiment(noEvidence('standard'),'avc').state,'not_run');
});
