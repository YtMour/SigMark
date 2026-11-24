import type {Parameter} from './compare.ts';

function one(fields:Parameter[],group:string,key:string) {
  const matches=fields.filter(field=>field.group===group&&field.key===key);
  return matches.length===1?matches[0]:undefined;
}

export function energyFromArchive(fields:Parameter[]) {
  const counter=one(fields,'battery','energyCounter');
  if(!counter||counter.status==='AVAILABLE')return null;
  const charge=one(fields,'battery','chargeCounter'), voltage=one(fields,'battery','voltage');
  if(!charge||!voltage||charge.status!=='AVAILABLE'||voltage.status!=='AVAILABLE'||
    charge.source!=='BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER'||voltage.source!=='BatteryManager.EXTRA_VOLTAGE')return null;
  const am=/^(\d{1,5}(?:\.\d)?) mAh$/.exec(charge.value??''), vm=/^(\d{4,5}) mV$/.exec(voltage.value??'');
  if(!am||!vm)return null;
  const mAh=Number(am[1]), mV=Number(vm[1]);
  if(mAh<=0||mAh>30000||mV<1000||mV>15000)return null;
  return {rule:'BATTERY_ENERGY_ESTIMATE/1',wh:(mAh*mV/1e6).toFixed(2),counter,charge,voltage};
}

export type PublishedBuild={version:string;versionCode:number;signerSha256?:string};

export function newerMatchingBuild(fields:Parameter[],build:PublishedBuild|undefined) {
  if(!build||!Number.isSafeInteger(build.versionCode)||build.versionCode>2100000000||
    !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(build.version)||!/^[0-9a-f]{64}$/i.test(build.signerSha256??''))return null;
  const channel=one(fields,'app','channel'), version=one(fields,'app','version'), signer=one(fields,'app','certSha256');
  if(channel?.status!=='AVAILABLE'||channel.value!=='lan-debug'||version?.status!=='AVAILABLE'||
    signer?.status!=='AVAILABLE'||signer.value?.toLowerCase()!==build.signerSha256?.toLowerCase())return null;
  const observed=/^(\d{1,3}\.\d{1,3}\.\d{1,3}) \(([1-9]\d{0,9})\)$/.exec(version.value??'');
  if(!observed||Number(observed[2])>=build.versionCode)return null;
  return {observed:version.value,published:build.version+' ('+build.versionCode+')'};
}
