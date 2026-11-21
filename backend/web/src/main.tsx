import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { diffParameters, type Parameter } from './compare';
import { BuildPage, Downloads, SettingsPage, request, RequestError, errorMessage as message } from './console';
import { AssetsWorkspace } from './assets';
import { SecurityPage } from './security';
import { BaselineDialog } from './baselines';
import { refreshSeconds, useVisiblePoll } from './live';
import { reportWorkspaceLink, type ReportFilters } from './facets';
import { ReportFiltersBar } from './asset-filters';
import {hashParams,reportScope} from './workspace-route';
import {ReaderParameters} from './reader-parameters';
import {listPages,openFromList,navigateReader,returnFromReader,returnLabel,useRestoreList,followReadLink} from './reader-history';
import { caption, date, shortDate, groups, saveJson, type Report, type Page, type CoverageGroup } from './reports';
import {EmptyState,PageHead,WorkspaceNav,workspaces,type Section} from './workspace-ui';
import './style.css';
import './workspace-ui.css';
import './report-reader.css';

function readSection(): Section {
  if(location.hash.split('?')[0]==='#stats')return 'assets';
  return workspaces.find(section => '#' + section.id === location.hash.split('?')[0])?.id ?? 'reports';
}

function App(){
  const [section,setSection]=useState(readSection);
  const [session,setSession]=useState<'checking'|'guest'|'active'|'unavailable'>('checking');
  const [attempt,recheck]=useState(0);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const content=useRef<HTMLDivElement>(null);
  const previousSection=useRef(section);
  useEffect(()=>{
    document.title=(workspaces.find(item=>item.id===section)?.label??'工作台')+' · SigMark 印迹';
    if(previousSection.current===section)return;
    previousSection.current=section;
    window.scrollTo(0,0);
    content.current?.focus({preventScroll:true});
  },[section]);
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
  return <div className="console-shell">
    <a className="skip-workspace" href="#workspace-content" onClick={event=>{event.preventDefault();content.current?.focus();}}>跳到工作区内容</a>
    <WorkspaceNav section={section} active={session==='active'} busy={busy} lock={()=>void lock()}/>
    <div className="workspace-content" id="workspace-content" ref={content} tabIndex={-1}>
    {session==='active'&&error&&<p className="workspace error" role="alert">{error}</p>}
    {section==='downloads'?<Downloads/>:session==='active'?
      section==='settings'?<SettingsPage/>:section==='builds'?<BuildPage/>:
        section==='assets'?<AssetsWorkspace/>:section==='security'?<SecurityPage/>:<Archive/>:
      <main className="workspace"><PageHead section={section} description="通过管理员令牌访问内网工作台。"/><section className="login"><h2>管理员登录</h2>
      {session==='checking'?<p className="muted" role="status">正在检查登录状态…</p>:
        session==='unavailable'?<>
          <p role="alert" className="error">{error}</p>
          <button onClick={()=>{setSession('checking');setError('');recheck(n=>n+1);}}>重试</button>
        </>:<>
          <p className="muted">登录后继续打开当前页面。</p>
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
      </section></main>}
    </div>
  </div>;
}

function Archive(){
  const [hash,setHash]=useState(()=>location.hash);
  const [baseline,setBaseline]=useState<Report|null>(null);
  useEffect(()=>{
    const follow=()=>setHash(location.hash);
    window.addEventListener('hashchange',follow);
    return ()=>window.removeEventListener('hashchange',follow);
  },[]);
  const params=hashParams(hash),filters=reportScope(hash);
  return params.has('report')?<ReportReader key={hash} id={params.get('report')??''} compareId={params.get('baseline')}
    filters={filters} baseline={baseline} pin={setBaseline}/>:
    <ReportIndex key={hash} filters={filters} baseline={baseline} clearBaseline={()=>setBaseline(null)}/>;
}

function ReportIndex({filters,baseline,clearBaseline}:{filters:ReportFilters;baseline:Report|null;clearBaseline:()=>void}){
  const [pages,setPages]=useState(listPages);
  const [revision,setRevision]=useState(0);
  const [data,setData]=useState<Page|null>(null),[total,setTotal]=useState<number>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(true);
  const cursor=pages[pages.length-1];
  useVisiblePoll(!cursor&&!busy,async signal=>{
    const params=new URLSearchParams(filters);
    const [page,stats]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<{total:number}>('/api/admin/report-count?'+params,{signal}),
    ]);
    if(!signal.aborted){setData(page);setTotal(stats.total);setError('');}
  },new URLSearchParams(filters).toString());
  useRestoreList(!busy&&!!data);
  useEffect(()=>{
    const controller=new AbortController();setTotal(undefined);
    request<{total:number}>('/api/admin/report-count?'+new URLSearchParams(filters),{signal:controller.signal})
      .then(row=>{if(!controller.signal.aborted)setTotal(row.total);}).catch(()=>{});
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
    const target=reportWorkspaceLink('reports',next);
    if(location.hash===target){setRevision(value=>value+1);setPages(['']);}
    else location.hash=target;
  }
  return <main className="workspace report-workspace archive-browse">
    <PageHead section="reports" className="archive-heading" description="查找采样，查看参数和采集依据。">
      <span className="workspace-badge">{total===undefined?'报告归档':`${total.toLocaleString('zh-CN')} 份匹配报告`}</span>
    </PageHead>
    <div className="panel archive-filters">
      <ReportFiltersBar filters={filters} apply={filter}>
        <div className="archive-scope-actions">
          <a className="subtle-link" href={reportWorkspaceLink('stats',filters)}>查看字段覆盖</a>
          <a className="subtle-link" href={reportWorkspaceLink('assets',filters,{view:'archive'})}>管理当前结果</a>
        </div>
      </ReportFiltersBar>
    </div>
    <section className="panel report-index" aria-label="报告列表">
        <div className="pane-title"><div><h2>采样记录</h2><small>{!refreshSeconds()?'自动刷新已关闭':cursor?'历史页保持当前位置':`首页每 ${refreshSeconds()} 秒同步`}</small></div>
          <button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(value=>value+1)}>刷新</button></div>
        {baseline&&<div className="baseline compact-baseline"><span><b>基线</b>{baseline.report.model} · <code>{baseline.id.slice(0,8)}</code></span>
          <button className="secondary" onClick={clearBaseline}>移除</button></div>}
        {error&&<p role="alert" className="error inset">{error}</p>}
        {busy?<EmptyState title="正在读取报告…" loading/>:!error&&!data?.items.length?<EmptyState title="没有匹配报告">试试调整或清除上方筛选条件。</EmptyState>:null}
        <ul className="report-list" aria-busy={busy}>{!busy&&data?.items.map(row=><li key={row.id}><a className="report-row"
          id={'archive-read-'+row.id} onClick={e=>openFromList(e,pages,'返回报告列表')} href={reportWorkspaceLink('reports',filters,{report:row.id})}>
          <span className="row-top"><strong>{row.report.model}</strong><span>{shortDate(row.receivedAt)}</span></span>
          <span className="device-dimensions">{[row.report.brand,row.report.device,row.report.android&&'Android '+row.report.android].filter(Boolean).join(' · ')}</span>
          <span className="row-tags"><span>{row.batch}</span><span>API {row.report.androidApi||'—'}</span><span>App {row.report.appVersion}</span><code>{row.id.slice(0,8)}</code></span>
        </a></li>)}</ul>
        <nav className="pages" aria-label="报告分页"><button className="secondary" disabled={busy||pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button><span>第 {pages.length} 页 · 每页 30 份</span><button className="secondary" disabled={busy||!data?.nextCursor} onClick={()=>{if(data?.nextCursor)setPages(p=>[...p,data.nextCursor]);}}>下一页</button></nav>
      </section>
  </main>;
}

