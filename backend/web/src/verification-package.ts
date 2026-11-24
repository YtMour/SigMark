import type {Report} from './reports';
import type {Parameter} from './compare';
import {buildLab,type LabSheet} from './lab-model.ts';
import {acceptance} from './acceptance.ts';
import {assessRisk,registeredUnlock} from './risk-assessment.ts';
import {compareSecurity,type ReleaseReference} from './security-rules.ts';
import {regressionResult} from './regression.ts';
import {gnssAudit,otherFieldQuality,qualityVersion} from './field-quality.ts';

export type Objective='overview'|'rom'|'network'|'usb'|'gnss';
export type FieldSpec={key:string;minSchemaVersion:number;sinceFieldSet?:number;unit?:string;minApi?:number;plan?:string;requires?:string[];
  wireType?:string;valueKind?:string;temporal?:'configuration'|'snapshot'|'experiment';scope?:string;sensitivity?:string};
export type FieldCatalog={schemaVersion:1;dictionaryVersion?:string;latestFieldSet:number;items:FieldSpec[];
  dynamic?:{pattern:string;minSchemaVersion:number;sinceFieldSet:number}};
export const objectives:Record<Objective,string>={overview:'综合核对',rom:'ROM 回归',network:'Wi-Fi → 蜂窝',usb:'USB 插拔',gnss:'GNSS 读数核对'};
export const objectiveOf=(value:string|null):Objective=>value==='rom'||value==='network'||value==='usb'||value==='gnss'?value:'overview';
const keyOf=(p:Parameter)=>p.group+'.'+p.key;
const stableGroups=['system','cpu','memory','display','battery','sensors','network','cellular','runtime','media','environment','app'];
const describe=(row:Report)=>({
  reportId:row.id,batch:row.batch,captureAt:row.report.capturedAtEpochMs??null,receivedAt:row.receivedAt,
  appVersion:row.report.appVersion,collectorVersion:row.report.collectorVersion??null,
  schemaVersion:row.report.schemaVersion,fieldSetVersion:row.report.fieldSetVersion??null,
  androidApi:row.report.androidApi||null,model:row.report.model,
});
const archive=(row:Report|undefined)=>new Map((row?.report.parameters??[]).map(p=>[keyOf(p),p]));
function reading(p:Parameter|undefined){
  return p?{status:p.status,value:p.value,source:p.source,reason:p.reason??null,errno:p.errno??null}:null;
}

type ExperimentState='passed'|'failed'|'incomplete'|'not_recorded'|'not_run';
export const experimentLabels:Record<ExperimentState,string>={passed:'达到判定条件',failed:'未达到判定条件',incomplete:'证据未齐',
  not_recorded:'历史未保存',not_run:'未运行此实验'};
const probes = {
  avc:{title:'AVC 首帧',plan:'rom',since:9,
    keys:['media.avcFixture','media.avcFirstFrame','media.avcStage','media.avcDecoder','media.avcElapsed','media.avcStartAt','media.avcEndAt'],
    steps:['在手机选择「ROM 验收」','解码内置 H.264 样片，记录首个非配置帧及阶段','手动上传报告']},
  gles:{title:'GLES 离屏回读',plan:'rom',since:12,
    keys:['runtime.glesProbeResult','runtime.glesProbeVersion','runtime.glesProbeStage','runtime.glesStartAt','runtime.glesEndAt'],
    steps:['在手机选择「ROM 验收」','对 1×1 离屏表面清色并回读','手动上传报告']},
  route:{title:'Wi-Fi → 蜂窝',plan:'network',since:10,
    keys:['network.checkStartTransport','network.checkEndTransport','network.checkStartValidated','network.checkEndValidated','network.checkElapsed',
      'network.checkStartAt','network.checkEndAt'],
    steps:['保持 Wi-Fi 为默认链路，进入「网络切换实验」并记录起点','手动切到蜂窝、回到印迹记录终点',
      '需要时恢复到可达后台的 Wi-Fi，再手动上传本次采样']},
  usb:{title:'USB 插拔实验',plan:'usb',since:13,
    keys:['runtime.usbStartCount','runtime.usbEndCount','runtime.usbOutcome','runtime.usbElapsed','runtime.usbStartAt','runtime.usbEndAt'],
    steps:['准备 USB Host、OTG 与外设。在手机打开「更多工具 → USB 插拔实验」','记录起点；手动插入或拔出一个设备',
      '两分钟内保存终点，确认后手动上传报告']},
  gnss:{title:'GNSS 读数核对',plan:'gnss',since:14,
    keys:['system.gnssCheckPrerequisite','system.gnssCheckStatus','system.gnssCheckMeasurements',
      'system.gnssCheckStartAt','system.gnssCheckEndAt','system.gnssCheckElapsed'],
    steps:['在手机打开「更多工具 → GNSS 读数核对」，授予精确位置并打开系统位置',
      '在开阔处保持前台，观察不超过约 20 秒，再保存本机报告','选「上传报告」手动归档，不上传原始测量和坐标']},
} as const;
const times={avc:['media.avcStartAt','media.avcEndAt'],gles:['runtime.glesStartAt','runtime.glesEndAt'],
  route:['network.checkStartAt','network.checkEndAt'],usb:['runtime.usbStartAt','runtime.usbEndAt'],
  gnss:['system.gnssCheckStartAt','system.gnssCheckEndAt']} as const;

