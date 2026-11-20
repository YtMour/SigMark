import type {Parameter} from './compare';

export type Evidence = Parameter;
type State = 'observed'|'review'|'unknown'|'context';
type Check = {id:string;title:string;state:State;finding:string;fields:string[]};

const patchDate=(value:string|undefined)=>{
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return NaN;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:NaN;
};

export function evaluateSecurity(input:{parameters?:Evidence[];androidApi:number;model:string;capturedAtEpochMs?:number}):Check[] {
  const values = new Map((input.parameters??[]).map(p=>[p.group+'.'+p.key,p]));
  const read=(key:string)=>{const p=values.get(key);return p?.status==='AVAILABLE'?p.value?.trim():undefined;};
  const keys=['environment.verifiedBoot','environment.vbmetaState','environment.flashLock'];
  const [verified,vbmeta,flash]=keys.map(key=>read(key)?.toLowerCase());
  const locked=vbmeta==='locked'||flash==='1',unlocked=vbmeta==='unlocked'||flash==='0';
  const checks:Check[] = [{id:'boot',title:'启动链与锁定状态',fields:keys,
    state:(locked&&unlocked)||verified==='red'||verified==='orange'||unlocked?'review':
      verified==='yellow'?'context':verified==='green'&&locked?'observed':'unknown',
    finding:locked&&unlocked?'两个锁定来源互相冲突，建议在已知 ROM 环境复测。':
      verified==='red'?'报告包含红色启动线索，请核对启动链。':verified==='orange'||unlocked?'报告包含解锁线索；实验 ROM 可预期出现这一状态。':
      verified==='yellow'?'报告包含自定义信任根线索，不等于假机。':
      verified==='green'&&locked?'报告同时给出绿色启动和锁定线索；这不是签名认证。':'启动链或锁定线索不足，保留未知。'}];
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
  const v=(side:Map<string,Evidence>,key:string)=>value(side.get('environment.'+key));
  const inconsistent=(side:Map<string,Evidence>)=>{
    const [boot,vbmeta,flash]=['verifiedBoot','vbmetaState','flashLock'].map(key=>v(side,key)?.toLowerCase());
    const locked=vbmeta==='locked'||flash==='1',unlocked=vbmeta==='unlocked'||flash==='0';
    return locked&&unlocked||boot==='green'&&unlocked||boot==='orange'&&locked||boot==='red';
  };
  const conflicts=inconsistent(right);
  return comparedFields.map(([key,title])=>{
    const baseline=left.get(key),current=right.get(key);
    const a=value(baseline),b=value(current);
    let verdict:Verdict='unchanged',note='两次读数一致。';
    const signal=key.split('.')[1];
    if(!a||!b||(key==='system.patch'&&(!Number.isFinite(patchDate(a))||!Number.isFinite(patchDate(b))))){
      verdict='insufficient';note='至少一侧无有效读数，不判定安全变化。';
    }else if(a!==b){
      verdict='changed';note='读数变化，请结合设备、ROM 和测试条件。';
      const unlocked=(signal==='verifiedBoot'&&b==='orange')||(signal==='vbmetaState'&&b==='unlocked')||(signal==='flashLock'&&b==='0');
      if(unlocked){verdict=expectUnlock&&!conflicts?'expected':'review';note=verdict==='expected'?'已声明为实验 ROM 的预期解锁。':'报告出现解锁线索，建议核对。';}
      if(signal==='verifiedBoot'&&b==='red'){verdict='review';note='报告出现红色启动线索，需独立核对。';}
      if(key==='system.patch'&&patchDate(b)<patchDate(a)){verdict='review';note='声明的补丁日期早于基线，建议核对刷机版本和补丁声明。';}
      if(key==='app.debuggerConnected'&&a==='否'&&b==='是'){verdict='review';note='采样时从未连接变为连接调试器。';}
      if(key==='system.selinux'&&a.startsWith('Enforcing')&&b.startsWith('Permissive')){verdict='review';note='报告显示 SELinux 从强制模式变为宽容模式。';}
      if((key==='environment.keyguardSecure'&&a==='是'&&b==='否')||
         (key==='environment.storageEncryption'&&a.startsWith('已启用')&&b==='系统报告未启用')){
        verdict='review';note='保护状态由启用变为未启用。';
      }
    }
    return {key,title,baseline,current,verdict,note};
  });
}
