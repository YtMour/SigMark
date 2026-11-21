import type {Parameter} from './compare';

export type Evidence = Parameter;
type State = 'observed'|'review'|'unknown'|'context';
type Check = {id:string;title:string;state:State;finding:string;fields:string[]};

const patchDate=(value:string|undefined)=>{
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:NaN;
};

export const ruleVersion='rom-evidence/2';
export const bootKeys=['environment.verifiedBoot','environment.vbmetaState','environment.flashLock'];
export function bootEvidence(color?:string|null,vbmeta?:string|null,flash?:string|null){
  const [boot,v,f]=[color,vbmeta,flash].map(x=>x?.trim().toLowerCase());
  const locked=v==='locked'||f==='1',unlocked=v==='unlocked'||f==='0';
  if(boot==='red')return 'red';
  if((locked&&unlocked)||((boot==='green'||boot==='yellow')&&unlocked)||(boot==='orange'&&locked))return 'conflict';
  if(boot==='orange'||unlocked)return 'unlocked';
  if(boot==='yellow')return 'custom';
  if(boot==='green'&&locked)return 'locked';
  return 'unknown';
}
const bootChecks={
  conflict:['review','启动颜色或锁定来源互相矛盾。请展开来源并核对 ROM 配置。'],
  red:['review','系统报告红色启动线索，请核对启动链。'],
  unlocked:['review','系统报告解锁线索；对照同设备实验基线确认是否预期。'],
  custom:['context','系统报告自定义信任根；不是硬件证明。'],
  locked:['observed','绿色启动与锁定声明一致；不是硬件证明。'],
  unknown:['unknown','启动或锁定证据不足。'],
} as const;
export type ReleaseReference = {state:'unregistered'|'registered'|'loading'|'error';signerSha256?:string};
export function releaseQuery(appVersion:string,fields:Evidence[]){
  const read=(k:string)=>fields.find(f=>f.group==='app'&&f.key===k&&f.status==='AVAILABLE')?.value;
  const match=/^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}) \(([1-9][0-9]{0,9})\)$/.exec(read('version')??'');
  const pkg=read('package'),channel=read('channel');
  if(!match||match[1]!==appVersion||Number(match[2])>2147483647||!pkg||!channel||!read('certSha256'))return '';
  return new URLSearchParams({version:appVersion,code:match[2],package:pkg,channel}).toString();
}
export function evaluateSecurity(input:{parameters?:Evidence[];androidApi:number;model:string;capturedAtEpochMs?:number;fieldSetVersion?:number|null},reference?:ReleaseReference):Check[] {
  const values = new Map((input.parameters??[]).map(p=>[p.group+'.'+p.key,p]));
  const read=(key:string)=>{const p=values.get(key);return p?.status==='AVAILABLE'?p.value?.trim():undefined;};
  const [state,finding]=bootChecks[bootEvidence(...bootKeys.map(read))];
  const checks:Check[]=[{id:'boot',title:'启动链与锁定状态',fields:bootKeys,state,finding}];
  const selinux=read('system.selinux');
  const enforcing=selinux==='Enforcing（强制模式）'||selinux==='Enforcing',permissive=selinux==='Permissive（宽容模式）'||selinux==='Permissive';
  checks.push({id:'selinux',title:'SELinux 实时模式',fields:['system.selinux','environment.selinuxDomain'],
    state:enforcing?'observed':permissive?'review':'unknown',
    finding:enforcing?'报告读取到强制模式。':permissive?'报告读取到宽容模式；并非 SELinux 已关闭。':'实时模式未确认。受限节点或应用进程域不能代替实时模式。'});
  const patch=read('system.patch');
  const parsed=patchDate(patch);
  const age=Math.floor(((input.capturedAtEpochMs??NaN)-parsed)/86400000);
  checks.push({id:'patch',title:'安全补丁时效',fields:['system.patch'],
    state:!Number.isFinite(age)?'unknown':age>180||age<0?'review':'observed',
    finding:!Number.isFinite(age)?'未取得有效补丁日期或采样时间。':age<0?'补丁日期晚于采样时间，请核对设备时钟与 ROM。':
      `采样时距声明补丁日 ${age} 天。${age>180?'超过 180 天的实验复核阈值。':'该日期不证明补丁实际覆盖。'}`});
  const lock=read('environment.keyguardSecure'),encryption=read('environment.storageEncryption');
  const encryptionOn=!!encryption&&['已启用','已启用（默认密钥）','已启用（按用户加密）'].includes(encryption);
  checks.push({id:'protection',title:'锁屏与存储保护',fields:['environment.keyguardSecure','environment.storageEncryption'],
    state:lock==='否'||encryption==='系统报告未启用'?'review':lock==='是'&&encryptionOn?'observed':'unknown',
    finding:lock==='否'||encryption==='系统报告未启用'?'系统报告未配置锁屏凭证或存储加密未启用，建议核对测试条件。':
      lock==='是'&&encryptionOn?'系统报告已配置锁屏凭证，且已启用加密。':'部分保护状态未归档、未返回或未确认。'});
  const type=read('system.type'),debug=read('app.debuggerConnected'),appDebug=read('app.appDebuggable');
  checks.push({id:'debug',title:'构建与运行时',fields:['system.type','environment.buildSignals','app.appDebuggable','app.debuggerConnected'],
    state:debug==='是'?'review':type||debug||appDebug?'context':'unknown',
    finding:debug==='是'?'报告记录采样时当前进程连接了调试器。':
      type||debug||appDebug?'调试构建和可调试测试包是环境线索，不能据此判断 Root 或真伪。':'该报告缺少可用的调试环境线索。'});
  const model=read('system.model'),api=read('system.api');
  const comparable=!!model||!!(api&&input.androidApi>0);
  const conflict=(model!=null&&model!==input.model&&input.model!=='unknown')||(!!api&&input.androidApi>0&&/^\d+$/.test(api)&&Number(api)!==input.androidApi);
  checks.push({id:'identity',title:'配置声明一致性',fields:['system.model','system.api','system.brand','system.device'],
    state:conflict?'review':comparable?'context':'unknown',
    finding:conflict?'报告头与归档字段的型号或 API 不一致。先核对报告投影或 ROM 声明。':
      comparable?'报告头和字段来自同一 App 视角；未见可比项冲突也不是独立身份证据。':'型号或 API 的归档明细不足。'});
  if((input.fieldSetVersion??0)>=7){
    const parts=[...values.keys()].filter(k=>k.startsWith('system.partition_')).sort();
    const key=read('environment.keyProtection'),cert=read('app.certSha256')?.toLowerCase();
    const expected=reference?.state==='registered'?reference.signerSha256:undefined;
    const validCert=!!cert&&/^[a-f0-9]{64}( [a-f0-9]{64})*$/.test(cert);
    checks.push({id:'partitions',title:'ROM 分区构建',fields:['system.partitionCount',...parts],
      state:parts.some(k=>read(k))?'context':'unknown',finding:'公开分区 '+(read('system.partitionCount')??'未报告')+' 个；用基线查看具体分区是否变化，沿用旧分区不是异常。'},
      {id:'components',title:'组件更新基线',fields:['system.webViewProvider','system.webViewVersion','system.webViewCode',...(input.androidApi>=35?['system.systemSpl','system.vendorSpl']:[])],
      state:read('system.webViewProvider')||read('system.vendorSpl')?'context':'unknown',
      finding:'WebView：'+(read('system.webViewVersion')??'未报告')+'。'+(input.androidApi<35?'该系统未达到组件补丁接口 API 35。':'组件日期是系统声明，不证明漏洞已修复。')},
      {id:'keystore',title:'本次临时密钥',fields:['environment.keyProtection'],state:key?'observed':'unknown',
      finding:key?'Android 对测试密钥报告：'+key+'。不是远程硬件证明。':values.has('environment.keyProtection')?'测试未取得读数，请查看采集说明。':'未运行手动自测；可在手机「指纹安全」运行后重新上传。'},
      {id:'signer',title:'采集器发布签名',fields:['app.package','app.channel','app.version','app.certSha256'],
      state:expected&&validCert?(expected===cert?'observed':'review'):'unknown',
      finding:expected&&validCert?(expected===cert?'匹配对应渠道与版本的发布证书。':'报告签名与对应发布证书不匹配，请核对安装包来源。'):
        reference?.state==='loading'?'正在读取对应发布记录…':reference?.state==='error'?'发布记录读取失败，请稍后重新打开。':reference?.state==='unregistered'?'该包名、渠道与版本无已知发布记录。':'报告中的签名或版本证据不足。'});
  }
  return checks;
}