export function experiment(row:Report, id:keyof typeof probes){
  const config=probes[id], map=archive(row), found=config.keys.some(k=>map.has(k));
  const read=(key:string)=>{const p=map.get(key);return p?.status==='AVAILABLE'?p.value:null;};
  const plan = acceptance(row).plan.value;
  let state:ExperimentState = !found?((row.report.fieldSetVersion??0)<config.since||!plan||plan===config.plan?'not_recorded':'not_run'):'incomplete';
  const validation=id==='route'?read('network.checkEndValidated'):null;
  const stamp=(key:string)=>{const value=read(key);return value&&/^\d{12,13}$/.test(value)?Number(value):null;};
  if(found){
    if(id==='route'){
      const start=read('network.checkStartTransport'),end=read('network.checkEndTransport');
      if(start&&end){
        if(start!=='wifi'||end!=='cellular'||validation==='no')state='failed';
        else if(validation==='yes')state='passed';
      }
    }else if(id==='usb'){
      const outcome=read('runtime.usbOutcome');
      const first=read('runtime.usbStartCount'),last=read('runtime.usbEndCount');
      if(first!==null&&last!==null&&read('runtime.usbElapsed')){
        if((outcome==='increase'&&Number(last)>Number(first))||(outcome==='decrease'&&Number(last)<Number(first)))state='passed';
        else if(outcome==='no_change'&&last===first)state='failed';
      }
    }else if(id==='gnss'){
      if(read('system.gnssCheckPrerequisite')==='ready'&&read('system.gnssCheckStatus')==='observed'&&
        read('system.gnssCheckMeasurements')==='observed')state='passed';
    }else{
      const result=read(id==='avc'?'media.avcFirstFrame':'runtime.glesProbeResult');
      if(id==='avc'?read('media.avcFixture')&&['pass','fail'].includes(result??''):
        (result==='pass'&&read('runtime.glesProbeStage')==='done')||result==='fail')state=result==='pass'?'passed':'failed';
    }
  }
  return {id,title:config.title,plan:config.plan,steps:config.steps,fieldSetSince:config.since,state,runsInReport:found?1:0,
    // Never infer missing endpoint times from sample/header time or duration.
    timing:{startEpochMs:stamp(times[id][0]),endEpochMs:stamp(times[id][1]),
      duration:id==='route'?read('network.checkElapsed'):id==='avc'?read('media.avcElapsed'):id==='usb'?read('runtime.usbElapsed'):id==='gnss'?read('system.gnssCheckElapsed'):null,
      waitLimitMs:!found?null:id==='gles'?1800:id==='route'?600000:id==='usb'?120000:id==='gnss'?20000:null},validation,
    evidence:config.keys.map(key=>({key,reading:reading(map.get(key))}))};
}

