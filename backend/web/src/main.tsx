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
import { identityConflictsOf } from './security-rules';
import {ObservationPanel} from './observation-panel';
import {ReportRecoveredPanel} from './report-recovered-panel';
import {AcceptancePanel} from './acceptance-panel';
import {LabPage} from './lab';
import {ReportFlow} from './report-flow';
import {listPages,openFromList,navigateReader,returnFromReader,returnLabel,useRestoreList} from './reader-history';
import { caption, date, shortDate, groups, saveJson, type Report, type Page, type CoverageGroup } from './reports';
import {EmptyState,PageHead,WorkspaceNav,workspaces,type Section} from './workspace-ui';
import './style.css';
import './workspace-ui.css';
import './report-reader.css';
import './console-design.css';

function readSection(): Section {
  if(['#stats','#identity'].includes(location.hash.split('?')[0]))return 'assets';
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
        section==='assets'?<AssetsWorkspace/>:section==='security'?<SecurityPage/>:section==='lab'?<LabPage/>:<Archive/>:
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
  const filterFocus=useRef<{hash:string;key:string}|undefined>(undefined);
  useEffect(()=>{
    const follow=()=>setHash(location.hash);
    window.addEventListener('hashchange',follow);
    return ()=>window.removeEventListener('hashchange',follow);
  },[]);
  useEffect(()=>{
    const target=filterFocus.current;
    if(!target)return;
    filterFocus.current=undefined;
    if(target.hash!==hash)return;
    document.querySelector<HTMLSelectElement>(`.archive-filters [data-facet="${target.key}"]`)?.focus({preventScroll:true});
  },[hash]);
  const params=hashParams(hash),filters=reportScope(hash);
  return params.has('report')?<ReportReader key={hash} id={params.get('report')??''} compareId={params.get('baseline')}
    filters={filters} baseline={baseline} pin={setBaseline}/>:
    <ReportIndex key={hash} filters={filters} baseline={baseline} clearBaseline={()=>setBaseline(null)}
      rememberFilter={(nextHash,key)=>{filterFocus.current={hash:nextHash,key};}}/>;
}

