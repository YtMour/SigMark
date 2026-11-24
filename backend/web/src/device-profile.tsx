import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {date,saveDownload} from './reports';
import {followReadLink} from './reader-history';

type State='hit'|'not_observed'|'insufficient';
type Evidence={key:string;status:string;value?:string;source?:string;reason?:string;errno?:number};
type Label={code:string;state:State;evidence:Evidence[];historyHits:number;historyEvaluable:number;historyRestricted:number;lastHistoricalHit?:{id:string;capturedAtEpochMs:number}};
type Identity={model?:string;device?:string;board?:string;boardPlatform?:string;bootHardware?:string;hardwareSku?:string;samples:number;lastCapturedAtEpochMs:number;lastReportId:string};
type Profile={reportId:string;ruleVersion:string;linked:boolean;capturedAtEpochMs:number;historyDays:number;historyLimit:number;historySamples:number;historyLimited:boolean;identityHistory?:Identity[];identityTruncated?:boolean;labels:Label[]};
// 顺序与后端 sigmark-profile/2 的标签下标一致；历史统计按下标对齐，不要调整顺序。
const rules:Record<string,[string,string]>={
  virtual_build_markers:['虚拟环境声明','仅核对已归档的硬件、产品、设备代号。它们来自同一系统，不是三份独立证据；未见标记不证明是真机。'],
  selinux_permissive:['SELinux 宽容模式','只认报告中直接读取或写明推断的实时模式；读取受限不推断关闭，也不把推断当直接读数。'],
  debugger_attached:['印迹进程连接调试器','指采样时印迹进程自身的状态：调试器连接标志与 /proc/self/status 的 TracerPid。可调试的测试包、开发者选项或 USB 调试开关不代表已连接调试器。'],
  hook_injection:['注入与 Hook 线索','只扫描本进程映射、系统分区挂载线索和包可见性范围内的 Root 管理应用。这些线索不代表设备已注入或已 Root。'],
  root_manager_visible:['可见的 Root 管理应用','只匹配固定包名列表，并受 Android 11+ 包可见性限制；未见不等于未安装。'],
  multi_open:['多用户 / 分身环境','应用运行在非所有者用户或工作资料。多用户、双开和工作资料本身不是恶意结论。'],
  rom_verification:['ROM 验证与可调试声明','dm-verity 模式、可调试声明和分区构建日期来自属性快照；属性声明不证明镜像内容，属性缺失不代表分区不存在。'],
  software_drm:['DRM 密钥保护级别','系统 DRM 插件声明的密钥保护级别；L3 只表示软件级密钥保护，不等于模拟器。'],
  identity_conflict:['身份字段冲突','App 归档里 Build 声明与只读属性声明不一致'],
};
const states:Record<State,string>={hit:'本次观察到',not_observed:'本次未见',insufficient:'本次证据不足'};
const missing:Record<string,string>={NOT_ARCHIVED:'这份报告未保存该字段',RESTRICTED:'系统限制读取',UNAVAILABLE:'采样时未取得读数',ERROR:'采集出错'};
const nextSteps:Record<string,string>={
  virtual_build_markers:'先核对采样对象是否是预期的模拟器或实验 ROM。',
  selinux_permissive:'核对本次 ROM 是否预期运行在宽容模式。',
  debugger_attached:'若当时在联调，这是预期现象；如需普通运行样本，结束调试后重新采样。',
  hook_injection:'先与同一 ROM 的基线对照，核对采样时是否在跑调试或注入工具；不要直接判为恶意。',
  root_manager_visible:'受 Android 11+ 包可见性限制，未命中不等于未安装；可结合其他证据通道复核。',
  multi_open:'核对是否为双开或工作资料测试环境；这不是恶意结论。',
  rom_verification:'核对 ROM 来源、dm-verity 与 ro.debuggable，不当作真伪结论。',
  software_drm:'L3 是软件级密钥保护，不等于模拟器；核对测试设备是否本来就没有硬件 DRM。',
  identity_conflict:'核对 ROM 是否改写 ro.* 属性；不据此判定真伪。'};

