import type {Parameter} from './compare';

export type Evidence = Parameter;
type State = 'observed'|'review'|'unknown'|'context';
type Check = {id:string;title:string;state:State;finding:string;fields:string[]};

const patchDate=(value:string|undefined)=>{
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:NaN;
};

export const ruleVersion='rom-evidence/4';
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

// SELinux 实时模式按前缀归一：直接读数与推断读数属于同一模式，只有策略拒绝时才是未知。
export type SelinuxMode='enforcing'|'permissive'|'disabled'|'unknown';
export function selinuxMode(value?:string|null):SelinuxMode{
  const text=(value??'').trim();
  if(text.startsWith('Enforcing'))return 'enforcing';
  if(text.startsWith('Permissive'))return 'permissive';
  if(text.startsWith('未启用'))return 'disabled';
  return 'unknown';
}
// 推断依据优先取 system.selinuxEvidence；该键缺失或为旧字段集时退回值串里的「推断」。
export function selinuxInferred(value?:string|null,evidence?:string|null){
  const basis=(evidence??'').trim();
  if(basis==='inferred_mac'||basis==='inferred_disabled')return true;
  return (value??'').includes('推断');
}
// Field-set-19 identity pairs. Both sides must be AVAILABLE; a missing or
// restricted side is never a disagreement. Comparison ignores case.
export const identityFieldPairs:[string,string,string][]=[['system.board','system.boardPlatform','主板'],
  ['cpu.hardware','system.bootHardware','硬件'],['system.sku','system.hardwareSku','SKU']];