function ReportIndex({filters,baseline,clearBaseline,rememberFilter}:{
  filters:ReportFilters;baseline:Report|null;clearBaseline:()=>void;rememberFilter:(hash:string,key:string)=>void;
}){
  const [pages,setPages]=useState(listPages);
  const [revision,setRevision]=useState(0);
  const [loaded,setLoaded]=useState<{cursor:string;page:Page}>(),[total,setTotal]=useState<number>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(true);
  const cursor=pages[pages.length-1];
  const data=loaded?.cursor===cursor?loaded.page:undefined;
  const refreshInterval=refreshSeconds();
  useVisiblePoll(!cursor&&!busy,async signal=>{
    const params=new URLSearchParams(filters);
    const [page,stats]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<{total:number}>('/api/admin/report-count?'+params,{signal}),
    ]);
    if(!signal.aborted){setLoaded({cursor,page});setTotal(stats.total);setError('');}
  },new URLSearchParams(filters).toString());
  useRestoreList(!busy&&!!data);
  useEffect(()=>{
    const controller=new AbortController();
    request<{total:number}>('/api/admin/report-count?'+new URLSearchParams(filters),{signal:controller.signal})
      .then(row=>{if(!controller.signal.aborted)setTotal(row.total);}).catch(()=>{});
    return ()=>controller.abort();
  },[filters,revision]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    const params=new URLSearchParams(filters);if(cursor)params.set('before',cursor);
    request<Page>('/api/admin/reports?'+params,{signal:controller.signal})
      .then(page=>{if(!controller.signal.aborted)setLoaded({cursor,page});})
      .catch(err=>{if(!controller.signal.aborted)setError(message(err));})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[filters,cursor,revision]);
  function filter(next:ReportFilters,focusKey?:string){
    const target=reportWorkspaceLink('reports',next);
    if(location.hash===target){setRevision(value=>value+1);setPages(['']);}
    else {
      if(focusKey)rememberFilter(target,focusKey);
      location.hash=target;
    }
  }
  return <main className="workspace report-workspace archive-browse">
    <PageHead section="reports" className="archive-heading">
      <a className="button-link secondary" href={reportWorkspaceLink('assets',filters,{view:'archive'})}>管理当前结果 <span aria-hidden="true">→</span></a>
    </PageHead>
    <div className="panel archive-filters">
      <ReportFiltersBar filters={filters} apply={filter} applyFacet={filter}>
        <div className="archive-scope-actions">
          <a className="subtle-link" href={reportWorkspaceLink('stats',filters)}>查看字段覆盖</a>
        </div>
      </ReportFiltersBar>
    </div>
    <section className="panel report-index" aria-label="报告列表">
        <div className="pane-title archive-list-head">
          <div role="status">{total===undefined?(data?`本页 ${data.items.length} 份`:''):`${total.toLocaleString('zh-CN')} 份报告`}</div>
          <div className="archive-sync">
            <button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(value=>value+1)}>{busy&&data?'刷新中…':'刷新'}</button></div></div>
        {baseline&&<div className="baseline compact-baseline"><span><b>基线</b>{baseline.report.model} · {baseline.report.capturedAtEpochMs>0?
          date(baseline.report.capturedAtEpochMs):'入库 '+date(baseline.receivedAt)}</span>
          <button className="secondary" onClick={clearBaseline}>移除</button></div>}
        {error&&<p role="alert" className="error inset">{error}</p>}
        {busy&&!data?<EmptyState title="正在读取报告…" loading/>:!error&&!data?.items.length?<EmptyState title="没有匹配报告">试试调整或清除上方筛选条件。</EmptyState>:null}
        {!!data?.items.length&&<div className="archive-columns" aria-hidden="true"><span>设备</span><span>批次</span><span>采样时间</span></div>}
        {/* Old reports may only have an intake time. Label the fallback so it is not read as capture time. */}
        <ul className="report-list" aria-busy={busy}>{data?.items.map(row=>{
          const capturedAt=row.report.capturedAtEpochMs;
          const hasCaptureTime=typeof capturedAt==='number'&&capturedAt>0;
          const time=hasCaptureTime?new Date(capturedAt).toISOString():row.receivedAt;
          return <li key={row.id}><a className="report-row"
          id={'archive-read-'+row.id} onClick={e=>openFromList(e,pages,'返回报告列表')} href={reportWorkspaceLink('reports',filters,{report:row.id})}>
          <span className="archive-device"><strong>{row.report.model}</strong>
            <span className="device-dimensions">{[row.report.brand,row.report.android&&'Android '+row.report.android].filter(Boolean).join(' · ')}</span></span>
          <span className="archive-batch">{row.batch}</span>
          <span className="archive-time"><time dateTime={time}>{hasCaptureTime?'':'入库 '}{shortDate(time)}</time></span>
          <span className="archive-arrow" aria-hidden="true">›</span>
        </a></li>})}</ul>
        <nav className="pages" aria-label="报告分页"><button className="secondary" disabled={busy||pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button><span>第 {pages.length} 页</span><button className="secondary" disabled={busy||!data?.nextCursor} onClick={()=>{if(data?.nextCursor)setPages(p=>[...p,data.nextCursor]);}}>下一页</button></nav>
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
    {row?<ReportFlow report={row} view="report"/>:
      <header className="reading-header"><h1>报告详情</h1><button type="button" className="secondary reader-return"
        onClick={()=>returnFromReader(reportWorkspaceLink('reports',filters))}>{returnLabel()}</button></header>}
    {error&&<p className="panel error inset" role="alert">{error}</p>}
    {left&&row?<section className="panel"><Compare left={left} right={row} close={()=>navigateReader(reportWorkspaceLink('reports',filters,{report:id}))}/></section>:
      row&&(!compareId||compareId===id||error)?<Details row={row} filters={filters} pin={()=>pin(row)}
        isBaseline={baseline?.id===row.id} hasBaseline={!!baseline&&baseline.id!==row.id}
        startCompare={()=>baseline&&navigateReader(reportWorkspaceLink('reports',filters,{report:id,baseline:baseline.id}))}/>:
      !error&&<EmptyState title="正在打开报告…" loading/>}
  </main>;
}

function IdentityNotice({fields}:{fields:Parameter[]}){
  const conflicts=identityConflictsOf(fields);
  if(!conflicts.length)return null;
  return <section className="panel identity-notice" role="status" aria-label="身份声明不一致">
    <h2>身份声明不一致</h2>
    <p>本次 App 采集的{conflicts.map(pair=>pair.title).join('、')}读数不一致；建议复采，不据此判定设备真伪。</p>
    <details><summary>查看读数</summary><ul>{conflicts.map(pair=><li key={pair.leftKey+pair.rightKey}>
      {pair.title}：<code>{pair.leftKey}</code> = <strong>{pair.left}</strong>{' ≠ '}<code>{pair.rightKey}</code> = <strong>{pair.right}</strong>
    </li>)}</ul></details>
    <a className="subtle-link" href="#assets?tab=identity">查看全库身份分布 →</a>
  </section>;
}

