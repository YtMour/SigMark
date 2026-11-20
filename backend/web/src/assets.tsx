import { useEffect, useRef, useState } from 'react';
import { request, requestResponse, errorMessage } from './console';
import { caption, date, saveJson, saveDownload, type Page, type Report, type Row } from './reports';
import {emptyReportFilters,linkedReportFilters,reportWorkspaceLink,ReportFacets,withFacet,type ReportFilters} from './facets';
import { refreshSeconds, useVisiblePoll } from './live';
import { RepositoryStats } from './stats';
import { DeviceInventory, AssignDevice, InventorySummary } from './device-assets';
import { securityLink, securityPairLink } from './security';

type View = 'archive' | 'trash';
type Action = 'trash' | 'restore' | 'purge';
const actionNames = {trash:'移入回收站',restore:'恢复报告',purge:'永久删除'};

export function AssetsWorkspace(){
  const hash=()=>location.hash;
  const [route,setRoute]=useState(hash);
  const [inventoryVersion,invalidateInventory]=useState(0);
  const [showDevices,setShowDevices]=useState(route.startsWith('#stats')||route.includes('tab=devices'));
  const deviceSection=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const change=()=>setRoute(hash());
    window.addEventListener('hashchange',change);
    return ()=>window.removeEventListener('hashchange',change);
  },[]);
  const params=new URLSearchParams(route.split('?')[1]);
  const tab=params.get('tab')==='coverage'?'coverage':'reports';
  params.delete('tab');
  params.delete('view');
  const reports='#assets'+(params.size?'?'+params:'');
  const coverage=new URLSearchParams(params);coverage.set('tab','coverage');
  return <main className="workspace assets-workspace">
    <header className="page-heading collection-heading">
      <div><p className="eyebrow">资产管理 / 报告归档</p><h1>资产管理</h1>
        <p className="muted">查看设备与报告的关系、管理留存、分析归档覆盖。</p></div>
      <a className="subtle-link" href="#reports">转到报告档案 →</a>
    </header>
    <InventorySummary revision={inventoryVersion} openDevices={()=>{
      if(tab==='coverage'){
        setShowDevices(true);location.hash='#assets';
      }else{
        setShowDevices(true);deviceSection.current?.querySelector('summary')?.focus();
      }
    }}/>
    <nav aria-label="资产工作区" className="panel asset-tabs">
      <a href={reports} aria-current={tab==='reports'?'page':undefined}>报告与回收站</a>
      <a href={'#assets?'+coverage} aria-current={tab==='coverage'?'page':undefined}>字段覆盖</a>
    </nav>
    {tab==='coverage'?<RepositoryStats key={route}/>:<>
      <details ref={deviceSection} className="panel asset-device-drawer" open={showDevices} onToggle={e=>setShowDevices(e.currentTarget.open)}>
        <summary>按设备查看 <small>同一部手机的历史报告，可选两份对比</small></summary>
        {showDevices&&<DeviceInventory key={inventoryVersion} changed={()=>invalidateInventory(i=>i+1)}/>}
      </details>
      <AssetsPage key={route} changed={()=>invalidateInventory(i=>i+1)}/>
    </>}
  </main>;
}

