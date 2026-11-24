import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scoreCalibration} from '../qa/calibrate-risk.mjs';

const label=(deviceKey,packet,expected,cohort='stock_device')=>({deviceKey,packet,expected,cohort,labelledAt:'2026-11-23T11:00:00Z'});
const make=(reportId,level,at=1700000000000,kind='standard')=>({
  kind:'sigmark.verification-package',schemaVersion:1,source:{current:{reportId,captureAt:at}},
  risk:{reportId,level,ruleVersion:'sigmark-observation-risk/2',policy:{kind}},
});
test('calibration counts repeated samples once per device and keeps gray outside false rate',async()=>{
  const yaml={a0:make('a0','yellow'),a1:make('a1','blue',1700000009000),
    b:make('b','yellow'),c:make('c','gray'),d:make('d','blue'),
    custom:make('custom','gray',1700000010000,'registered_experiment')};
  const cases=[label('a','a0','no_alert'),label('a','a1','no_alert'),label('b','b','no_alert'),
    label('c','c','alert'),label('d','d','alert'),label('a','custom','unknown','custom_rom_device')];
  const data=await scoreCalibration({schemaVersion:1,cases},name=>yaml[name]);
  assert.equal(data.uniqueDevices,4);
  const first=data.strata[0];
  assert.equal(data.totalSamples,6);assert.equal(first.devices,4);
  assert.deepEqual(first.counts,{truePositive:0,falsePositive:1,trueNegative:1,falseNegative:1,insufficient:1,unlabelled:0});
  assert.equal(first.falsePositiveRate,.5);assert.equal(first.falseNegativeRate,1);assert.equal(first.coverage,.75);
  assert.equal(data.strata[1].falsePositiveRate,null);
});
test('conflicting truth and repeated report assignments are rejected',async()=>{
  const data={schemaVersion:1,cases:[label('a','x','alert'),label('a','y','no_alert')]};
  await assert.rejects(scoreCalibration(data,n=>make(n,'red')),/conflicting/i);
  data.cases[1]=label('b','x','alert');
  await assert.rejects(scoreCalibration(data,n=>make(n,'red')),/duplicate/i);
});
