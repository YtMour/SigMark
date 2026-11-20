import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { diffParameters, parameterKey, type Parameter } from './compare';
import { BuildPage, Downloads, SettingsPage, request, RequestError, errorMessage as message } from './console';
import { AssetsWorkspace } from './assets';
import { SecurityPage, securityLink } from './security';
import { BaselineDialog } from './baselines';
import { refreshSeconds, useVisiblePoll } from './live';
import { linkedReportFilters, reportWorkspaceLink, ReportFilterBar, type ReportFilters } from './facets';
import { caption, date, shortDate, groups, saveJson, type Report, type Row, type Page, type Summary, type CoverageGroup } from './reports';
import './style.css';

const sections = [
  {id:'reports', label:'报告档案'},
  {id:'assets', label:'资产管理'},
  {id:'security', label:'指纹安全'},
  {id:'builds', label:'构建中心'},
  {id:'settings', label:'设置'},
  {id:'downloads', label:'应用下载'},
] as const;
type Section = typeof sections[number]['id'];
function readSection(): Section {
  if(location.hash.split('?')[0]==='#stats')return 'assets';
  return sections.find(section => '#' + section.id === location.hash.split('?')[0])?.id ?? 'reports';
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
      section==='settings'?<SettingsPage/>:section==='builds'?<BuildPage/>:
        section==='assets'?<AssetsWorkspace/>:section==='security'?<SecurityPage/>:<Archive/>:
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
  const [filters,setFilters]=useState<ReportFilters>(linkedReportFilters);
  const [pages,setPages]=useState(['']);
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState<Page|null>(null),[summary,setSummary]=useState<Summary|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(true);
  const [linkError,setLinkError]=useState('');
  const [linkLoading,setLinkLoading]=useState(()=>new URLSearchParams(location.hash.split('?')[1]).has('report'));
  const [selected,setSelected]=useState<Row|null>(null),[baseline,setBaseline]=useState<Row|null>(null);
  const [compare,setCompare]=useState(false);
  const [mobileDetail,setMobileDetail]=useState(()=>new URLSearchParams(location.hash.split('?')[1]).has('report'));
  const detailRef=useRef<HTMLElement>(null);
  const listRef=useRef<HTMLElement>(null);
  const scopeRef=useRef(new URLSearchParams(filters).toString());
  const cursor=pages[pages.length-1];
  useVisiblePoll(!cursor&&!busy,async signal=>{
    const params=new URLSearchParams(filters);
    const [page,stats]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<Summary>('/api/admin/summary?'+params,{signal}),
    ]);
    if(!signal.aborted){setData(page);setSummary(stats);setError('');}
  },new URLSearchParams(filters).toString());
  useEffect(()=>{
    let controller:AbortController|undefined;
    function followReportLink(){
      if(location.hash.split('?')[0]!=='#reports')return;
      controller?.abort();
      const params=new URLSearchParams(location.hash.split('?')[1]);
      const id=params.get('report'),directBaseline=params.get('baseline');
      setLinkError('');
      if(!id){setSelected(null);setCompare(false);setMobileDetail(false);setLinkLoading(false);return;}
      setMobileDetail(true);
      if(!/^[0-9a-f-]{36}$/.test(id)){setLinkError('报告编号无效。');setLinkLoading(false);return;}
      setSelected(previous=>previous?.id===id?previous:null);setCompare(false);setLinkLoading(true);
      const requestControl=new AbortController();controller=requestControl;
      request<Report>('/api/admin/reports/'+id,{signal:requestControl.signal})
        .then(async row=>{
          if(requestControl.signal.aborted)return;
          if(row.trashedAt){setLinkError('该报告在回收站。请到资产管理恢复后再查看。');return;}
          setSelected(row);setCompare(false);setMobileDetail(true);
          if(!directBaseline||directBaseline===id||!/^[0-9a-f-]{36}$/.test(directBaseline))return;
          const left=await request<Report>('/api/admin/reports/'+directBaseline,{signal:requestControl.signal});
          if(!requestControl.signal.aborted&&!left.trashedAt){setBaseline(left);setCompare(true);}
        }).catch(err=>{if(!requestControl.signal.aborted)setLinkError(message(err));})
          .finally(()=>{if(!requestControl.signal.aborted)setLinkLoading(false);});
    }
    followReportLink();
    window.addEventListener('hashchange',followReportLink);
    return ()=>{controller?.abort();window.removeEventListener('hashchange',followReportLink);};
  },[]);
  useEffect(()=>{
    const update=()=>{
      if(location.hash.split('?')[0]!=='#reports')return;
      const next=linkedReportFilters();
      const scope=new URLSearchParams(next).toString();
      if(scope!==scopeRef.current){scopeRef.current=scope;setPages(['']);setFilters(next);}
    };
    window.addEventListener('hashchange',update);
    return ()=>window.removeEventListener('hashchange',update);
  },[]);
  useEffect(()=>{
    const controller=new AbortController();setSummary(null);
    request<Summary>('/api/admin/summary?'+new URLSearchParams(filters),{signal:controller.signal})
      .then(row=>{if(!controller.signal.aborted)setSummary(row);}).catch(()=>{});
    return ()=>controller.abort();
  },[filters,revision]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    const params=new URLSearchParams(filters);if(cursor)params.set('before',cursor);
    request<Page>('/api/admin/reports?'+params,{signal:controller.signal})
      .then(page=>{if(!controller.signal.aborted)setData(page);})
      .catch(err=>{if(!controller.signal.aborted){setError(message(err));setData(null);}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[filters,cursor,revision]);
  function filter(next:ReportFilters){
    scopeRef.current=new URLSearchParams(next).toString();
    setBusy(true);setPages(['']);setMobileDetail(false);setFilters(next);setRevision(value=>value+1);
    location.hash=reportWorkspaceLink('reports',next);
  }
  function openReport(row:Row){
    if(selected?.id!==row.id){setSelected(null);setLinkLoading(true);}
    setCompare(false);setMobileDetail(true);
    const target=reportWorkspaceLink('reports',filters);
    location.hash=target+(target.includes('?')?'&':'?')+'report='+row.id;
    requestAnimationFrame(()=>detailRef.current?.focus());
  }
  function backToList(){
    setMobileDetail(false);
    location.hash=reportWorkspaceLink('reports',filters);
    requestAnimationFrame(()=>listRef.current?.focus());
  }
  return <main className={'workspace report-workspace '+(mobileDetail?'report-detail-open':'')}>
    <header className="page-heading collection-heading"><div><p className="eyebrow">报告档案 / 采集分析</p>
      <h1>报告档案库</h1><p className="muted">按设备、ROM 和批次定位报告，查看采集结果及缺项原因。</p></div>
      <div className="archive-facts">
        <div><strong>{summary?.total??'—'}</strong><span>匹配归档记录</span></div>
        <div><strong>{summary?.status.RESTRICTED??(summary?0:'—')}</strong><span>受限字段</span></div>
      </div>
    </header>
    <div className="archive-filters">
    <ReportFilterBar key={filters.q+'\u0000'+filters.batch} filters={filters} apply={filter}>
      <a className="subtle-link" href={reportWorkspaceLink('stats',filters)}>查看字段覆盖 →</a>
      {Object.values(filters).some(Boolean)&&<a className="subtle-link" href={reportWorkspaceLink('assets',filters)}>管理当前筛选 →</a>}
    </ReportFilterBar></div>
    <div className={'workbench archive-workbench '+(mobileDetail?'show-detail':'show-list')}>
      <section className="panel index report-index" aria-label="报告列表" ref={listRef} tabIndex={-1}>
        <div className="pane-title"><h2>采样记录</h2><span className="tag">第 {pages.length} 页</span></div>
        <p className="live-caption">{!refreshSeconds()?'自动刷新已关闭':cursor?'历史页保持当前位置':`首页每 ${refreshSeconds()} 秒同步`}</p>
        {baseline&&<div className="baseline compact-baseline"><span><b>基线</b>{baseline.report.model} · <code>{baseline.id.slice(0,8)}</code></span>
          <button className="secondary" onClick={()=>{setBaseline(null);setCompare(false);}}>移除</button></div>}
        {error&&<p role="alert" className="error inset">{error}</p>}
        {busy?<p className="empty" role="status">正在读取报告…</p>:!error&&!data?.items.length?<p className="empty">没有匹配报告。</p>:null}
        <div className="report-list" aria-busy={busy}>{!busy&&data?.items.map(row=><button className="report-row" type="button" key={row.id}
          aria-pressed={selected?.id===row.id} onClick={()=>openReport(row)}>
          <span className="row-top"><strong>{row.report.model}</strong><span>{shortDate(row.receivedAt)}</span></span>
          <span className="device-dimensions">{[row.report.brand,row.report.device,row.report.android&&'Android '+row.report.android].filter(Boolean).join(' · ')}</span>
          <span className="row-tags"><span>{row.batch}</span><span>API {row.report.androidApi||'—'}</span><span>App {row.report.appVersion}</span><code>{row.id.slice(0,8)}</code></span>
        </button>)}</div>
        <nav className="pages" aria-label="报告分页"><button className="secondary" disabled={busy||pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button><span>每页 30 份</span><button className="secondary" disabled={busy||!data?.nextCursor} onClick={()=>{if(data?.nextCursor)setPages(p=>[...p,data.nextCursor]);}}>下一页</button></nav>
      </section>
      <section className="panel reader" aria-label="报告工作区" ref={detailRef} tabIndex={-1}>
        <button className="mobile-back secondary" onClick={backToList}>返回报告列表</button>
        {linkError?<p role="alert" className="error inset">{linkError}</p>:null}
        {compare&&baseline&&selected?<Compare key={baseline.id+selected.id} left={baseline} right={selected} close={()=>setCompare(false)}/>:selected?
          <Details key={selected.id} row={selected} pin={()=>setBaseline(selected)} isBaseline={baseline?.id===selected.id} hasBaseline={!!baseline&&baseline.id!==selected.id} startCompare={()=>setCompare(true)}/>:
          linkLoading?<p className="empty" role="status">正在打开报告…</p>:!linkError&&<div className="welcome"><h2>选择一份报告</h2>
            <p>查看参数和采集原因，或把报告保存为下一次刷机复测的基线。</p></div>}
      </section>
    </div>
  </main>;
}

function useReport(row:Row){
  const [loaded,setLoaded]=useState<Report|null>(null),[error,setError]=useState('');
  const initial='metrics' in row.report?row as Report:undefined;
  useEffect(()=>{const ctl=new AbortController();
    if(initial)return;
    request<Report>('/api/admin/reports/'+row.id,{signal:ctl.signal}).then(v=>{if(!ctl.signal.aborted)setLoaded(v);}).catch(e=>{if(!ctl.signal.aborted)setError(message(e));});
    return ()=>ctl.abort();
  },[row.id,initial]);
  return {data:initial??loaded,error:initial?'':error};
}
function Details({row,pin,isBaseline,hasBaseline,startCompare}:{row:Row;pin:()=>void;isBaseline:boolean;hasBaseline:boolean;startCompare:()=>void}){
  const {data,error}=useReport(row);
  const [query,setQuery]=useState(''),[group,setGroup]=useState(''),[state,setState]=useState('');
  const [panel,setPanel]=useState<'fields'|'coverage'>('fields');
  const [saveBaseline,setSaveBaseline]=useState(false);
  const [savedId,setSavedId]=useState('');
  const fields=data?.report.parameters??[];
  const fieldsShown=fields.filter(p=>(!group||p.group===group)&&(!state||p.status===state)&&[p.label,p.key,p.value,p.source,p.note,p.reason,p.errno!=null?'errno='+p.errno:undefined].some(v=>v?.toLowerCase().includes(query.trim().toLowerCase())));
  return <><div className="pane-title report-detail-heading"><div><p className="eyebrow">当前报告</p><h2>{row.report.model}</h2><code className="report-id">{row.id}</code></div><div className="actions">
    <button type="button" disabled={!data||!!data.trashedAt} onClick={()=>setSaveBaseline(true)}>保存回归基线</button>
    <a className="subtle-link" href={securityLink(row.id)}>安全分析 →</a>
    <button className="secondary" disabled={!data} onClick={()=>data&&saveJson(data)}>下载 JSON</button>
    </div></div>
    {savedId&&<p className="inset" role="status">已保存回归基线。 <a className="subtle-link" href={'#security?'+new URLSearchParams({baseline:row.id,saved:savedId})}>用这条基线复测 →</a></p>}
    {error?<p role="alert" className="error inset">{error}</p>:!data?<p className="empty" aria-live="polite">正在读取报告…</p>:<>
      <div className="meta"><span>{row.batch}</span><span>API {row.report.androidApi||'—'}</span><span>App {row.report.appVersion}</span>
        <span>{data.report.fieldSetVersion ? `字段集 v${data.report.fieldSetVersion} · 采集器 ${data.report.collectorVersion}` : `历史协议 v${data.report.schemaVersion}`}</span>
        <span>采集 {date(data.report.capturedAtEpochMs)}</span></div>
      {data.report.feedback&&<p className="feedback"><b>测试反馈：</b>{data.report.feedback}</p>}
      {fields.length?<>
        <div className="inspector-tabs" role="group" aria-label="报告视图">
          <button aria-pressed={panel==='fields'} onClick={()=>setPanel('fields')}>参数明细 <b>{fields.length}</b></button>
          <button aria-pressed={panel==='coverage'} onClick={()=>setPanel('coverage')}>手机快照覆盖</button>
          <button type="button" onClick={pin} disabled={isBaseline}>{isBaseline?'已设临时对比基线':'设为临时对比基线'}</button>
          {hasBaseline&&<button type="button" onClick={startCompare}>对比全部参数</button>}
        </div>
        {panel==='coverage'?<SnapshotCoverage rows={data.report.coverage} fields={fields}/>:<>
        <div className="coverage" role="group" aria-label="按采集状态筛选">
          {['AVAILABLE','RESTRICTED','UNAVAILABLE','ERROR'].map(value=><button className="secondary" key={value} aria-pressed={state===value} onClick={()=>setState(state===value?'':value)}>
            <strong>{fields.filter(p=>p.status===value).length}</strong> {caption(value)}
          </button>)}
        </div>
        <div className="tools"><label>搜索参数<input placeholder="数值、来源、errno…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <label>分类<select value={group} onChange={e=>setGroup(e.target.value)}><option value="">全部分类</option>{[...new Set(fields.map(p=>p.group))].map(g=><option value={g} key={g}>{groups[g]??g}</option>)}</select></label>
          <span className="muted" aria-live="polite">{fieldsShown.length} / {fields.length} 项</span></div>
        {fieldsShown.length?<div className="table-wrap"><table className="field-table"><thead><tr><th>参数</th><th>结果与采集依据</th></tr></thead><tbody>
          {fieldsShown.map(p=><tr key={parameterKey(p)}><td><strong>{p.label}</strong><small>{groups[p.group]??p.group}</small><code>{parameterKey(p)}</code></td>
            <td>{p.value!==null&&<div className="value">{p.value}</div>}<Reading p={p}/></td></tr>)}</tbody></table></div>:<p className="empty">没有匹配参数。</p>}
        </>}
      </>:<div className="empty"><p>旧报告只保存了采集状态。重新上传可取得参数值，也可下载现有 JSON。</p><ul>{(data.report.metrics??[]).map(m=><li key={m.key}>{caption(m.key)} · {caption(m.status)}</li>)}</ul></div>}
    </>}
    {saveBaseline&&<BaselineDialog reportId={row.id} model={row.report.model} expectUnlock={false}
      close={()=>setSaveBaseline(false)} saved={id=>{setSavedId(id);setSaveBaseline(false);}}/>}
  </>;
}
function SnapshotCoverage({rows,fields}:{rows?:CoverageGroup[];fields:Parameter[]}){
  if(!rows?.length) return <p className="scope-note muted">旧版报告保存了 {fields.length} 项上传明细。更新 App 后重新采集，可查看新增归档字段和手机快照总数。</p>;
  const count=(row:CoverageGroup)=>row.available+row.restricted+row.unavailable+row.errors;
  const total=rows.reduce((sum,row)=>sum+count(row),0);
  return <div className="snapshot-scope">
    <strong>手机快照 {total} 项 · 归档明细 {fields.length} 项 · 仅本机 {total-fields.length} 项</strong>
    <p className="muted">此表按手机快照计数。归档明细可在「参数明细」中筛选。</p>
    <div className="scope-table"><table><thead><tr><th>分类</th><th>可用</th><th>受限</th><th>暂无数据</th><th>异常</th><th>归档</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.group}><td>{groups[row.group]??row.group}</td><td>{row.available}</td><td>{row.restricted}</td>
        <td>{row.unavailable}</td><td>{row.errors}</td><td>{fields.filter(field=>field.group===row.group).length} / {count(row)}</td></tr>)}</tbody></table></div>
  </div>;
}
function Reading({p}:{p:Parameter}){
  return <><span className={'state '+p.status.toLowerCase()}>{caption(p.status)}{p.reason?' · '+caption(p.reason):''}</span>
    <small><code>{p.source}</code>{p.errno!=null&&<code> · errno={p.errno}</code>}</small>
    {p.note&&<details className="reading-note"><summary>采集说明</summary><small>{p.note}</small></details>}</>;
}

