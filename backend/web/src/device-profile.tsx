import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {date,saveDownload} from './reports';
import {followReadLink} from './reader-history';

type State='hit'|'not_observed'|'insufficient';
type Evidence={key:string;status:string;value?:string;source?:string;reason?:string;errno?:number};
type Label={code:string;state:State;evidence:Evidence[];historyHits:number;historyEvaluable:number;lastHistoricalHit?:{id:string;capturedAtEpochMs:number}};
type Profile={reportId:string;ruleVersion:string;linked:boolean;capturedAtEpochMs:number;historyDays:number;historyLimit:number;historySamples:number;historyLimited:boolean;labels:Label[]};
const rules:Record<string,[string,string]>={
  virtual_build_markers:['虚拟环境声明','仅核对已归档的硬件、产品、设备代号。它们来自同一系统，不是三份独立证据；未见标记不证明是真机。'],
  selinux_permissive:['SELinux 宽容模式','只认报告中直接取得的实时模式；读取受限不推断关闭。'],
  debugger_attached:['印迹进程连接调试器','指采样时印迹进程自身的状态。可调试的测试包、开发者选项或 USB 调试开关不代表已连接调试器。'],
};
const states:Record<State,string>={hit:'本次观察到',not_observed:'本次未见',insufficient:'本次证据不足'};
const missing:Record<string,string>={NOT_ARCHIVED:'这份报告未保存该字段',RESTRICTED:'系统限制读取',UNAVAILABLE:'采样时未取得读数',ERROR:'采集出错'};
const nextSteps:Record<string,string>={virtual_build_markers:'先核对采样对象是否是预期的模拟器或实验 ROM。',selinux_permissive:'核对本次 ROM 是否预期运行在宽容模式。',debugger_attached:'若当时在联调，这是预期现象；如需普通运行样本，结束调试后重新采样。'};

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
      <div className="security-readings">{data.labels.map(l=><details key={l.code} className="panel security-card" data-profile={l.code}>
        <summary><strong>{rules[l.code]?.[0]??l.code}</strong> <span className={'tag security-'+(l.state==='hit'?'review':l.state==='insufficient'?'unknown':'context')}>{states[l.state]}</span>
          <span className="security-finding">{!data.linked?'未作历史关联':data.historySamples===0?'暂无此前采样':!l.historyEvaluable?'此前采样证据不足':'历史观察到 '+l.historyHits+' / '+l.historyEvaluable+' 份可判断报告'}</span></summary>
        <p>{rules[l.code]?.[1]}</p>
        {l.state==='hit'&&nextSteps[l.code]&&<p>{nextSteps[l.code]}</p>}
        {l.evidence.length?<dl>{l.evidence.map(e=><div key={e.key}><dt><code>{e.key}</code></dt><dd>{e.status==='AVAILABLE'?(e.value||'无有效读数'):(missing[e.status]??e.status)}{e.errno!=null&&'（errno='+e.errno+'）'}{e.source&&<small>来源：{e.source}</small>}</dd></div>)}</dl>:<p>本报告没有可用于此标签的读数。</p>}
        {data.linked&&data.historySamples>l.historyEvaluable&&<p>另有 {data.historySamples-l.historyEvaluable} 份证据不足，未计入分母。</p>}
        {l.lastHistoricalHit&&<p>最近一次观察到：{date(l.lastHistoricalHit.capturedAtEpochMs)} · <a href={'#reports?report='+l.lastHistoricalHit.id} onClick={followReadLink}>查看当时的报告</a></p>}
      </details>)}</div>
      <small className="muted">规则 {data.ruleVersion} · 仅使用本仓库报告；资产关系不等于物理设备认证。</small>
    </>}
  </section>;
}