export type IdentityConflict={title:string;leftKey:string;rightKey:string;left:string;right:string};
export function identityConflictsOf(fields:Evidence[]):IdentityConflict[]{
  const archive=new Map(fields.map(row=>[row.group+'.'+row.key,row]));
  const read=(key:string)=>{const row=archive.get(key);return row?.status==='AVAILABLE'&&row.value?.trim()?row.value.trim():undefined;};
  const out:IdentityConflict[]=[];
  for(const [leftKey,rightKey,title] of identityFieldPairs){
    const left=read(leftKey),right=read(rightKey);
    if(!left||!right)continue;
    if(left.toLowerCase()!==right.toLowerCase())out.push({title,leftKey,rightKey,left,right});
  }
  return out;
}
export function evaluateSecurity(input:{parameters?:Evidence[];androidApi:number;model:string;capturedAtEpochMs?:number;fieldSetVersion?:number|null},reference?:ReleaseReference):Check[] {
  const values = new Map((input.parameters??[]).map(p=>[p.group+'.'+p.key,p]));
  const read=(key:string)=>{const p=values.get(key);return p?.status==='AVAILABLE'?p.value?.trim():undefined;};
  const [state,finding]=bootChecks[bootEvidence(...bootKeys.map(read))];
  const checks:Check[]=[{id:'boot',title:'启动链与锁定状态',fields:bootKeys,state,finding}];
  const selinux=read('system.selinux'),selinuxEvidence=read('system.selinuxEvidence');
  const mode=selinuxMode(selinux),inferred=selinuxInferred(selinux,selinuxEvidence);
  checks.push({id:'selinux',title:'SELinux 实时模式',fields:['system.selinux','system.selinuxEvidence','environment.selinuxDomain'],
    state:mode==='enforcing'?'observed':mode==='permissive'?'review':mode==='disabled'?'context':'unknown',
    finding:mode==='enforcing'?(inferred?
        '报告只能推断为强制模式：节点被策略拒绝读取，DAC 允许读取，permissive 下本应可读；这是推断，不是直接读数。':
        '报告读取到强制模式。'):
      mode==='permissive'?(inferred?'报告推断为宽容模式：读取依据来自推断，不是直接读数；请对照独立观察。':
        '报告读取到宽容模式；并非 SELinux 已关闭。'):
      mode==='disabled'?'报告推断 SELinux 未启用：/sys/fs/selinux 不存在（ENOENT），不是直接读数。':
      '实时模式未确认。受限节点或应用进程域不能代替实时模式。'});
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
  // 字段集 19：同一观察者内部，Build 声明与只读属性声明是两条独立来源；只比对，不判定真伪。
  const identityRows=identityFieldPairs.map(([buildKey,propertyKey,title])=>({title,build:read(buildKey),property:read(propertyKey)}));
  const identityComparable=identityRows.filter(row=>!!row.build&&!!row.property);
  const identityConflicts=identityConflictsOf(input.parameters??[]);
  const identityPairText=(row:{title:string;build?:string;property?:string})=>row.title+' Build='+row.build+' / 属性='+row.property;
  checks.push({id:'identity_fields',title:'身份字段一致性',
    fields:['system.board','system.boardPlatform','cpu.hardware','system.bootHardware','system.sku','system.hardwareSku'],
    state:identityConflicts.length?'review':identityComparable.length?'observed':'unknown',
    finding:identityConflicts.length?'同一观察者内部两组声明不一致，先核对 ROM 属性改写：'+
        identityConflicts.map(identityPairText).join('；')+'。':
      identityComparable.length?'可比对的 '+identityComparable.length+' 对一致（'+
        identityComparable.map(identityPairText).join('；')+'）；两组声明来自同一观察者，不是独立验证。':
      'Build 声明与只读属性没有一对两侧同时可用，无法比较；缺一侧不等于不一致。'});
  const hookKeys=['environment.hookSignals','environment.rootMountHints','environment.rootManagerVisible'];
  const hookLabels:Record<string,string>={'environment.hookSignals':'映射线索','environment.rootMountHints':'挂载线索',
    'environment.rootManagerVisible':'可见管理应用'};
  const hookReads=hookKeys.map(key=>({key,value:read(key)}));
  const hookHits=hookReads.filter(row=>!!row.value&&row.value.toLowerCase()!=='none');
  const hookArchived=hookReads.filter(row=>row.value!=null).length;
  checks.push({id:'hook',title:'注入与 Hook 线索',fields:hookKeys,
    state:hookHits.length?'review':hookArchived===hookKeys.length?'observed':'unknown',
    finding:hookHits.length?'本进程或当前可见范围记录到 '+hookHits.map(row=>hookLabels[row.key]+' '+row.value).join('；')+
      '。只代表本进程映射与包可见性范围，需核对测试条件；不是设备已注入或已 Root 的结论。':
      hookArchived===hookKeys.length?'三项公开线索都记为 none。映射只覆盖当前进程，包查询受 Android 11+ 包可见性限制，none 不能反证设备未被 Hook 或未安装管理应用。':
      '至少一项线索没有可用读数；none 只表示当前进程与可见范围内未见，不能作为反证。'});
  const debugYes=read('app.debuggerConnected')==='是',debugNo=read('app.debuggerConnected')==='否';
  const tracer=read('environment.tracerPid');
  const tracerPid=tracer!=null&&/^\d+$/.test(tracer)?Number(tracer):undefined;
  const traced=tracerPid!=null&&tracerPid>0;
  checks.push({id:'trace',title:'调试与跟踪',fields:['app.debuggerConnected','environment.tracerPid'],
    state:debugYes||traced?'review':debugNo&&tracerPid===0?'observed':'unknown',
    finding:[debugYes?'报告记录采样时当前进程连接了调试器。':'',
      traced?'内核在 /proc/self/status 记录 TracerPid='+tracer+'：可能是调试器、Profiler 或注入框架附加。':'',
      debugYes||traced?'这类读数不是攻击结论，先核对是否为预期联调。':''].filter(Boolean).join('')||
      (debugNo&&tracerPid===0?'当前进程未连接调试器，内核记录的 TracerPid 为 0。这不代表其他进程或更早时刻没有跟踪方。':
        '调试器连接与内核跟踪读数至少一项缺失；单一读数不能代替整项判断。')});
  const userProfile=read('environment.userProfile');
  checks.push({id:'profile',title:'运行用户环境',fields:['environment.userProfile'],
    state:userProfile==='owner'?'observed':userProfile==='secondary'||userProfile==='managed'?'review':'unknown',
    finding:userProfile==='owner'?'应用运行在设备所有者用户（用户 0）；只说明运行用户，不涉及账号或权限范围。':
      userProfile==='secondary'?'应用运行在非所有者用户：多用户或分身环境，需核对测试条件；这不是恶意结论。':
      userProfile==='managed'?'应用运行在工作资料（托管配置）：多用户或分身环境，需核对测试条件；这不是恶意结论。':
      '运行用户未归档；不能据此判断单用户、双开或工作资料环境。'});
  const drm=read('environment.drmSecurityLevel');
  checks.push({id:'drm',title:'DRM 密钥保护',fields:['environment.drmSecurityLevel'],
    state:drm==='L1'?'observed':drm==='L2'||drm==='L3'?'context':'unknown',
    finding:drm==='L1'?'系统 DRM 插件声明 L1（硬件级密钥保护）；这是插件声明，不是本机证明。':
      drm==='L2'?'系统 DRM 插件声明 L2；属环境线索，不等于模拟器。':
      drm==='L3'?'系统 DRM 插件声明 L3（软件级密钥保护）；属环境线索，不等于模拟器。':
      'DRM 安全等级无可用读数；接口打不开或未归档不代表设备没有 DRM。'});
  const verity=read('environment.verityMode')?.toLowerCase();
  const debuggable=read('environment.buildDebuggable');
  const buildDates=read('system.partitionBuildDates');
  const bootloader=read('system.bootloader'),baseOs=read('system.baseOs');
  const weakVerity=verity==='disabled'||verity==='logging';
  const debugDeclared=debuggable==='开启';
  const romArchived=[verity,debuggable,buildDates,bootloader,baseOs].some(item=>item!=null);
  checks.push({id:'rom',title:'ROM 验证与构建声明',
    fields:['environment.verityMode','environment.buildDebuggable','system.partitionBuildDates','system.bootloader','system.baseOs'],
    state:weakVerity||debugDeclared?'review':romArchived?'context':'unknown',
    finding:weakVerity||debugDeclared?[weakVerity?'系统属性声明 dm-verity 为 '+verity:'',
      debugDeclared?'系统属性声明 ro.debuggable 为开启':'',
      '这些是属性快照的声明，不证明镜像内容；请核对是否为登记的实验镜像与预期配置。'].filter(Boolean).join('；'):
      romArchived?'已归档构建声明：'+[bootloader&&'bootloader '+bootloader,baseOs&&'base_os '+baseOs,
        buildDates&&'分区构建日期 '+buildDates].filter(Boolean).join(' · ')+
        '。属性声明与构建时间不证明镜像内容，属性缺失也不代表分区不存在。':
      'verity 模式、可调试声明与分区构建日期均无有效读数。'});
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

export type CompareVerdict='unchanged'|'changed'|'review'|'expected'|'context'|'insufficient'|'not_archived'|'restricted';
export type CompareCategory='boot'|'rom'|'runtime'|'protection'|'identity';
type CompareRow={key:string;title:string;category:CompareCategory;baseline:Evidence|undefined;current:Evidence|undefined;
  verdict:CompareVerdict;note:string};
type CompareCounts={unchanged:number;changed:number;restricted:number;notArchived:number;insufficient:number};
export type CompareSummary={total:number;unchanged:number;changed:number;restricted:number;notArchived:number;
  insufficient:number;byCategory:Record<CompareCategory,CompareCounts>};

type FieldSpec=[string,string,CompareCategory];
const comparedFields:FieldSpec[]=[
  ['environment.verifiedBoot','Verified Boot','boot'],['environment.vbmetaState','VBMeta 锁定','boot'],['environment.flashLock','Bootloader 锁定','boot'],
  ['system.selinux','SELinux 实时模式','rom'],['system.patch','安全补丁日期','rom'],['app.debuggerConnected','调试器连接','runtime'],
  ['environment.keyguardSecure','锁屏凭证','protection'],['environment.storageEncryption','存储加密','protection'],
];
const addedFields:FieldSpec[]=[
  ['environment.hookSignals','Hook / 注入映射线索','runtime'],['environment.tracerPid','内核跟踪进程 PID','runtime'],
  ['environment.rootMountHints','系统分区挂载线索','runtime'],['environment.rootManagerVisible','可见的 Root 管理应用','runtime'],
  ['environment.userProfile','应用运行用户环境','runtime'],['environment.drmSecurityLevel','系统 DRM 密钥保护级别','protection'],
  ['environment.verityMode','dm-verity 启动模式','rom'],['environment.buildDebuggable','系统可调试构建声明','rom'],
  ['system.partitionBuildDates','分区构建日期','rom'],['system.selinuxEvidence','SELinux 读取依据','rom'],
  ['cpu.coresConfigured','内核配置的逻辑 CPU 数','runtime'],
  ['system.boardPlatform','平台代号声明','identity'],['system.bootHardware','启动硬件声明','identity'],
  ['system.hardwareSku','启动硬件 SKU','identity'],
];
const extraFields:FieldSpec[]=[
  ['system.webViewProvider','WebView 提供程序','rom'],['system.webViewVersion','WebView 版本','rom'],['system.webViewCode','WebView 内部版本号','rom'],
  ['system.systemSpl','系统组件补丁','rom'],['system.vendorSpl','厂商组件补丁','rom'],['environment.keyProtection','临时密钥保护','runtime'],
  ['app.certSha256','采集器签名摘要','identity'],
];
const dateKeys=['system.patch','system.systemSpl','system.vendorSpl'];
const hookSignalKeys=['environment.hookSignals','environment.rootMountHints','environment.rootManagerVisible'];
const noneText=(text?:string)=>!text||/^none$/i.test(text.trim());
export function compareSecurity(before:Evidence[],after:Evidence[],expectUnlock=false):CompareRow[] {
  const index=(rows:Evidence[])=>new Map(rows.map(row=>[row.group+'.'+row.key,row]));
  const left=index(before),right=index(after);
  const value=(row:Evidence|undefined)=>row?.status==='AVAILABLE'?row.value?.trim():undefined;
  const currentBoot=bootEvidence(...bootKeys.map(key=>value(right.get(key))));
  const conflicts=currentBoot==='red'||currentBoot==='conflict';
  const partitions:[string,string,CompareCategory][]=[...new Set([...left.keys(),...right.keys()])]
    .filter(key=>key.startsWith('system.partition_')).sort().map(key=>[key,key.slice(17)+' 分区构建','rom']);
  const fields:FieldSpec[]=[...comparedFields,...addedFields.filter(([key])=>left.has(key)||right.has(key)),
    ...extraFields.filter(([key])=>left.has(key)||right.has(key)),...partitions];
  const tracerPid=(text?:string)=>(text!=null&&/^\d+$/.test(text)?Number(text):NaN);
  return fields.map(([key,title,category])=>{
    const baseline=left.get(key),current=right.get(key);
    const a=value(baseline),b=value(current);
    let verdict:CompareVerdict='unchanged',note='两次读数一致。';
    const signal=key.split('.')[1];
    const dated=dateKeys.includes(key);
    if(!baseline||!current){verdict='not_archived';note='一侧报告未归档该字段（旧字段集），不判定变化。';}
    else if(baseline.status==='RESTRICTED'||current.status==='RESTRICTED'){verdict='restricted';note='一侧被系统拒绝读取，不判定变化。';}
    else if(!a||!b||(dated&&(!Number.isFinite(patchDate(a))||!Number.isFinite(patchDate(b))))){
      verdict='insufficient';note='至少一侧无有效读数，不判定安全变化。';
    }else if(a!==b){
      verdict='changed';note='读数变化，请结合设备、ROM 和测试条件。';
      const unlocked=(signal==='verifiedBoot'&&b==='orange')||(signal==='vbmetaState'&&b==='unlocked')||(signal==='flashLock'&&b==='0');
      if(unlocked){verdict=expectUnlock&&!conflicts?'expected':'review';note=verdict==='expected'?'已声明为实验 ROM 的预期解锁。':'报告出现解锁线索，建议核对。';}
      if(signal==='verifiedBoot'&&b==='red'){verdict='review';note='报告出现红色启动线索，需独立核对。';}
      if(dated&&patchDate(b)<patchDate(a)){verdict='review';note='声明的补丁日期早于基线，建议核对刷机版本和补丁声明。';}
      if(key==='app.debuggerConnected'&&a==='否'&&b==='是'){verdict='review';note='采样时从未连接变为连接调试器。';}
      if(key==='system.selinux'){
        const beforeMode=selinuxMode(a),afterMode=selinuxMode(b);
        const beforeInferred=selinuxInferred(a,value(left.get('system.selinuxEvidence')));
        const afterInferred=selinuxInferred(b,value(right.get('system.selinuxEvidence')));
        if(beforeMode===afterMode&&beforeMode!=='unknown'){
          verdict='context';
          note=beforeInferred&&afterInferred?'模式一致，两侧都是推断读数，不判定实时模式变化。':
            !beforeInferred&&!afterInferred?'模式一致，只是值串写法不同，不判定实时模式变化。':
            afterInferred?'模式一致，读取依据由直接读取变为推断。':'模式一致，读取依据由推断变为直接读取。';
        }else if(beforeMode==='enforcing'&&afterMode==='permissive'){verdict='review';note='报告显示 SELinux 从强制模式变为宽容模式。';}
      }
      if(key==='system.selinuxEvidence'){
        verdict='context';note='SELinux 读取依据由 '+a+' 变为 '+b+'；只说明取值方式不同，不判定实时模式变化。';
      }
      if(hookSignalKeys.includes(key)&&!noneText(b)&&noneText(a)){
        verdict='review';note='本次出现上一份未记录的公开线索；只代表当前进程与包可见性范围，需核对测试条件，不等于设备已注入或已 Root。';
      }
      if(key==='environment.tracerPid'&&tracerPid(a)===0&&tracerPid(b)>0){
        verdict='review';note='内核由无跟踪方变为记录跟踪进程，请核对联调、Profiler 或注入框架。';
      }
    }
    if(a&&b&&bootKeys.includes(key)&&conflicts){verdict='review';note='当前启动证据为红色或来源矛盾，即使与基线相同仍需核对。';}
    if(key==='system.webViewCode'&&a&&b&&/^\d+$/.test(a)&&/^\d+$/.test(b)
      &&value(left.get('system.webViewProvider'))&&value(left.get('system.webViewProvider'))===value(right.get('system.webViewProvider'))
      &&BigInt(b)<BigInt(a)){verdict='review';note='同一 WebView 提供程序版本号下降，核对是否预期回退。';}
    return {key,title,category,baseline,current,verdict,note};
  });
}

const emptyCounts=():CompareCounts=>({unchanged:0,changed:0,restricted:0,notArchived:0,insufficient:0});
export function compareSummary(rows:{verdict:CompareVerdict;category:CompareCategory}[]):CompareSummary{
  const byCategory:Record<CompareCategory,CompareCounts>={boot:emptyCounts(),rom:emptyCounts(),runtime:emptyCounts(),
    protection:emptyCounts(),identity:emptyCounts()};
  const summary:CompareSummary={total:rows.length,...emptyCounts(),byCategory};
  for(const row of rows){
    const bucket=row.verdict==='not_archived'?'notArchived':row.verdict==='restricted'?'restricted':
      row.verdict==='unchanged'?'unchanged':row.verdict==='changed'?'changed':row.verdict==='insufficient'?'insufficient':null;
    if(!bucket)continue;
    summary[bucket]++;
    byCategory[row.category][bucket]++;
  }
  return summary;
}