function AssetsPage({changed}:{changed:()=>void}) {
  const [view]=useState<View>(()=>new URLSearchParams(location.hash.split('?')[1]).get('view')==='trash'?'trash':'archive');
  const [filter]=useState<ReportFilters>(linkedReportFilters);
  const [query,setQuery]=useState(filter.q),[batch,setBatch]=useState(filter.batch);
  const [cursors,setCursors]=useState(['']);
  const [revision,refresh]=useState(0);
  const [page,setPage]=useState<Page>();
  const [totals,setTotals]=useState<Record<View,number>>();
  const [checked,setChecked]=useState<string[]>([]);
  const [pending,setPending]=useState<{action:Action;rows:Row[]}>();
  const [assign,setAssign]=useState<Row[]>();
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [downloadId,setDownloadId]=useState('');
  const [exporting,setExporting]=useState(false);
  const [busy,setBusy]=useState(true);
  const cursor=cursors[cursors.length-1];
  useVisiblePoll(!cursor&&!busy&&!checked.length&&!pending&&!assign&&!exporting,async signal=>{
    const params=new URLSearchParams({...filter,view});
    const [result,archive,trash]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view:'archive'}),{signal}),
      request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view:'trash'}),{signal}),
    ]);
    if(!signal.aborted){setPage(result);setTotals({archive:archive.total,trash:trash.total});setError('');}
  },new URLSearchParams({...filter,view}).toString());
  const selected=page?.items.filter(row=>checked.includes(row.id))??[];
  const securityPair=view==='archive'&&selected.length===2?[...selected].sort((a,b)=>
    (a.report.capturedAtEpochMs??Date.parse(a.receivedAt))-(b.report.capturedAtEpochMs??Date.parse(b.receivedAt))):undefined;
  const all=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(all.current)all.current.indeterminate=selected.length>0&&selected.length!==page?.items.length;},
    [selected.length,page?.items.length]);

  useEffect(()=>{
    const controller=new AbortController();
    const count=(view:View)=>request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view}),
      {signal:controller.signal});
    setTotals(undefined);
    Promise.all([count('archive'),count('trash')]).then(([archive,trash])=>{
      if(!controller.signal.aborted)setTotals({archive:archive.total,trash:trash.total});
    }).catch(()=>{});
    return ()=>controller.abort();
  },[filter,revision]);

  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({...filter,view});
    if(cursor)params.set('before',cursor);
    setBusy(true);setError('');
    request<Page>('/api/admin/reports?'+params,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setPage(data);
    }).catch(error=>{if(!controller.signal.aborted){setError(errorMessage(error));setPage(undefined);}})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[filter,view,cursor,revision]);

  function resetSelection(){setBusy(true);setChecked([]);setCursors(['']);}
  function navigateScope(next:ReportFilters,nextView=view){
    const params=new URLSearchParams(Object.entries(next).filter(([,value])=>value));
    if(nextView==='trash')params.set('view','trash');
    location.hash='#assets'+(params.size?'?'+params:'');
  }
  function switchView(next:View){if(next!==view)navigateScope(filter,next);}
  function propose(action:Action){if(selected.length)setPending({action,rows:selected});}
  function applyFilter(q:string,b:string){
    navigateScope({...filter,q:q.trim(),batch:b.trim()});
  }
  async function exportZip(mode:'selected'|'filtered'){
    setExporting(true);setError('');setNotice('');
    try{
      const response=await requestResponse('/api/admin/reports/export?'+new URLSearchParams({...filter,view}),{
        method:'POST',body:JSON.stringify(mode==='selected'?{mode,ids:selected.map(row=>row.id)}:{mode}),
        signal:AbortSignal.timeout(30000),
      });
      const name=response.headers.get('Content-Disposition')?.match(/filename="(SigMark-reports-[0-9-]+\.zip)"/)?.[1]??'SigMark-reports.zip';
      saveDownload(await response.blob(),name);
      setNotice(`已导出 ${response.headers.get('X-SigMark-Report-Count')??''} 份报告。`);
    }catch(error){setError(errorMessage(error));}
    finally{setExporting(false);}
  }
  async function download(row:Row){
    setDownloadId(row.id);setError('');
    try{saveJson(await request<Report>('/api/admin/reports/'+row.id));}
    catch(error){setError(errorMessage(error));}
    finally{setDownloadId('');}
  }
  return <>
    <div className="asset-view-toggle" role="group" aria-label="资产视图">
      {(['archive','trash'] as const).map(item=><button key={item} type="button" className="asset-state"
        aria-pressed={view===item} onClick={()=>switchView(item)}>
        <strong>{item==='archive'?'在库报告':'回收站'}</strong>
        {Object.values(filter).some(Boolean)&&<span className="tag">{totals?.[item]??'—'} 匹配</span>}
      </button>)}
    </div>
    <section className="panel asset-panel" aria-label="报告资产列表">
      <form className="filters asset-filters" onSubmit={event=>{event.preventDefault();applyFilter(query,batch);}}>
        <label className="main-search">搜索资产<input maxLength={80} value={query} onChange={e=>setQuery(e.target.value)}
          placeholder="型号、ROM / 构建号、报告编号…"/></label>
        <label>批次<input maxLength={32} value={batch} onChange={e=>setBatch(e.target.value)} placeholder="全部批次"/></label>
        <button>查询资产</button>{(filter.q||filter.batch)&&<button className="secondary" type="button" onClick={()=>{
          setQuery('');setBatch('');applyFilter('','');
        }}>清除搜索</button>}
      </form>
      <div className="asset-facet-area"><ReportFacets filters={filter} view={view} select={(key,value)=>{
        navigateScope(withFacet(filter,key,value));
      }}/>{Object.values(filter).some(Boolean)&&<button className="secondary" onClick={()=>{
        navigateScope(emptyReportFilters);
      }}>重置分类和搜索</button>}</div>
      <div className="asset-toolbar">
        <div className="asset-selection"><strong>{busy?'正在读取…':`已选 ${selected.length} / ${page?.items.length??0} 份`}</strong>
          <span>{!refreshSeconds()?'自动刷新已关闭':selected.length?'已暂停刷新，保护当前勾选':cursor?'历史页保持当前位置':`首页每 ${refreshSeconds()} 秒同步`}</span></div>
        <div className="actions">
          <button className="secondary" onClick={()=>{resetSelection();refresh(n=>n+1);}} disabled={busy}>刷新</button>
          {view==='archive'&&<button className="secondary" disabled={busy||!selected.length||selected.some(r=>r.report.assetId)}
            onClick={()=>setAssign(selected)}>归入同一设备</button>}
          {securityPair&&!busy&&<a className="subtle-link" href={securityPairLink(securityPair[0].id,securityPair[1].id)}>对比安全变化 →</a>}
          <button className="secondary" disabled={busy||exporting||!selected.length} onClick={()=>void exportZip('selected')}>导出所选 ZIP</button>
          <button className="secondary" disabled={busy||exporting||!page?.items.length||(totals?.[view]??0)>250}
            onClick={()=>void exportZip('filtered')}>{exporting?'正在打包…':'导出筛选结果 ZIP'}{totals?.[view]!=null?` · ${totals[view]} 份`:''}</button>
          {view==='archive'?<button className="secondary" disabled={busy||!selected.length} onClick={()=>propose('trash')}>移入回收站</button>:<>
            <button disabled={busy||!selected.length} onClick={()=>propose('restore')}>恢复</button>
            <button className="danger" disabled={busy||!selected.length} onClick={()=>propose('purge')}>永久删除</button>
          </>}
        </div>
      </div>
      {(totals?.[view]??0)>250&&<p className="hint inset">匹配超过 250 份。请缩小范围或仅导出本页所选。</p>}
      {notice&&<p className="asset-notice" role="status">{notice}</p>}
      {error&&<p className="error inset" role="alert">{error}</p>}
      {!busy&&!error&&!page?.items.length&&<p className="empty">{view==='trash'?'回收站中没有匹配报告。':'没有匹配的在库报告。'}</p>}
      {!busy&&!!page?.items.length&&<table className="asset-table">
        <thead><tr>
          <th><input type="checkbox" aria-label="选择本页" ref={all} checked={selected.length===page.items.length}
            onChange={e=>setChecked(e.target.checked?page.items.map(row=>row.id):[])}/></th>
          <th>设备 / 报告编号</th><th>批次</th><th>版本</th><th>{view==='trash'?'移入时间':'接收时间'}</th><th>操作</th>
        </tr></thead>
        <tbody>{page.items.map(row=><tr key={row.id} data-selected={checked.includes(row.id)}>
          <td><input type="checkbox" aria-label={`选择 ${row.report.model} ${row.id.slice(0,8)}`} checked={checked.includes(row.id)}
            onChange={e=>setChecked(prev=>e.target.checked?[...prev,row.id]:prev.filter(id=>id!==row.id))}/></td>
          <td><strong>{row.report.model}</strong><small><code>{row.id.slice(0,8)}</code> · {caption(row.report.network)}
            {' · '}{row.report.assetId?<a className="subtle-link" href={'#assets?q=asset%3A'+row.report.assetId}>设备 {row.report.assetId.slice(0,8)}</a>:'未归组'}</small></td>
          <td data-label="批次">{row.batch}</td>
          <td data-label="版本">API {row.report.androidApi||'—'}<small>App {row.report.appVersion}</small></td>
          <td data-label={view==='trash'?'移入时间':'接收时间'}>{date(row.trashedAt??row.receivedAt)}</td>
          <td><div className="actions">{view==='archive'?<>
            <a className="subtle-link" href={'#reports?report='+row.id}>查看报告</a>
            <a className="subtle-link" href={securityLink(row.id)}>安全分析</a>
          </>:
            <button className="secondary" onClick={()=>setPending({action:'restore',rows:[row]})}>恢复此报告</button>}
            <button className="text-button" disabled={!!downloadId} onClick={()=>void download(row)}>{downloadId===row.id?'下载中…':'下载 JSON'}</button>
          </div></td>
        </tr>)}</tbody>
      </table>}
      <div className="inset"><a className="subtle-link" href={reportWorkspaceLink('reports',filter)}>在档案中查看当前筛选 →</a></div>
      <nav className="pages" aria-label="资产分页">
        <button className="secondary" disabled={busy||cursors.length===1} onClick={()=>{setBusy(true);setChecked([]);setCursors(p=>p.slice(0,-1));}}>上一页</button>
        <span>第 {cursors.length} 页 · 每页 30 份</span>
        <button className="secondary" disabled={busy||!page?.nextCursor} onClick={()=>{if(page?.nextCursor){
          setBusy(true);setChecked([]);setCursors(p=>[...p,page.nextCursor]);
        }}}>下一页</button>
      </nav>
    </section>
    {pending&&<Confirm {...pending} close={()=>setPending(undefined)} done={()=>{
      const {rows,action}=pending;
      setPending(undefined);resetSelection();refresh(n=>n+1);
      changed();
      setNotice(`${rows.length} 份报告${action==='trash'?'已移入回收站':action==='restore'?'已恢复':'已永久删除'}。`);
    }}/>}
    {assign&&<AssignDevice rows={assign} close={()=>setAssign(undefined)} done={()=>{
      setAssign(undefined);resetSelection();refresh(n=>n+1);setNotice(`已归组 ${assign.length} 份报告，原始报告均保留。`);
      changed();
    }}/>}
  </>;
}

