import type {Report} from './reports';
import {parameterKey} from './compare.ts';

export function acceptance(row: Report) {
  const archive = new Map((row.report.parameters??[]).map(p=>[parameterKey(p),p]));
  const read = (key:string) => {
    const p=archive.get(key);
    return {key,status:p?.status??'NOT_ARCHIVED',value:p?.status==='AVAILABLE'?p.value:null,
      source:p?.source??null,reason:p?.reason??null};
  };
  return {
    plan:read('environment.capturePlan'),
    phone:read('environment.capturePhoneAccess'),
    location:read('environment.captureLocationAccess'),
    locationSwitch:read('environment.captureLocationSwitch'),
    fixture:read('media.avcFixture'),
    output:read('media.avcFirstFrame'),
    stage:read('media.avcStage'),
    decoder:read('media.avcDecoder'),
    elapsed:read('media.avcElapsed'),
  };
}

export function acceptanceComparison(before:Report,after:Report,sameAsset:boolean) {
  const baseline=acceptance(before),current=acceptance(after);
  function compare(key:'phone'|'location'|'locationSwitch') {
    const a=baseline[key].value,b=current[key].value;
    return a===null||b===null?'insufficient':a===b?'matched':'changed';
  }
  const context={phone:compare('phone'),location:compare('location'),locationSwitch:compare('locationSwitch')};
  const old=baseline.output.value,now=current.output.value;
  const timeOrder=before.report.capturedAtEpochMs<after.report.capturedAtEpochMs;
  const known=(value:string|null)=>value==='pass'||value==='fail';
  const media: 'cross_asset'|'invalid_order'|'insufficient'|'different_fixture'|'both_pass'|'both_fail'|'recovered'|'regression'
    =!sameAsset?'cross_asset':!timeOrder?'invalid_order':
    (!baseline.fixture.value||!current.fixture.value||!known(old)||!known(now))?'insufficient':
    baseline.fixture.value!==current.fixture.value?'different_fixture':
    old===now?(now==='pass'?'both_pass':'both_fail'):now==='pass'?'recovered':'regression';
  return {baseline,current,context,media};
}
