import {bootEvidence,bootKeys,evaluateSecurity,type ReleaseReference} from './security-rules.ts';
import type {Report} from './reports';
import {architectureEvidence,architectureKeys} from './architecture-evidence.ts';

export const riskVersion='sigmark-observation-risk/5';
export type RiskLevel='red'|'yellow'|'gray'|'blue';
type RuleState='critical'|'review'|'unknown'|'observed'|'expected'|'context';
type Rule={code:string;title:string;state:RuleState;finding:string;next:string;fields:string[];required?:boolean};
type BaselineReference={id:string;name:string;reportId:string;expectUnlock?:boolean;state:string};

export function registeredUnlock(current:Report,reference:Report|undefined,saved:BaselineReference|undefined,override?:boolean) {
  if(!saved||saved.state!=='ready'||!saved.expectUnlock||override===false||!reference||
     reference.id!==saved.reportId||reference.trashedAt||current.trashedAt||
     !current.assetId||current.assetId!==reference.assetId||
     !(reference.report.capturedAtEpochMs<current.report.capturedAtEpochMs)) return null;
  return {id:saved.id,name:saved.name,reportId:saved.reportId};
}

export function assessRisk(row:Report, reference?:ReleaseReference, expectedUnlock:ReturnType<typeof registeredUnlock>=null) {
  const input=row.report;
  const archive=new Map((input.parameters??[]).map(p=>[p.group+'.'+p.key,p]));
  const read=(key:string)=>{const p=archive.get(key);return p?.status==='AVAILABLE'?p.value?.trim():undefined;};
  const checks=new Map(evaluateSecurity(input,reference).map(check=>[check.id,check]));
  const rules:Rule[]=[];
  const add=(code:string,title:string,state:RuleState,finding:string,next:string,fields:string[],required=false)=>
    rules.push({code,title,state,finding,next,fields,required});
  const boot=bootEvidence(...bootKeys.map(read));
  const bootState:RuleState=boot==='red'?'critical':boot==='conflict'?'review':
    boot==='unlocked'?(expectedUnlock?'expected':'review'):
    boot==='locked'?'observed':boot==='custom'?'context':'unknown';
  add('BOOT_STATE','启动链与锁定',bootState,bootState==='expected'?
    '较早的同资产基线已登记预期解锁。本次解锁与该预期一致。':checks.get('boot')!.finding,
    boot==='red'||boot==='conflict'?'优先从独立来源复核启动状态；先不要将该样本设为可信基线。':
    bootState==='expected'?'保留实验基线和预期，继续检查其他保护项。':'核对当前 ROM、Bootloader 状态和所选基线。',bootKeys,true);
  const selinux=checks.get('selinux')!;
  add('SELINUX_MODE','SELinux 实时模式',selinux.state,selinux.finding,
    '检查该字段的读取状态。重新采集后仍受限时，保留未确认。', selinux.fields, true);
  const lock=read('environment.keyguardSecure');
  add('LOCKSCREEN','锁屏凭证',lock==='是'?'observed':lock==='否'?'review':'unknown',
    lock==='是'?'系统报告当前用户已设锁屏凭证。':lock==='否'?'当前用户未配置安全锁屏。':'尚未确认锁屏凭证状态。',
    '核对当前用户的锁屏配置。',['environment.keyguardSecure'],true);
  const enc=read('environment.storageEncryption');
  const on=['已启用','已启用（默认密钥）','已启用（按用户加密）'].includes(enc??'');
  add('STORAGE_ENCRYPTION','存储加密',on?'observed':enc==='系统报告未启用'?'review':'unknown',
    on?'系统报告存储加密已启用。':enc==='系统报告未启用'?'系统报告存储加密未启用。':'尚未确认存储加密状态。',
    '核对系统存储保护与实验镜像配置。',['environment.storageEncryption'],true);
  const patch=checks.get('patch')!;
  add('PATCH_AGE','系统补丁时效',patch.state,patch.finding,'核对系统更新和采样时间。',patch.fields,true);
  const keyProbe=archive.get('environment.keyProtection');
  if(keyProbe?.status==='ERROR'){
    add('KEYSTORE_TEST','密钥自测','review','本次临时密钥自测未完成。',
      '在手机端重试密钥自测。',['environment.keyProtection']);
  }
  const debug=read('app.debuggerConnected');
  add('PROCESS_DEBUGGER','采集进程调试',debug==='是'?'review':debug==='否'?'observed':'unknown',
    debug==='是'?'采样时印迹进程连接调试器。':debug==='否'?'采样时印迹进程未连接调试器。':'缺少可用的进程调试器读数。',
    '先核对是否为预期联调；调试状态不是入侵证据。',['app.debuggerConnected']);
  const identity=checks.get('identity')!;
  add('IDENTITY_DECLARATION','报告声明一致性',identity.state,identity.finding,'核对采集器版本、报告投影和 ROM 声明。',identity.fields);
  const appIdentity=checks.get('identity_fields')!;
  add('APP_IDENTITY_CONSISTENCY',appIdentity.title,appIdentity.state,appIdentity.finding,
    '在同一测试条件下用 App 复采；读数一致不等于设备身份已验证。',appIdentity.fields);
  const architecture=architectureEvidence(read(architectureKeys[0]),read(architectureKeys[1]),read(architectureKeys[2]));
  add('RUNTIME_ARCHITECTURE','运行架构一致性',architecture==='conflict'?'review':architecture==='compatible'?'observed':'unknown',
    architecture==='conflict'?'64 位进程与至少一项 32 位声明有冲突。此信号仅用于复核，不等于模拟器。':
    architecture==='compatible'?'进程位宽、公开 ABI 与可见内核架构读数兼容；不证明是实体手机。':'归档缺少足够的可比较读数，或读数不在已知 ABI 范围。',
    '用同一设备同一 ROM 重采并核对证据；正常的兼容模式不计异常。',[...architectureKeys]);
  const signer=checks.get('signer');
  add('APP_SIGNER','对应发布签名',signer?.state??'unknown',signer?.finding??'该报告未保存新版发布签名证据。',
    '核对同渠道、同版本的发布记录；匹配摘要不证明报文真实性。',signer?.fields??['app.package','app.channel','app.version','app.certSha256']);
  const virtualKeys=['cpu.hardware','system.product','system.device'];
  const markers=virtualKeys.map(key=>read(key)?.toLowerCase());
  const found=markers.some(v=>v&&(['ranchu','goldfish','vbox86','emulator'].includes(v)||v.startsWith('sdk_gphone')));
  add('VIRTUAL_DECLARATION','虚拟环境声明',found?'context':markers.every(v=>v&&v!=='unknown')?'observed':'unknown',
    found?'发现已知虚拟构建声明；不等于设备遭修改或用于滥用。':
    markers.every(v=>v&&v!=='unknown')?'未见已知标记；不证明是实体手机。':'缺少可用的虚拟环境声明。',
    '结合人工登记的测试环境复核；不依据 ABI、SIM 或传感器数量判真假。',virtualKeys);
  const level:RiskLevel=rules.some(rule=>rule.state==='critical')?'red':rules.some(rule=>rule.state==='review')?'yellow':
    rules.some(rule=>rule.required&&!['observed','expected'].includes(rule.state))?'gray':'blue';
  const triggered=rules.filter(rule=>rule.state==='critical'||rule.state==='review'||
    (level==='gray'&&rule.required&&!['observed','expected'].includes(rule.state)));
  return {
    kind:'sigmark.observation-risk',schemaVersion:1,ruleVersion:riskVersion,reportId:row.id,
    capturedAtEpochMs:input.capturedAtEpochMs,observer:'APP_ARCHIVE',attestation:'not_verified',abuseAssessment:'not_evaluated',
    policy:expectedUnlock?{kind:'registered_experiment',baseline:expectedUnlock}:{kind:'standard',baseline:null},
    signerReference:reference??null,level,triggered:triggered.map(rule=>rule.code),
    rules:rules.map(({fields,...rule})=>({...rule,evidence:fields.map(key=>{
      const p=archive.get(key);
      return {key,value:p?.value??null,status:p?.status??'NOT_ARCHIVED',source:p?.source??null,reason:p?.reason??null,errno:p?.errno??null};
    })})),
  };
}