function Compare({left,right,close}:{left:Row;right:Row;close:()=>void}){
  const a=useReport(left), b=useReport(right);
  const [onlyChanged,setOnlyChanged]=useState(true);
  const [onlySystem,setOnlySystem]=useState(false);
  const [includeOmissions,setIncludeOmissions]=useState(true);
  const result=diffParameters(a.data?.report.parameters??[],b.data?.report.parameters??[]);
  const visible=result.filter(r=>(!onlyChanged||r.changed)&&(includeOmissions||r.presence==='both')&&(!onlySystem||r.group==='system'||r.group==='cpu'));
  return <><div className="pane-title"><div><h2>报告对比</h2></div><button className="secondary" onClick={close}>返回详情</button></div>
    <div className="comparison-head"><div><b>基线</b><strong>{left.report.model}</strong><code>App {left.report.appVersion} · {left.id.slice(0,8)}</code></div><div><b>当前</b><strong>{right.report.model}</strong><code>App {right.report.appVersion} · {right.id.slice(0,8)}</code></div></div>
    {a.error||b.error?<p role="alert" className="error inset">{a.error||b.error}</p>:!a.data||!b.data?<p className="empty">正在读取两份报告…</p>:!result.length?<p className="empty">没有可对比的参数值。</p>:<>
      <div className="tools compare-tools"><label><input type="checkbox" checked={onlyChanged} onChange={e=>setOnlyChanged(e.target.checked)}/> 仅看差异</label><label><input type="checkbox" checked={onlySystem} onChange={e=>setOnlySystem(e.target.checked)}/> 仅系统与内核</label><label><input type="checkbox" checked={includeOmissions} onChange={e=>setIncludeOmissions(e.target.checked)}/> 包含未记录字段</label><span>{visible.length} 项</span></div>
      <p className="hint inset">「报告未记录」表示这份归档没有此字段，可能是版本、白名单或采集条件不同。</p>
      {visible.length?<div className="table-wrap"><table><thead><tr><th>参数</th><th>基线</th><th>当前</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.label}</strong><small>{groups[r.group]??r.group}</small></td>
        {[r.before,r.after].map((p,i)=><td key={i}>{p?<><div className="value">{p.value??'—'}</div><Reading p={p}/></>:<span className="state missing">报告未记录</span>}</td>)}</tr>)}</tbody></table></div>:<p className="empty">当前条件下没有差异。</p>}
    </>}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
