import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { diffParameters, parameterKey, type Parameter } from './compare';
import { BuildPage, Downloads, SettingsPage, request, RequestError, errorMessage as message } from './console';
import './style.css';

type Metric = {key:string;status:string;reason?:string};
type Row = {id:string;batch:string;receivedAt:string;report:{schemaVersion:number;model:string;androidApi:number;appVersion:string;network:string}};
type Report = Row & {report:{capturedAtEpochMs:number;feedback?:string;metrics:Metric[];parameters?:Parameter[]}};
type Page = {items:Row[];nextCursor:string};
type Summary = {total:number;status:Record<string,number>;network:Record<string,number>};
const groups:Record<string,string>={system:'系统与固件',cpu:'内核与 CPU',memory:'内存与存储',display:'屏幕与显示',battery:'电池',sensors:'传感器',network:'Wi-Fi 与网络',cellular:'移动网络'};
const labels:Record<string,string>={AVAILABLE:'可用',RESTRICTED:'受限',UNAVAILABLE:'暂无数据',ERROR:'读取异常',wifi:'Wi-Fi',cellular:'移动网络',ethernet:'以太网',vpn:'VPN',none:'离线',unknown:'未知',other:'其他',
  PERMISSION_REQUIRED:'需用户授权',LOCATION_DISABLED:'系统位置关闭',ACCESS_DENIED:'系统拒绝访问',NOT_REPORTED:'未上报或未暴露',READ_FAILED:'读取失败',NODE_MISSING:'节点未暴露',INVALID_VALUE:'状态未确认',
  'system.selinux':'SELinux 实时模式','cpu.kernelFull':'内核编译信息','network.wifiFrequency':'Wi-Fi 频率','network.internetValidation':'互联网验证','cellular.dataRat':'蜂窝制式','cellular.cellDiagnostics':'小区无线参数'};
const caption=(value:string)=>labels[value]??value;
const date=(value:string|number)=>new Date(value).toLocaleString('zh-CN',{hour12:false});
const shortDate=(v:string)=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const sections = [
  {id:'reports', label:'报告档案'},
  {id:'builds', label:'构建中心'},
  {id:'settings', label:'设置'},
  {id:'downloads', label:'应用下载'},
] as const;
type Section = typeof sections[number]['id'];
function readSection(): Section {
  return sections.find(section => '#' + section.id === location.hash)?.id ?? 'reports';
}

function App(){
  const [section,setSection]=useState(readSection);
  const [session,setSession]=useState<'checking'|'guest'|'active'|'unavailable'>('checking');
  const [attempt,recheck]=useState(0);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    const route=()=>setSection(readSection());
    const expired=()=>{setSession('guest');setError('会话已过期，请重新输入管理员令牌。');};
    window.addEventListener('hashchange',route);
    window.addEventListener('sigmark:session-expired',expired);
    return ()=>{
      window.removeEventListener('hashchange',route);
      window.removeEventListener('sigmark:session-expired',expired);
    };
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]);
    request('/api/admin/session',{signal}).then(()=>{
      if (!controller.signal.aborted) setSession('active');
    }).catch(err=>{
      if (controller.signal.aborted) return;
      if (err instanceof RequestError && err.status===401) setSession('guest');
      else {setSession('unavailable');setError(message(err));}
    });
    return ()=>controller.abort();
  },[attempt]);
  async function lock(){
    setBusy(true);setError('');
    try{
      await request('/api/admin/logout',{method:'POST',signal:AbortSignal.timeout(8000)});
      setSession('guest');
    }catch(err){setError(message(err));}
    finally{setBusy(false);}
  }
  return <>
    <header className="mast">
      <a className="brand" href="#reports"><img src="/sigmark-icon.png" alt="" width="36" height="36"/><span><strong>印迹</strong> / SigMark</span></a>
      <nav className="main-nav" aria-label="工作区导航">
        {sections.map(item=><a key={item.id} href={'#'+item.id} aria-current={section===item.id?'page':undefined}>{item.label}</a>)}
      </nav>
      <div className="mast-actions"><span className="lan"><i/>内网工作区</span>{session==='active'&&<button className="secondary" onClick={lock} disabled={busy}>锁定</button>}</div>
    </header>
    {session==='active'&&error&&<p className="workspace error" role="alert">{error}</p>}
    {section==='downloads'?<Downloads/>:session==='active'?
      section==='settings'?<SettingsPage/>:section==='builds'?<BuildPage/>:<Archive/>:
      <main className="login"><h1>管理工作区</h1>
      {session==='checking'?<p className="muted" role="status">正在检查登录状态…</p>:
        session==='unavailable'?<>
          <p role="alert" className="error">{error}</p>
          <button onClick={()=>{setSession('checking');setError('');recheck(n=>n+1);}}>重试</button>
        </>:<>
          <p className="muted">输入管理员令牌，进入{sections.find(item=>item.id===section)?.label}。</p>
          <form onSubmit={async event=>{
            event.preventDefault();
            if(busy)return;
            setBusy(true);setError('');
            try{
              await request('/api/admin/login',{
                method:'POST',body:JSON.stringify({token:input.trim()}),signal:AbortSignal.timeout(8000),
              });
              setInput('');setSession('active');
            }catch(err){setError(message(err));}
            finally{setBusy(false);}
          }}>
            <label>管理员令牌<input type="password" autoComplete="off" maxLength={256} value={input} onChange={event=>setInput(event.target.value)} required/></label>
            <button disabled={busy||!input.trim()}>{busy?'正在验证…':'登录'}</button>
            {error&&<p role="alert" className="error">{error}</p>}
          </form>
        </>}
      </main>}
  </>;
}