type Probe = ReturnType<typeof experiment>;
export type ProbeComparison = 'no_baseline'|'not_comparable'|'different_fixture'|'different_conditions'|
  'regression'|'recovered'|'both_pass'|'both_fail'|'observations_only';

export const probeComparisonLabels:Record<ProbeComparison,string>={
  no_baseline:'未选同机基线',not_comparable:'两次实验的可比证据不足',different_fixture:'测试样片不同，只能分别查看',
  different_conditions:'实验条件不同，只能对照读数',regression:'由通过变为未达到，建议在相同条件下复测',
  recovered:'由未达到变为通过',both_pass:'两次均达到判定条件',both_fail:'两次均未达到判定条件',
  observations_only:'只对照观察，不判定 ROM 回归',
};

export function compareProbe(before:Probe|null,after:Probe,beforeRow:Report|undefined,afterRow:Report):ProbeComparison{
  if(!before||!beforeRow)return 'no_baseline';
  if(!beforeRow.assetId||beforeRow.assetId!==afterRow.assetId||beforeRow.trashedAt||afterRow.trashedAt||
    !(beforeRow.report.capturedAtEpochMs>0&&beforeRow.report.capturedAtEpochMs<afterRow.report.capturedAtEpochMs)||before.id!==after.id)
    return 'not_comparable';
  const recorded=(probe:Probe,key:string)=>probe.evidence.find(r=>r.key===key&&r.reading?.status==='AVAILABLE')?.reading?.value;
  if(!['passed','failed'].includes(before.state)||!['passed','failed'].includes(after.state))return 'not_comparable';
  if(after.id==='usb'||after.id==='route'||after.id==='gnss')return 'observations_only';
  const fromPlan=acceptance(beforeRow).plan.value,toPlan=acceptance(afterRow).plan.value;
  if(fromPlan!=='rom'||toPlan!=='rom')return 'different_conditions';
  if(after.id==='avc'){
    if(recorded(before,'media.avcFixture')!==recorded(after,'media.avcFixture'))return 'different_fixture';
  }else{
    // Fields sets 12 through 17 use the same 1×1 test.
    if(![12,13,14,15,16,17].includes(beforeRow.report.fieldSetVersion??0)||![12,13,14,15,16,17].includes(afterRow.report.fieldSetVersion??0))
      return 'not_comparable';
    const a=recorded(before,'runtime.glesProbeVersion'),b=recorded(after,'runtime.glesProbeVersion');
    if(a&&b&&a!==b)return 'different_conditions';
  }
  if(before.state===after.state)return after.state==='passed'?'both_pass':'both_fail';
  return after.state==='passed'?'recovered':'regression';
}