function Details({row,filters,pin,isBaseline,hasBaseline,startCompare}:{row:Report;filters:ReportFilters;pin:()=>void;isBaseline:boolean;hasBaseline:boolean;startCompare:()=>void}){
  const [panel,setPanel]=useState<'fields'|'coverage'|'followup'|'context'>('fields');
  const [saveBaseline,setSaveBaseline]=useState(false);
  const [savedId,setSavedId]=useState('');
  const fields=row.report.parameters??[];
  return <>
    <div className="reading-actions actions">
      <button className="secondary" type="button" onClick={()=>saveJson(row)}>下载 JSON</button>
      <details className="report-options"><summary>基线与参数对比</summary><div className="actions">
        <button className="secondary" onClick={()=>setSaveBaseline(true)}>保存回归基线</button>
        {!!fields.length&&<button className="secondary" onClick={pin} disabled={isBaseline}>{isBaseline?'已设临时对比基线':'设为临时对比基线'}</button>}
        {hasBaseline&&<button className="secondary" onClick={startCompare}>对比全部参数</button>}
      </div></details>
    </div>
    {savedId&&<p className="inset" role="status">已保存回归基线。 <a className="subtle-link" href={reportWorkspaceLink('security',filters,{baseline:row.id,saved:savedId,retest:true})}>用这条基线复测 →</a></p>}
    <IdentityNotice fields={fields}/>
    <section className="panel reading-panel">
      <div className="inspector-tabs" role="group" aria-label="报告视图">
        <button aria-pressed={panel==='fields'} onClick={()=>setPanel('fields')}>归档参数 · {fields.length} 项</button>
        <button aria-pressed={panel==='coverage'} onClick={()=>setPanel('coverage')}>手机快照覆盖</button>
        <button aria-pressed={panel==='followup'} onClick={()=>setPanel('followup')}>缺项与补充证据</button>
        <button aria-pressed={panel==='context'} onClick={()=>setPanel('context')}>采样条件</button>
      </div>
      <div hidden={panel!=='fields'}>{fields.length?<ReaderParameters fields={fields} fieldSet={row.report.fieldSetVersion??0} capturedAt={row.report.capturedAtEpochMs}/>:
        <div className="empty">{row.report.schemaVersion===1?'旧报告只保存了采集状态，没有归档参数值。':'这份报告没有归档参数明细。'}
        <ul>{(row.report.metrics??[]).map(m=><li key={m.key}>{caption(m.key)} · {caption(m.status)}</li>)}</ul></div>}</div>
      {panel==='coverage'&&<SnapshotCoverage rows={row.report.coverage} fields={fields}/>}
      {panel==='followup'&&<ObservationPanel key={row.id} report={row} showGaps/>}
      {panel==='context'&&<div className="reader-context">
        <dl className="release-data">
          <dt>采样时间</dt><dd>{row.report.capturedAtEpochMs>0?date(row.report.capturedAtEpochMs):'未记录'}</dd>
          <dt>入库时间</dt><dd>{date(row.receivedAt)}</dd>
          <dt>批次</dt><dd>{row.batch}</dd>
          <dt>采样网络</dt><dd>{caption(row.report.network)}</dd>
          <dt>App 版本</dt><dd>{row.report.appVersion||'未记录'}</dd>
        </dl>
        <details>
          <summary>报告技术详情</summary>
          <dl className="release-data">
            <dt>Android API</dt><dd>{row.report.androidApi||'未记录'}</dd>
            <dt>采集器</dt><dd>{row.report.collectorVersion??'未记录'}</dd>
            <dt>字段集</dt><dd>{row.report.fieldSetVersion?`v${row.report.fieldSetVersion}`:'未记录'}</dd>
            <dt>报告编号</dt><dd><code>{row.id}</code></dd>
          </dl>
        </details>
        {row.report.feedback&&<p><b>测试反馈：</b>{row.report.feedback}</p>}
        <ReportRecoveredPanel fields={fields}/>
        {(row.report.fieldSetVersion??0)>=9&&<AcceptancePanel row={row}/>}
      </div>}
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