function Archive(){
  const [query,setQuery]=useState(''),[batchInput,setBatchInput]=useState('');
  const [filters,setFilters]=useState({q:'',batch:''});
  const [pages,setPages]=useState(['']);
  const [refresh,setRefresh]=useState(0);
  const [data,setData]=useState<Page|null>(null),[summary,setSummary]=useState<Summary|null>(null);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(true);
  const [selected,setSelected]=useState<Row|null>(null);
  const [baseline,setBaseline]=useState<Row|null>(null);
  const [compare,setCompare]=useState<{left:Row;right:Row}|null>(null);
  const [mobileMode,setMobileMode]=useState<'list'|'detail'>('list');
  const cursor=pages[pages.length-1];
  useEffect(()=>{
    const ctl=new AbortController(); setSummary(null);
    request<Summary>('/api/admin/summary?'+new URLSearchParams(filters),{signal:ctl.signal})
      .then(r=>{if(!ctl.signal.aborted)setSummary(r);}).catch(()=>{});
    return ()=>ctl.abort();
  },[filters,refresh]);
  useEffect(()=>{
    const ctl=new AbortController();setBusy(true);setStatus('');
    const params=new URLSearchParams(filters);if(cursor)params.set('before',cursor);
    request<Page>('/api/admin/reports?'+params,{signal:ctl.signal}).then(r=>{if(!ctl.signal.aborted)setData(r);})
      .catch(e=>{if(!ctl.signal.aborted){setStatus(message(e));setData(null);}})
      .finally(()=>{if(!ctl.signal.aborted)setBusy(false);});
    return ()=>ctl.abort();
  },[filters,cursor,refresh]);
  function open(r:Row){setSelected(r);setCompare(null);setMobileMode('detail');}
  function runQuery(){setPages(['']);setFilters({q:query.trim(),batch:batchInput.trim()});setRefresh(n=>n+1);}
  return <main className="workspace">
    <section className="page-heading"><div><h1>报告档案库</h1><p className="muted">从手机采集、归档到 ROM 版本对比。只展示应用进程观测值。</p></div><div className="archive-facts"><div><strong>{summary?.total??'—'}</strong><span>匹配报告</span></div><div><strong>{summary?.status.RESTRICTED??(summary?0:'—')}</strong><span>受限字段样本</span></div><div><b>长期保存</b><span>无自动清理</span></div></div></section>
    <form className="filters panel" onSubmit={e=>{e.preventDefault();runQuery();}}><label className="main-search">搜索档案<input placeholder="型号、ROM / 构建号、报告编号…" value={query} maxLength={80} onChange={e=>setQuery(e.target.value)}/></label>
      <label>批次<input placeholder="全部批次" pattern="[a-z0-9][a-z0-9\x2d]{0,31}" value={batchInput} onChange={e=>setBatchInput(e.target.value)}/></label>
      <button>搜索 / 刷新</button>{(filters.q||filters.batch)&&<button className="secondary" type="button" onClick={()=>{setQuery('');setBatchInput('');setPages(['']);setFilters({q:'',batch:''});}}>清除筛选</button>}</form>
    {baseline&&<div className="baseline"><span><b>对比基线</b> {baseline.report.model} · <code>{baseline.id.slice(0,8)}</code> · {shortDate(baseline.receivedAt)}</span><button className="secondary" onClick={()=>{setBaseline(null);setCompare(null);}}>移除基线</button></div>}
    <div className={'workbench show-'+mobileMode}>
      <section className="panel index" aria-label="报告列表"><div className="pane-title"><div><h2>报告列表</h2></div><span className="tag">{busy?'读取中':'第 '+pages.length+' 页'}</span></div>
        {status&&<p role="alert" className="error inset">{status}</p>}
        {!busy&&!status&&!data?.items.length&&<p className="empty">没有匹配报告。上传新报告或清除筛选后重试。</p>}
        <div className="report-list" aria-busy={busy}>{!busy&&data?.items.map(row=><button className="report-row" type="button" key={row.id} aria-pressed={selected?.id===row.id} onClick={()=>open(row)}>
          <span className="row-top"><strong>{row.report.model}</strong><span>{shortDate(row.receivedAt)}</span></span>
          <span className="row-tags"><span>{row.batch}</span><span>API {row.report.androidApi||'—'}</span><span>{caption(row.report.network)}</span><code>{row.id.slice(0,8)}</code></span>
        </button>)}</div>
        <nav className="pages" aria-label="报告分页"><button className="secondary" disabled={busy||pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button><span>每页 30 份</span><button className="secondary" disabled={busy||!data?.nextCursor} onClick={()=>data?.nextCursor&&setPages(p=>[...p,data.nextCursor])}>下一页</button></nav>
      </section>
      <section className="panel reader" aria-label="报告工作区">
        <button className="mobile-back secondary" onClick={()=>setMobileMode('list')}>返回报告列表</button>
        {compare?<Compare key={compare.left.id+compare.right.id} left={compare.left} right={compare.right} close={()=>setCompare(null)}/>:selected?
          <Details key={selected.id} row={selected} pin={()=>setBaseline(selected)} hasBaseline={!!baseline&&baseline.id!==selected.id} startCompare={()=>{if(baseline)setCompare({left:baseline,right:selected});}}/>:
          <div className="welcome"><h2>从报告列表选择一份样本</h2><p>查看参数、来源和错误码。要比较定制 ROM，先将一份报告设为基线，再选择另一份报告查看变化。</p></div>}
      </section>
    </div>
  </main>;
}

function useReport(id:string){
  const [data,setData]=useState<Report|null>(null),[error,setError]=useState('');
  useEffect(()=>{const ctl=new AbortController();
    request<Report>('/api/admin/reports/'+id,{signal:ctl.signal}).then(v=>{if(!ctl.signal.aborted)setData(v);}).catch(e=>{if(!ctl.signal.aborted)setError(message(e));});
    return ()=>ctl.abort();
  },[id]);
  return {data,error};
}
function saveJson(data:Report){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a'); link.href=url;link.download='SigMark-'+data.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function Details({row,pin,hasBaseline,startCompare}:{row:Row;pin:()=>void;hasBaseline:boolean;startCompare:()=>void}){
  const {data,error}=useReport(row.id);
  const [query,setQuery]=useState(''),[group,setGroup]=useState(''),[state,setState]=useState('');
  const fields=data?.report.parameters??[];
  const fieldsShown=fields.filter(p=>(!group||p.group===group)&&(!state||p.status===state)&&[p.label,p.key,p.value,p.source,p.note,p.reason,p.errno!=null?'errno='+p.errno:undefined].some(v=>v?.toLowerCase().includes(query.trim().toLowerCase())));
  return <><div className="pane-title"><div><h2>{row.report.model}</h2><code className="report-id">{row.id}</code></div><div className="actions">
    <button type="button" className="secondary" onClick={pin} disabled={!fields.length}>设为基线</button><button onClick={startCompare} disabled={!hasBaseline||!fields.length}>与基线对比</button><button className="secondary" disabled={!data} onClick={()=>data&&saveJson(data)}>下载 JSON</button>
    </div></div>
    {error?<p role="alert" className="error inset">{error}</p>:!data?<p className="empty" aria-live="polite">正在读取报告…</p>:<>
      <div className="meta"><span>{row.batch}</span><span>API {row.report.androidApi||'—'}</span><span>App {row.report.appVersion}</span><span>采集 {date(data.report.capturedAtEpochMs)}</span></div>
      {data.report.feedback&&<p className="feedback"><b>测试反馈：</b>{data.report.feedback}</p>}
      {fields.length?<>
        <div className="tools"><label>搜索参数<input placeholder="数值、来源、errno…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label>分类<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">全部分类</option>{[...new Set(fields.map(p=>p.group))].map(g=><option value={g} key={g}>{groups[g]??g}</option>)}</select></label>
          <label>状态<select value={state} onChange={e=>setState(e.target.value)}><option value="">全部状态</option>{['AVAILABLE','RESTRICTED','UNAVAILABLE','ERROR'].map(v=><option key={v} value={v}>{caption(v)}</option>)}</select></label>
          <span className="muted" aria-live="polite">{fieldsShown.length} / {fields.length} 项</span></div>
        {fieldsShown.length?<div className="table-wrap"><table><thead><tr><th>参数</th><th>采集值</th><th>状态与来源</th></tr></thead><tbody>
          {fieldsShown.map(p=><tr key={parameterKey(p)}><td><strong>{p.label}</strong><small>{groups[p.group]??p.group} · {p.key}</small></td>
            <td className="value">{p.value??'—'}</td><td><Reading p={p}/></td></tr>)}</tbody></table></div>:<p className="empty">没有匹配参数。</p>}
      </>:<div className="empty"><p>旧报告只保存了采集状态。重新上传可取得参数值，也可下载现有 JSON。</p><ul>{(data.report.metrics??[]).map(m=><li key={m.key}>{caption(m.key)} · {caption(m.status)}</li>)}</ul></div>}
    </>}
  </>;
}
function Reading({p}:{p:Parameter}){
  return <><span className={'state '+p.status.toLowerCase()}>{caption(p.status)}{p.reason?' · '+caption(p.reason):''}</span><small><code>{p.source}</code>{p.errno!=null&&<code> · errno={p.errno}</code>}</small>{p.note&&<small>{p.note}</small>}</>;
}

function Compare({left,right,close}:{left:Row;right:Row;close:()=>void}){
  const a=useReport(left.id), b=useReport(right.id);
  const [onlyChanged,setOnlyChanged]=useState(true);
  const [onlySystem,setOnlySystem]=useState(false);
  const result=diffParameters(a.data?.report.parameters??[],b.data?.report.parameters??[]);
  const visible=result.filter(r=>(!onlyChanged||r.changed)&&(!onlySystem||r.group==='system'||r.group==='cpu'));
  return <><div className="pane-title"><div><h2>报告对比</h2></div><button className="secondary" onClick={close}>返回详情</button></div>
    <div className="comparison-head"><div><b>基线</b><strong>{left.report.model}</strong><code>{left.id.slice(0,8)} · {shortDate(left.receivedAt)}</code></div><div><b>当前</b><strong>{right.report.model}</strong><code>{right.id.slice(0,8)} · {shortDate(right.receivedAt)}</code></div></div>
    {a.error||b.error?<p role="alert" className="error inset">{a.error||b.error}</p>:!a.data||!b.data?<p className="empty">正在读取两份报告…</p>:!result.length?<p className="empty">没有可对比的参数值。</p>:<>
      <div className="tools compare-tools"><label><input type="checkbox" checked={onlyChanged} onChange={e=>setOnlyChanged(e.target.checked)}/> 仅看差异</label><label><input type="checkbox" checked={onlySystem} onChange={e=>setOnlySystem(e.target.checked)}/> 仅系统与内核</label><span>{visible.length} 项</span></div>
      <p className="hint inset">变化仅反映两次采样；电量、网络和可用内存会随环境变化。未采集不等于不支持。</p>
      {visible.length?<div className="table-wrap"><table><thead><tr><th>参数</th><th>基线</th><th>当前</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.label}</strong><small>{groups[r.group]??r.group}</small></td>
        {[r.before,r.after].map((p,i)=><td key={i}>{p?<><div className="value">{p.value??'—'}</div><Reading p={p}/></>:<span className="muted">该报告未记录</span>}</td>)}</tr>)}</tbody></table></div>:<p className="empty">当前条件下没有差异。</p>}
    </>}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