export function buildVerification(sheet:LabSheet, rawId:string, savedId:string, objective:Objective,
  catalog:FieldCatalog|undefined, signer:ReleaseReference|undefined){
  const current=sheet.current;
  const candidate=sheet.registeredBaselines?.find(x=>x.id===savedId&&x.state==='ready'&&x.reportId===sheet.registeredReport?.id);
  const chosen=savedId?(candidate?sheet.registeredReport:undefined):sheet.history.find(x=>x.id===rawId);
  const eligible=chosen&&!!current.assetId&&chosen.assetId===current.assetId&&!chosen.trashedAt&&
    chosen.report.capturedAtEpochMs>0&&chosen.report.capturedAtEpochMs<current.report.capturedAtEpochMs;
  const baseline=eligible?chosen:undefined;
  const registered=eligible?candidate:undefined;
  const expect=registeredUnlock(current,baseline,registered);
  const risk=assessRisk(current,signer,expect);
  const required=risk.rules.filter(r=>r.required);
  const known=required.filter(r=>!['unknown','context'].includes(r.state)).length;
  const severity={red:'critical',yellow:'review',blue:'none_observed',gray:'unrated'} as const;
  const lab=buildLab({...sheet,history:baseline?[baseline]:[]},baseline);
  const specs=new Map((catalog?.items??[]).map(f=>[f.key,f]));
  const changes=baseline?regressionResult(baseline,current,
    compareSecurity(baseline.report.parameters??[],current.report.parameters??[],!!expect),
    {sameAsset:true,expectUnlock:!!expect,baseline:registered,expectedNetwork:registered?.expectedNetwork}):null;
  const fields=lab.rows.map(row=>{
    const spec=specs.get(row.key)??(catalog?.dynamic&&/^system\.partition_[a-z0-9_]{1,32}$/.test(row.key)?
      {key:row.key,minSchemaVersion:catalog.dynamic.minSchemaVersion,sinceFieldSet:catalog.dynamic.sinceFieldSet,temporal:'configuration' as const}:undefined);
    const absent=row.before?current:baseline;
    const newlyIntroduced=!!baseline&&row.delta==='not_comparable'&&spec&&absent&&
      (absent.report.schemaVersion<spec.minSchemaVersion||
        (!!spec.sinceFieldSet&&(absent.report.fieldSetVersion??0)<spec.sinceFieldSet));
    const temporal=spec?.temporal??(row.dynamic?'snapshot':'configuration');
    const comparison=!baseline?'no_baseline':newlyIntroduced?'field_set_gap':row.delta==='not_comparable'?'one_side_missing':
      temporal!=='configuration'&&row.delta!=='unchanged'?'context_or_experiment':row.delta;
    return {key:row.key,group:row.group,temporal,comparison,delta:row.delta,spec:spec??null,
      baseline:reading(row.before),current:reading(row.after)};
  });
  const coverage=stableGroups.map(group=>{
    const rows=fields.filter(f=>f.group===group&&f.current).map(v=>v.current!);
    const count=(status:string)=>rows.filter(p=>p.status===status).length;
    return {group,archived:rows.length,available:count('AVAILABLE'),restricted:count('RESTRICTED'),unavailable:count('UNAVAILABLE'),errors:count('ERROR')};
  });
  const ids = objective==='rom'?['avc','gles'] as const:objective==='network'?['route'] as const:objective==='usb'?['usb'] as const:
    objective==='gnss'?['gnss'] as const:['avc','gles','route','usb','gnss'] as const;
  const window=[...new Map([current,...sheet.history,...(baseline?[baseline]:[])]
    .filter(p=>p.id===current.id||!!current.assetId&&p.assetId===current.assetId&&!p.trashedAt&&
      p.report.capturedAtEpochMs<current.report.capturedAtEpochMs).map(p=>[p.id,p])).values()];
  const raw=current.report.parameters??[];
  const quality={
    ruleVersion:qualityVersion,
    gnss:raw.some(p=>p.group==='system'&&p.key.startsWith('gnss'))?gnssAudit(raw,current.report.capturedAtEpochMs):[],
    other:raw.flatMap(p=>{const note=otherFieldQuality(p);return note?[{...note,keys:[keyOf(p)]}]:[];}),
  };
  return {
    schemaVersion:1,kind:'sigmark.verification-package',ruleVersion:'sigmark-verification/4',objective,
    catalogVersion:catalog?.dictionaryVersion??null,source:{current:describe(current),baseline:baseline?describe(baseline):null},
    policy:registered??null,baselineUnavailable:!!(savedId||rawId)&&!baseline,
    scope:baseline?'same_asset_comparison':current.assetId?'linked_single':'unlinked_single',
    conditions:{current:acceptance(current),baseline:baseline?acceptance(baseline):null,network:current.report.network},
    coverage,experiments:ids.map(id=>{
      const runs=window.map(p=>experiment(p,id)).filter(e=>e.runsInReport===1);
      const currentProbe=experiment(current,id),baselineProbe=baseline?experiment(baseline,id):null;
      return {current:currentProbe,baseline:baselineProbe,comparison:compareProbe(baselineProbe,currentProbe,baseline,current),
        observedRuns:{total:runs.length,passed:runs.filter(r=>r.state==='passed').length,
          failed:runs.filter(r=>r.state==='failed').length,incomplete:runs.filter(r=>r.state==='incomplete').length,
          historyLimited:sheet.hasEarlier}};
    }),
    regression:changes,risk,quality,
    strength:{observer:'APP_ARCHIVE',independentVerification:'not_performed',knownChecks:known,totalChecks:required.length,
      severity:severity[risk.level]},
    fields,
  };
}
