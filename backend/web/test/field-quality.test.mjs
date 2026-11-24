import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gnssYearQuality,gnssAudit,otherFieldQuality} from '../src/field-quality.ts';
import {experiment} from '../src/verification-package.ts';
const at=Date.UTC(2026,10,23);
const row=(key,value,status='AVAILABLE')=>({key,group:'system',source:'fixture',status,value});
const code=(p)=>gnssAudit(p,at).map(r=>r.code);

test('GNSS raw 0 is pre-2016; 2016 is valid and unknown year stays missing',()=>{
  for(const [v,x] of [[null,'no_reading'],['0','before_2016'],['2015','below_min'],['-1','below_min'],['2016','reported'],
    ['2027','future'],['02016','invalid_format'],['2147483648','invalid_format']])
    assert.equal(gnssYearQuality(v,at),x);
  assert.equal(gnssYearQuality('2016',0),'clock_unknown');
  assert(code([row('gnssHardwareYear',null,'UNAVAILABLE')]).includes('GNSS_YEAR_NO_READING'));
});

test('cross-checks distinguish declarations, nonempty callbacks, absent hardware and reversed wall clock',()=>{
  const result=code([row('gnssHardwareYear','2016'),row('gnssProvider','no'),row('interfaceCapabilities','gnss / usb_host'),
    row('gnssCapabilities','antenna_info'),row('gnssCheckStatus','observed'),row('gnssCheckMeasurements','observed'),
    row('gnssCheckStartAt',String(at)),row('gnssCheckEndAt',String(at-1000))]);
  for(const k of ['GNSS_YEAR_REPORTED','GNSS_PROVIDER_REVIEW','GNSS_MEASUREMENTS_REVIEW','GNSS_CALLBACK_OBSERVED','GNSS_CLOCK_REVERSED','GNSS_NO_INDEPENDENT_PROOF'])
    assert(result.includes(k),k);
  const missing=code([row('gnssCheckStatus',null,'RESTRICTED'),row('gnssCheckMeasurements','not_seen')]);
  assert(missing.includes('GNSS_NOT_CONFIRMED'));
  assert(!missing.includes('GNSS_CALLBACK_OBSERVED'));
  assert(code([]).includes('GNSS_NOT_RUN'));
});

test('GNSS experiment does not make timeout or restricted conditions a hardware failure',()=>{
  const f=(status,measurement)=>({report:{fieldSetVersion:14,parameters:[
    {...row('capturePlan','gnss'),group:'environment'},row('gnssCheckPrerequisite','ready'),
    row('gnssCheckStatus',status),row('gnssCheckMeasurements',measurement)]}});
  assert.equal(experiment(f('observed','observed'),'gnss').state,'passed');
  assert.equal(experiment(f('observed','not_seen'),'gnss').state,'incomplete');
  assert.equal(experiment({report:{fieldSetVersion:13,parameters:[]}},'gnss').state,'not_recorded');
});

test('generic quality note keeps Wi-Fi frequency value intact',()=>{
  const f={...row('wifiFrequency','-1 MHz'),group:'network'};
  assert.equal(otherFieldQuality(f).code,'WIFI_FREQ_REVIEW');
  assert.equal(f.value,'-1 MHz');
  assert.equal(otherFieldQuality({...f,value:'5220 MHz'}),null);
});