export function DeviceProfilePanel({reportId}:{reportId:string}) {
  const [data,setData]=useState<Profile>();const [error,setError]=useState('');const [retry,setRetry]=useState(0);
  useEffect(()=>{const ctl=new AbortController();setError('');setData(undefined);
    request<Profile>('/api/admin/reports/'+reportId+'/device-profile',{signal:ctl.signal}).then(p=>{
      if(!ctl.signal.aborted){if(p.reportId!==reportId||!Array.isArray(p.labels))throw Error('设备画像与报告不匹配');setData(p);}
    }).catch(e=>{if(!ctl.signal.aborted)setError(errorMessage(e));});return ()=>ctl.abort();},[reportId,retry]);
  return <section className="panel" aria-labelledby="device-profile-heading">
    <div className="pane-title"><div><h2 id="device-profile-heading">设备风险画像</h2><p className="muted">本次观察与过去记录分开看，不用于判定交易欺诈。</p></div>
      {data&&<button type="button" className="secondary" onClick={()=>saveDownload(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-profile-'+reportId+'.json')}>导出画像 JSON</button>}</div>
    {!data?(error?<div className="inset"><span role="alert">{error}</span> <button type="button" className="secondary" onClick={()=>setRetry(n=>n+1)}>重试读取画像</button></div>:<p role="status">正在读取画像…</p>):<>
      <p>{!data.linked?'这份报告未关联设备资产，仅分析本次；不会按型号猜测归属。':
        '同一已归组资产 · 采样前 '+data.historyDays+' 天内的 '+data.historySamples+' 份先前报告'+(data.historyLimited?'（仅计最近 '+data.historyLimit+' 份）':'')+'。'}</p>
      {data.labels.some(label=>label.code==='identity_conflict'&&label.state==='hit')&&
        <p className="identity-notice" role="status">本份报告的身份声明不一致：Build 与只读属性对不上（详见下方「身份字段冲突」）；先核对 ROM 属性改写，不据此判定真伪。</p>}
      <div className="security-readings">{data.labels.map(l=><details key={l.code} className="panel security-card" data-profile={l.code}>
        <summary><strong>{rules[l.code]?.[0]??l.code}</strong> <span className={'tag security-'+(l.state==='hit'?'review':l.state==='insufficient'?'unknown':'context')}>{states[l.state]}</span>
          <span className="security-finding">{!data.linked?'未作历史关联':data.historySamples===0?'暂无此前采样':!l.historyEvaluable?'此前采样证据不足':'历史观察到 '+l.historyHits+' / '+l.historyEvaluable+' 份可判断报告'}</span></summary>
        <p>{rules[l.code]?.[1]}</p>
        {l.state==='hit'&&nextSteps[l.code]&&<p>{nextSteps[l.code]}</p>}
        {l.evidence.length?<dl>{l.evidence.map(e=><div key={e.key}><dt><code>{e.key}</code></dt><dd>{e.status==='AVAILABLE'?(e.value||'无有效读数'):(missing[e.status]??e.status)}{e.errno!=null&&'（errno='+e.errno+'）'}{e.source&&<small>来源：{e.source}</small>}</dd></div>)}</dl>:<p>本报告没有可用于此标签的读数。</p>}
        {data.linked&&data.historySamples>l.historyEvaluable&&<p>另有 {data.historySamples-l.historyEvaluable} 份证据不足，未计入分母。</p>}
        {typeof l.historyRestricted==='number'&&l.historyRestricted>0&&<p>历史受限 {l.historyRestricted} 份（系统拒绝读取，不计入命中）。</p>}
        {l.lastHistoricalHit&&<p>最近一次观察到：{date(l.lastHistoricalHit.capturedAtEpochMs)} · <a href={'#reports?report='+l.lastHistoricalHit.id} onClick={followReadLink}>查看当时的报告</a></p>}
      </details>)}</div>
      {!!data.identityHistory?.length&&<details className="panel security-card" data-profile="identity-history" open>
        <summary><strong>历史身份声明</strong> <span className={'tag security-'+(data.identityHistory.length>1?'review':'context')}>{data.identityHistory.length>1?'出现 '+data.identityHistory.length+' 套':'1 套'}</span>
          <span className="security-finding">{data.linked?'采样前 '+data.historyDays+' 天窗口':'未作历史关联，仅本次'}</span></summary>
        <p>同一资产归档里出现过的「型号 + 主板 + 硬件声明」组合。组合不止一套时先核对 ROM 或采样来源；这只是报告里的声明，不是物理设备认证。</p>
        <ul>{data.identityHistory.map(entry=><li key={entry.lastReportId}>
          <strong>{entry.model??'型号未归档'}</strong>{entry.device?' / '+entry.device:''}
          {' · 主板 '+(entry.board??'—')+(entry.boardPlatform?' / '+entry.boardPlatform:'')}
          {' · 硬件 '+(entry.bootHardware??'—')+(entry.hardwareSku?' / '+entry.hardwareSku:'')}
          {' · '+entry.samples+' 份 · 最近 '+date(entry.lastCapturedAtEpochMs)}
          {' · '}<a href={'#reports?report='+entry.lastReportId} onClick={followReadLink}>查看当时报告</a>
        </li>)}</ul>
        {data.identityTruncated&&<p>组合超过 5 套，只列最近 5 套。</p>}
      </details>}
      <small className="muted">规则 {data.ruleVersion} · 仅使用本仓库报告；资产关系不等于物理设备认证。</small>
    </>}
  </section>;
}
