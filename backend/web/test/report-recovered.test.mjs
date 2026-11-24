import {test} from 'node:test';
import assert from 'node:assert/strict';
import {energyFromArchive,newerMatchingBuild} from '../src/report-recovered.ts';

const reading=(group,key,value,source,status='AVAILABLE')=>({group,key,value,source,status,label:key});
const counter=reading('battery','energyCounter',null,'BatteryManager.BATTERY_PROPERTY_ENERGY_COUNTER','UNAVAILABLE');
const charge=reading('battery','chargeCounter','4658.0 mAh','BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER');
const voltage=reading('battery','voltage','4383 mV','BatteryManager.EXTRA_VOLTAGE');
const rows=[counter,charge,voltage];

test('uses readings from the same report and preserves the original energy counter',()=>{
  const result=energyFromArchive(rows);
  assert.equal(result.wh,'20.42');
  assert.equal(result.rule,'BATTERY_ENERGY_ESTIMATE/1');
  assert.equal(result.counter.value,null);
  assert.equal(result.counter.status,'UNAVAILABLE');
  assert.equal(energyFromArchive([{...counter,value:'20.00 Wh',status:'AVAILABLE'},charge,voltage]),null);
  assert.equal(energyFromArchive([charge,voltage]),null);
});

test('estimates only valid, available, uniquely identified API inputs',()=>{
  for(const item of [{...charge,value:'0.0 mAh'},{...charge,value:'30000.1 mAh'},
    {...charge,status:'RESTRICTED'},{...charge,source:'unverified'},
    {...charge,value:'4658.0 µAh'}])assert.equal(energyFromArchive([counter,item,voltage]),null);
  assert.equal(energyFromArchive([counter,charge,{...voltage,value:'999 mV'}]),null);
  assert.equal(energyFromArchive([...rows,voltage]),null);
});

test('shows upgrade only for an older matching LAN signer and version code',()=>{
  const signer='a'.repeat(64);
  const build={version:'1.6.0',versionCode:33,signerSha256:signer};
  const version=reading('app','version','1.4.1 (31)','PackageManager');
  const cert=reading('app','certSha256',signer,'PackageManager');
  const channel=reading('app','channel','lan-debug','BuildConfig');
  const app=[version,cert,channel];
  assert.deepEqual(newerMatchingBuild(app,build),{observed:'1.4.1 (31)',published:'1.6.0 (33)'});
  assert.equal(newerMatchingBuild([{...version,value:'1.6.0 (33)'},cert,channel],build),null);
  assert.equal(newerMatchingBuild(app,{...build,signerSha256:'b'.repeat(64)}),null);
  assert.equal(newerMatchingBuild([version,cert],build),null);
});
