import { useEffect, useRef, useState } from 'react';
import { request, requestResponse, errorMessage } from './console';
import { caption, date, saveJson, saveDownload, type Page, type Report, type Row } from './reports';
import {linkedReportFilters,reportWorkspaceLink,type ReportFilters} from './facets';
import {ReportFiltersBar} from './asset-filters';
import { refreshSeconds, useVisiblePoll } from './live';
import { RepositoryStats } from './stats';
import { DeviceInventory, AssignDevice, InventorySummary } from './device-assets';
import {assetTab,hashParams} from './workspace-route';
import {listPages,openFromList,useRestoreList} from './reader-history';
import {EmptyState,PageHead,WorkspaceTabs} from './workspace-ui';

type View = 'archive' | 'trash';
type Action = 'trash' | 'restore' | 'purge';
const actionNames = {trash:'移入回收站',restore:'恢复报告',purge:'永久删除'};

export function AssetsWorkspace(){
  const hash=()=>location.hash;
  const [route,setRoute]=useState(hash);
  const [inventoryVersion,invalidateInventory]=useState(0);
  useEffect(()=>{
    const change=()=>setRoute(hash());
    window.addEventListener('hashchange',change);
    return ()=>window.removeEventListener('hashchange',change);
  },[]);
  const tab=assetTab(route);
  const filters=linkedReportFilters();
  const reports=reportWorkspaceLink('assets',filters,{view:'archive'});
  const coverage=reportWorkspaceLink('stats',filters);
  return <main className="workspace assets-workspace">
    <PageHead section="assets" description="按手机管理归档、批量导出或恢复报告。">
      <a className="button-link secondary" href={reportWorkspaceLink('reports',tab==='devices'?undefined:filters)}>查看报告档案 →</a>
    </PageHead>
    <InventorySummary revision={inventoryVersion}/>
    <WorkspaceTabs label="资产工作区" items={[
      {label:'设备档案',href:reportWorkspaceLink('assets'),active:tab==='devices'},
      {label:'在库报告',href:reports,active:tab==='reports'},
      {label:'字段覆盖',href:tab==='coverage'?route:coverage,active:tab==='coverage'},
      {label:'回收站',href:reportWorkspaceLink('assets',filters,{view:'trash'}),active:tab==='trash'},
    ]}/>
    {tab==='coverage'?<RepositoryStats key={route}/>:tab==='devices'?
      <DeviceInventory sampleAsset={hashParams(route).get('sampleAsset')??''} changed={()=>invalidateInventory(i=>i+1)}/>:
      <AssetsPage key={route} view={tab==='trash'?'trash':'archive'} changed={()=>invalidateInventory(i=>i+1)}/>}
  </main>;
}

