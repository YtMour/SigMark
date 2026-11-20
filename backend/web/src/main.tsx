import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Metric = {key: string; status: string; reason?: string};
type Report = {id: string; batch: string; receivedAt: string; report: {model: string; androidApi: number; network: string; radio: string; wifiBand: string; appVersion: string; capturedAtEpochMs: number; feedback?: string; metrics: Metric[]}};
type Summary = {total: number; status: Record<string, number>; network: Record<string, number>; fields: {key: string; observed: number; restricted: number}[]};
const names: Record<string,string> = {
  wifi:'Wi‑Fi', cellular:'移动网络', vpn:'VPN', ethernet:'以太网', none:'无网络', unknown:'未知', other:'其他',
  lte:'LTE', nr:'NR', iwlan:'IWLAN', AVAILABLE:'可用', RESTRICTED:'受限', UNAVAILABLE:'未上报', ERROR:'读取异常',
  'system.selinux':'SELinux 模式', 'cpu.kernelFull':'内核编译信息', 'network.wifiFrequency':'Wi-Fi 频率',
  'network.internetValidation':'互联网验证', 'cellular.dataRat':'蜂窝制式', 'cellular.cellDiagnostics':'小区无线参数',
  PERMISSION_REQUIRED:'需用户授权', LOCATION_DISABLED:'系统位置关闭', ACCESS_DENIED:'系统拒绝访问', NOT_REPORTED:'系统未上报', READ_FAILED:'读取失败',
};
const name = (x: string) => names[x] ?? x;
const date = (x: string|number) => new Date(x).toLocaleString('zh-CN', {hour12:false});

class RequestError extends Error { constructor(readonly status: number) { super(status===401?'令牌无效，请重新输入。':`请求失败 · HTTP ${status}`); } }

async function api<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, {headers:{Authorization:`Bearer ${token}`}, signal, cache:'no-store', credentials:'omit'});
  if (!r.ok) throw new RequestError(r.status);
  return r.json() as Promise<T>;
}

function App() {
  const [token,setToken] = useState('');
  const [input,setInput] = useState('');
  const [signing,setSigning] = useState(false);
  const [error,setError] = useState('');
  if(token) return <Dashboard token={token} onLock={()=>setToken('')}/>;
  return <main><Mast/><section className="panel login">
    <p className="kicker">SIGMARK / ADMIN ACCESS</p><h1>打开诊断台</h1>
    <p className="muted">输入管理员令牌查看报告。本页不要求账号，刷新页面后需要重新输入。</p>
    <form onSubmit={async e=>{
      e.preventDefault(); if(signing) return; setSigning(true); setError('');
      try { const supplied=input.trim(); await api('/api/admin/session',supplied,AbortSignal.timeout(8000)); setInput('');setToken(supplied); }
      catch(e){setError(e instanceof RequestError?e.message:'内网服务暂不可用，请稍后重试。');}
      finally {setSigning(false);}
    }}>
      <label>管理员令牌<input type="password" autoComplete="off" maxLength={256} value={input} onChange={e=>setInput(e.target.value)} required /></label>
      <button disabled={signing||!input.trim()}>{signing?'验证中…':'进入管理台'}</button>
      {error&&<p role="alert" className="warning">{error}</p>}
    </form>
  </section></main>;
}

function Mast({onLock}:{onLock?:()=>void}) {
  return <header className="mast"><span className="mark" aria-hidden="true">印</span><div><div className="kicker">SIGMARK / LAN PILOT</div><strong>印迹 · 诊断台</strong></div><span className="pill">仅受控内网</span>{onLock&&<button className="lock" onClick={onLock}>锁定</button>}</header>;
}