class ReportReadError extends Error {}

function ReportReader({id,compareId,filters,baseline,pin}:{
  id:string;compareId:string|null;filters:ReportFilters;baseline:Report|null;pin:(row:Report)=>void;
}){
  const [row,setRow]=useState<Report>(),[left,setLeft]=useState<Report>(),[error,setError]=useState('');
  const frame=useRef<HTMLElement>(null);
  useEffect(()=>{
    const ctl=new AbortController();
    frame.current?.focus({preventScroll:true});window.scrollTo(0,0);
    async function get(key:string){
      if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))throw new ReportReadError('报告编号无效。');
      const data=await request<Report>('/api/admin/reports/'+key,{signal:ctl.signal});
      if(data.trashedAt)throw new ReportReadError('报告在回收站，请先到资产管理恢复。');
      return data;
    }
    (async()=>{
      const report=await get(id);
      if(ctl.signal.aborted)return;
      setRow(report);
      if(compareId&&compareId!==id){
        const reference=await get(compareId);
        if(!ctl.signal.aborted)setLeft(reference);
      }
    })().catch(err=>{if(!ctl.signal.aborted)setError(err instanceof ReportReadError?err.message:message(err));});
    return ()=>ctl.abort();
  },[id,compareId]);
  return <main className="workspace reading-workspace" ref={frame} tabIndex={-1} aria-label="报告工作区">
    <header className="reading-header"><button type="button" className="secondary reader-return"
      onClick={()=>returnFromReader(reportWorkspaceLink('reports',filters))}>{returnLabel()}</button>
      <div><p className="eyebrow">{compareId&&compareId!==id&&!error?'参数对照':'采样报告'}</p><h1>{row?.report.model??'报告详情'}</h1></div>
      {row&&<p className="reading-identity">API {row.report.androidApi||'—'} · App {row.report.appVersion}<br/>采样 {date(row.report.capturedAtEpochMs)}</p>}
    </header>
    {error&&<p className="panel error inset" role="alert">{error}</p>}
    {left&&row?<section className="panel"><Compare left={left} right={row} close={()=>navigateReader(reportWorkspaceLink('reports',filters,{report:id}))}/></section>:
      row&&(!compareId||compareId===id||error)?<Details row={row} filters={filters} pin={()=>pin(row)}
        isBaseline={baseline?.id===row.id} hasBaseline={!!baseline&&baseline.id!==row.id}
        startCompare={()=>baseline&&navigateReader(reportWorkspaceLink('reports',filters,{report:id,baseline:baseline.id}))}/>:
      !error&&<EmptyState title="正在打开报告…" loading/>}
  </main>;
}