function Confirm({action,rows,close,done}:{action:Action;rows:Row[];close:()=>void;done:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [confirmation,setConfirmation]=useState('');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{const node=dialog.current;node?.showModal();return ()=>node?.close();},[]);
  return <dialog ref={dialog} aria-labelledby="asset-confirm-title" className="manage-dialog" onCancel={e=>{e.preventDefault();if(!saving)close();}}>
    <form onSubmit={async event=>{
      event.preventDefault();
      if(saving)return;
      setSaving(true);setError('');
      try{
        await request('/api/admin/reports/manage',{method:'POST',body:JSON.stringify({action,ids:rows.map(r=>r.id),confirmation})});
        done();
      }catch(err){setError(errorMessage(err));setSaving(false);}
    }}>
      <h2 id="asset-confirm-title">{actionNames[action]} · {rows.length} 份</h2>
      <p className="muted">{action==='purge'?'报告将从数据库永久移除。':action==='trash'?'报告将从档案隐藏，可在回收站恢复。':'报告将重新出现在档案库。'}</p>
      <ul>{rows.map(row=><li key={row.id}>{row.report.model} · {row.batch} · <code>{row.id.slice(0,8)}</code></li>)}</ul>
      {action==='purge'&&<label>输入 DELETE 确认<input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" disabled={saving} onClick={close}>取消</button>
      <button disabled={saving||(action==='purge'&&confirmation!=='DELETE')} className={action==='purge'?'danger':undefined}>{saving?'处理中…':actionNames[action]}</button></div>
    </form>
  </dialog>;
}