function Dashboard({token,onLock}:{token:string;onLock:()=>void}) {
  const [batchInput,setBatchInput] = useState(''); const [batch,setBatch] = useState('');
  const [serial,reload] = useState(0); const [data,setData] = useState<{summary:Summary; reports:Report[]}|null>(null);
  const [busy,setBusy] = useState(true); const [error,setError] = useState(''); const [selected,setSelected] = useState('');
  useEffect(() => {
    const ctl = new AbortController(); setBusy(true); setError('');
    const query = new URLSearchParams({batch});
    Promise.all([api<Summary>(`/api/admin/summary?${query}`,token,ctl.signal),api<Report[]>(`/api/admin/reports?${query}`,token,ctl.signal)])
      .then(([summary,reports]) => {if(!ctl.signal.aborted) setData({summary,reports});})
      .catch(e => {if(!ctl.signal.aborted) {setData(null);setError(String(e.message));}})
      .finally(() => {if(!ctl.signal.aborted) setBusy(false);});
    return () => ctl.abort();
  },[batch,serial,token]);
  const stats = data?.summary;
  const focused = data?.reports.find(r => r.id===selected);
  return <main>
    <Mast onLock={onLock}/>
    <section className="intro"><p className="kicker">01 / COLLECTION OVERVIEW</p><h1>采集报告</h1><p>查看用户主动提交的诊断报告。设备型号与无线能力均为应用进程观察值。</p></section>
    <form className="filters" onSubmit={e=>{e.preventDefault();setSelected('');setBatch(batchInput.trim());reload(n=>n+1);}}>
      <label>测试批次<input value={batchInput} onChange={e=>setBatchInput(e.target.value)} placeholder="留空查看所有批次" pattern="[a-z0-9][a-z0-9\x2d]{0,31}" /></label><button>筛选 / 刷新</button>
      <span className="muted" aria-live="polite">{busy?'正在读取…':batch?`当前批次：${batch}`:'最近 30 天 · 所有批次'}</span>
    </form>
    {error && <p role="alert" className="warning">{error}</p>}
    <div className="stats" aria-busy={busy}>
      {[['收到报告',stats?.total],['可用字段',stats?.status.AVAILABLE ?? (stats?0:undefined)],['受限字段',stats?.status.RESTRICTED ?? (stats?0:undefined)]].map(([label,value])=><div className="panel stat" key={label}><span>{label}</span><strong>{busy?'—':value??'—'}</strong></div>)}
    </div>
    <div className="columns">
      <section className="panel"><p className="kicker">02 / FIELD COVERAGE</p><h2>字段受限分析</h2>
        {!busy && !stats?.fields.length ? <p className="muted">尚无字段可分析。</p> : !busy && stats?.fields.map(f=><div className="coverage" key={f.key}><span>{name(f.key)}</span><meter aria-label={`${name(f.key)}受限比例`} max={f.observed} value={f.restricted}/><b>{f.restricted} / {f.observed}</b></div>)}
        {!busy && stats && <p className="muted">默认网络：{Object.entries(stats.network).map(([k,v])=>`${name(k)} ${v}`).join(' · ')||'暂无'}</p>}
      </section>
      <section className="panel"><p className="kicker">03 / DEVICE REPORTING</p><h2>从 App 上传</h2>
        <p className="muted">手机和后台接入同一局域网。在印迹首页点「上传报告」，查看预览后确认。手机不需要填写地址或管理令牌。</p>
        <p className="muted">此服务在局域网接收报告。仅用于受控内网测试，勿对公网开放。</p>
      </section>
    </div>
    <section className="panel records"><p className="kicker">04 / REPORT LOG</p><h2>报告明细</h2><p className="muted">最多显示符合筛选条件的最近 100 份。点报告查看字段状态与反馈。</p>
      {!busy && !!data?.reports.length ? <div className="table-wrap"><table><thead><tr><th>报告 / 批次</th><th>App 观察型号</th><th>API</th><th>默认网络</th><th>服务端接收</th></tr></thead><tbody>
        {data.reports.map(r=><tr key={r.id}><td><button className="link" aria-expanded={selected===r.id} onClick={()=>setSelected(v=>v===r.id?'':r.id)}>{r.id.slice(0,8)} <small>{r.batch}</small></button></td><td>{r.report.model}</td><td>{r.report.androidApi||'—'}</td><td>{name(r.report.network)}</td><td>{date(r.receivedAt)}</td></tr>)}
      </tbody></table></div> : <p className="empty">{busy?'正在加载报告…':error?'读取失败。':'当前筛选还没有报告。'}</p>}
      {!busy && focused&&<article className="details"><h3>报告 {focused.id}</h3><p className="muted">采样 {date(focused.report.capturedAtEpochMs)} · App {focused.report.appVersion} · 蜂窝 {name(focused.report.radio)} · Wi-Fi {focused.report.wifiBand==='unknown'?'未知':`${focused.report.wifiBand} GHz`}</p>
        <ul>{(focused.report.metrics??[]).map(m=><li key={m.key}><span>{name(m.key)}</span><span className={m.status==='RESTRICTED'?'warning':''}>{name(m.status)}{m.reason?` · ${name(m.reason)}`:''}</span></li>)}</ul><p>反馈：{focused.report.feedback||'未填写'}</p></article>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