function AssetsPage({view,changed}:{view:View;changed:()=>void}) {
  const [filter]=useState<ReportFilters>(linkedReportFilters);
  const [cursors,setCursors]=useState(listPages);
  const [revision,refresh]=useState(0);
  const [page,setPage]=useState<Page>();
  const [total,setTotal]=useState<number>();
  const [checked,setChecked]=useState<string[]>([]);
  const [pending,setPending]=useState<{action:Action;rows:Row[]}>();
  const [assign,setAssign]=useState<Row[]>();
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [downloadId,setDownloadId]=useState('');
  const [exporting,setExporting]=useState(false);
  const [busy,setBusy]=useState(true);
  const cursor=cursors[cursors.length-1];
  useRestoreList(!busy&&!!page);
  useVisiblePoll(!cursor&&!busy&&!checked.length&&!pending&&!assign&&!exporting,async signal=>{
    const params=new URLSearchParams({...filter,view});
    const [result,count]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<{total:number}>('/api/admin/report-count?'+params,{signal}),
    ]);
    if(!signal.aborted){setPage(result);setTotal(count.total);setError('');}
  },new URLSearchParams({...filter,view}).toString());
  const selected=page?.items.filter(row=>checked.includes(row.id))??[];
  const securityPair=view==='archive'&&selected.length===2?[...selected].sort((a,b)=>
    (a.report.capturedAtEpochMs??Date.parse(a.receivedAt))-(b.report.capturedAtEpochMs??Date.parse(b.receivedAt))):undefined;
  const all=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(all.current)all.current.indeterminate=selected.length>0&&selected.length!==page?.items.length;},
    [selected.length,page?.items.length]);

  useEffect(()=>{
    const controller=new AbortController();
    request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view}),{signal:controller.signal})
      .then(count=>{if(!controller.signal.aborted)setTotal(count.total);}).catch(()=>{});
    return ()=>controller.abort();
  },[filter,view,revision]);

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
    location.hash=reportWorkspaceLink('assets',next,{view:nextView});
  }
  function propose(action:Action){if(selected.length)setPending({action,rows:selected});}
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
    <section className="panel asset-panel" aria-label="报告资产列表">
      <div className="pane-title"><div><h2>{view==='trash'?'回收站':'在库报告'}</h2>
        <small>{total!=null?`${total} 份匹配报告`:'按当前筛选查询'}</small></div>
        <div className="actions">
          <button className="secondary" onClick={()=>{resetSelection();refresh(n=>n+1);}} disabled={busy||!!checked.length}>刷新</button>
          <button className="secondary" disabled={busy||exporting||!page?.items.length||(total??0)>250}
            onClick={()=>void exportZip('filtered')}>{exporting?'正在打包…':'导出筛选结果 ZIP'}</button>
        </div>
      </div>
      <ReportFiltersBar filters={filter} view={view} apply={navigateScope}/>
      <div className="asset-toolbar" data-selection={selected.length>0}>
        <div className="asset-selection">
          {(busy||selected.length>0)&&<strong>{busy?'正在读取…':`本页已选 ${selected.length} 份`}</strong>}
          <span>{selected.length?'已暂停刷新，保护当前勾选':!refreshSeconds()?'自动刷新已关闭':cursor?'历史页保持当前位置':`首页每 ${refreshSeconds()} 秒同步`}</span></div>
        {selected.length>0&&<div className="actions" role="group" aria-label="所选报告操作">
          {view==='archive'&&<button className="secondary" disabled={busy||!selected.length||selected.some(r=>r.report.assetId)}
            onClick={()=>setAssign(selected)}>归入同一设备</button>}
          {securityPair&&!busy&&<a className="subtle-link" href={reportWorkspaceLink('security',filter,{baseline:securityPair[0].id,report:securityPair[1].id,retest:true})}>对比安全变化 →</a>}
          <button className="secondary" disabled={busy||exporting||!selected.length} onClick={()=>void exportZip('selected')}>导出所选 ZIP</button>
          {view==='archive'?<button className="secondary" disabled={busy||!selected.length} onClick={()=>propose('trash')}>移入回收站</button>:<>
            <button disabled={busy||!selected.length} onClick={()=>propose('restore')}>恢复</button>
            <button className="danger" disabled={busy||!selected.length} onClick={()=>propose('purge')}>永久删除</button>
          </>}
          <button type="button" className="text-button" onClick={()=>setChecked([])}>取消选择</button>
        </div>}
      </div>
      {(total??0)>250&&<p className="hint inset">单次导出上限为 250 份。请缩小范围或仅导出本页所选。</p>}
      {notice&&<p className="asset-notice" role="status">{notice}</p>}
      {error&&<p className="error inset" role="alert">{error}</p>}
      {!busy&&!error&&!page?.items.length&&<EmptyState title={view==='trash'?'回收站中没有匹配报告':'没有匹配的在库报告'}>试试调整上方筛选条件。</EmptyState>}
      {!busy&&!!page?.items.length&&<div className="asset-table-frame"><table className="asset-table">
        <thead><tr>
          <th scope="col"><input type="checkbox" aria-label="选择本页" ref={all} checked={selected.length===page.items.length}
            onChange={e=>setChecked(e.target.checked?page.items.map(row=>row.id):[])}/></th>
          <th scope="col">设备 / 报告编号</th><th scope="col">批次</th><th scope="col">版本</th>
          <th scope="col">{view==='trash'?'移入时间':'接收时间'}</th><th scope="col">操作</th>
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
            <a id={'asset-read-'+row.id} className="subtle-link" onClick={e=>openFromList(e,cursors,'返回资产管理')}
              href={reportWorkspaceLink('reports',filter,{report:row.id})}>查看报告</a>
            <a className="subtle-link" href={reportWorkspaceLink('security',filter,{report:row.id})}>安全分析</a>
          </>:
            <button className="secondary" onClick={()=>setPending({action:'restore',rows:[row]})}>恢复此报告</button>}
            <button className="text-button" disabled={!!downloadId} onClick={()=>void download(row)}>{downloadId===row.id?'下载中…':'下载 JSON'}</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
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