function Details({row,filters,pin,isBaseline,hasBaseline,startCompare}:{row:Report;filters:ReportFilters;pin:()=>void;isBaseline:boolean;hasBaseline:boolean;startCompare:()=>void}){
  const [panel,setPanel]=useState<'fields'|'coverage'>('fields');
  const [saveBaseline,setSaveBaseline]=useState(false);
  const [savedId,setSavedId]=useState('');
  const fields=row.report.parameters??[];
  return <>
    <div className="reading-actions actions">
      <a className="primary-link" onClick={followReadLink} href={reportWorkspaceLink('security',filters,{report:row.id,retest:true})}>与基线复测 →</a>
      <a className="subtle-link" onClick={followReadLink} href={reportWorkspaceLink('security',filters,{report:row.id})}>单份安全分析</a>
      <details className="report-options"><summary>更多报告操作</summary><div className="actions">
        <button className="secondary" onClick={()=>setSaveBaseline(true)}>保存回归基线</button>
        <button className="secondary" onClick={()=>saveJson(row)}>下载 JSON</button>
        {!!fields.length&&<button className="secondary" onClick={pin} disabled={isBaseline}>{isBaseline?'已设临时对比基线':'设为临时对比基线'}</button>}
        {hasBaseline&&<button className="secondary" onClick={startCompare}>对比全部参数</button>}
        <small>批次 {row.batch} · {row.report.fieldSetVersion?`字段集 v${row.report.fieldSetVersion} · 采集器 ${row.report.collectorVersion??'未记录'}`:`历史协议 v${row.report.schemaVersion}`} · 编号 <code>{row.id}</code></small>
      </div></details>
    </div>
    {savedId&&<p className="inset" role="status">已保存回归基线。 <a className="subtle-link" href={reportWorkspaceLink('security',filters,{baseline:row.id,saved:savedId,retest:true})}>用这条基线复测 →</a></p>}
    {row.report.feedback&&<p className="feedback"><b>测试反馈：</b>{row.report.feedback}</p>}
    <section className="panel reading-panel">
      <div className="inspector-tabs" role="group" aria-label="报告视图">
        <button aria-pressed={panel==='fields'} onClick={()=>setPanel('fields')}>归档参数 · {fields.length} 项</button>
        <button aria-pressed={panel==='coverage'} onClick={()=>setPanel('coverage')}>手机快照覆盖</button>
      </div>
      <div hidden={panel!=='fields'}>{fields.length?<ReaderParameters fields={fields}/>:
        <div className="empty">{row.report.schemaVersion===1?'旧报告只保存了采集状态，没有归档参数值。':'这份报告没有归档参数明细。'}
        <ul>{(row.report.metrics??[]).map(m=><li key={m.key}>{caption(m.key)} · {caption(m.status)}</li>)}</ul></div>}</div>
      {panel==='coverage'&&<SnapshotCoverage rows={row.report.coverage} fields={fields}/>}
    </section>
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
    <p className="muted">此表按手机快照计数。切换到「归档参数」可筛选有明细的字段。</p>
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

function Compare({left,right,close}:{left:Report;right:Report;close:()=>void}){
  const [onlyChanged,setOnlyChanged]=useState(true);
  const [onlySystem,setOnlySystem]=useState(false);
  const [includeOmissions,setIncludeOmissions]=useState(true);
  const result=diffParameters(left.report.parameters??[],right.report.parameters??[]);
  const visible=result.filter(r=>(!onlyChanged||r.changed)&&(includeOmissions||r.presence==='both')&&(!onlySystem||r.group==='system'||r.group==='cpu'));
  return <><div className="pane-title"><div><h2>报告对比</h2></div><button className="secondary" onClick={close}>返回详情</button></div>
    <div className="comparison-head"><div><b>基线</b><strong>{left.report.model}</strong><code>App {left.report.appVersion} · {left.id.slice(0,8)}</code></div><div><b>当前</b><strong>{right.report.model}</strong><code>App {right.report.appVersion} · {right.id.slice(0,8)}</code></div></div>
    {!result.length?<p className="empty">没有可对比的参数值。</p>:<>
      <div className="tools compare-tools"><label><input type="checkbox" checked={onlyChanged} onChange={e=>setOnlyChanged(e.target.checked)}/> 仅看差异</label><label><input type="checkbox" checked={onlySystem} onChange={e=>setOnlySystem(e.target.checked)}/> 仅系统与内核</label><label><input type="checkbox" checked={includeOmissions} onChange={e=>setIncludeOmissions(e.target.checked)}/> 包含未记录字段</label><span>{visible.length} 项</span></div>
      <p className="hint inset">「报告未记录」表示这份归档没有此字段，可能是版本、白名单或采集条件不同。</p>
      {visible.length?<div className="table-wrap"><table><thead><tr><th>参数</th><th>基线</th><th>当前</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.label}</strong><small>{groups[r.group]??r.group}</small></td>
        {[r.before,r.after].map((p,i)=><td key={i}>{p?<><div className="value">{p.value??'—'}</div><Reading p={p}/></>:<span className="state missing">报告未记录</span>}</td>)}</tr>)}</tbody></table></div>:<p className="empty">当前条件下没有差异。</p>}
    </>}
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