const comparedFields=[
  ['environment.verifiedBoot','Verified Boot'],['environment.vbmetaState','VBMeta 锁定'],['environment.flashLock','Bootloader 锁定'],
  ['system.selinux','SELinux 实时模式'],['system.patch','安全补丁日期'],['app.debuggerConnected','调试器连接'],
  ['environment.keyguardSecure','锁屏凭证'],['environment.storageEncryption','存储加密'],
] as const;
type Verdict='unchanged'|'changed'|'review'|'expected'|'insufficient';
export function compareSecurity(before:Evidence[],after:Evidence[],expectUnlock=false){
  const index=(rows:Evidence[])=>new Map(rows.map(row=>[row.group+'.'+row.key,row]));
  const left=index(before),right=index(after);
  const value=(row:Evidence|undefined)=>row?.status==='AVAILABLE'?row.value?.trim():undefined;
  const currentBoot=bootEvidence(...bootKeys.map(key=>value(right.get(key))));
  const conflicts=currentBoot==='red'||currentBoot==='conflict';
  const extra:[string,string][]=[
    ['system.webViewProvider','WebView 提供程序'],['system.webViewVersion','WebView 版本'],['system.webViewCode','WebView 内部版本号'],
    ['system.systemSpl','系统组件补丁'],['system.vendorSpl','厂商组件补丁'],['environment.keyProtection','临时密钥保护'],
    ['app.certSha256','采集器签名摘要'],
    ...[...new Set([...left.keys(),...right.keys()])].filter(k=>k.startsWith('system.partition_')).sort().map((k):[string,string]=>[k,k.slice(17)+' 分区构建']),
  ];
  return [...comparedFields,...extra.filter(([k])=>left.has(k)||right.has(k))].map(([key,title])=>{
    const baseline=left.get(key),current=right.get(key);
    const a=value(baseline),b=value(current);
    let verdict:Verdict='unchanged',note='两次读数一致。';
    const signal=key.split('.')[1];
    if(!a||!b||(['system.patch','system.systemSpl','system.vendorSpl'].includes(key)&&(!Number.isFinite(patchDate(a))||!Number.isFinite(patchDate(b))))){
      verdict='insufficient';note='至少一侧无有效读数，不判定安全变化。';
    }else if(a!==b){
      verdict='changed';note='读数变化，请结合设备、ROM 和测试条件。';
      const unlocked=(signal==='verifiedBoot'&&b==='orange')||(signal==='vbmetaState'&&b==='unlocked')||(signal==='flashLock'&&b==='0');
      if(unlocked){verdict=expectUnlock&&!conflicts?'expected':'review';note=verdict==='expected'?'已声明为实验 ROM 的预期解锁。':'报告出现解锁线索，建议核对。';}
      if(signal==='verifiedBoot'&&b==='red'){verdict='review';note='报告出现红色启动线索，需独立核对。';}
      if(['system.patch','system.systemSpl','system.vendorSpl'].includes(key)&&patchDate(b)<patchDate(a)){verdict='review';note='声明的补丁日期早于基线，建议核对刷机版本和补丁声明。';}
      if(key==='app.debuggerConnected'&&a==='否'&&b==='是'){verdict='review';note='采样时从未连接变为连接调试器。';}
      if(key==='system.selinux'&&a.startsWith('Enforcing')&&b.startsWith('Permissive')){verdict='review';note='报告显示 SELinux 从强制模式变为宽容模式。';}
      if((key==='environment.keyguardSecure'&&a==='是'&&b==='否')||
         (key==='environment.storageEncryption'&&a.startsWith('已启用')&&b==='系统报告未启用')){
        verdict='review';note='保护状态由启用变为未启用。';
      }
    }
    if(a&&b&&bootKeys.includes(key)&&conflicts){verdict='review';note='当前启动证据为红色或来源矛盾，即使与基线相同仍需核对。';}
    if(key==='system.webViewCode'&&a&&b&&/^\d+$/.test(a)&&/^\d+$/.test(b)
      &&value(left.get('system.webViewProvider'))&&value(left.get('system.webViewProvider'))===value(right.get('system.webViewProvider'))
      &&BigInt(b)<BigInt(a)){verdict='review';note='同一 WebView 提供程序版本号下降，核对是否预期回退。';}
    return {key,title,baseline,current,verdict,note};
  });
}
