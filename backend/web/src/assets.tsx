import { useEffect, useRef, useState } from 'react';
import { request, errorMessage } from './console';
import { caption, date, saveJson, type Page, type Report, type Row } from './reports';
import { refreshSeconds, useVisiblePoll } from './live';

type View = 'archive' | 'trash';
type Action = 'trash' | 'restore' | 'purge';
const actionNames = {trash:'移入回收站',restore:'恢复报告',purge:'永久删除'};

export function AssetsPage() {
  const [view,setView]=useState<View>('archive');
  const [query,setQuery]=useState(''),[batch,setBatch]=useState('');
  const [filter,setFilter]=useState({q:'',batch:''});
  const [cursors,setCursors]=useState(['']);
  const [revision,refresh]=useState(0);
  const [page,setPage]=useState<Page>();
  const [totals,setTotals]=useState<Record<View,number>>();
  const [checked,setChecked]=useState<string[]>([]);
  const [pending,setPending]=useState<{action:Action;rows:Row[]}>();
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [downloadId,setDownloadId]=useState('');
  const [busy,setBusy]=useState(true);
  const cursor=cursors[cursors.length-1];
  useVisiblePoll(!cursor&&!busy&&!checked.length&&!pending,async signal=>{
    const params=new URLSearchParams({...filter,view});
    const [result,archive,trash]=await Promise.all([
      request<Page>('/api/admin/reports?'+params,{signal}),
      request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view:'archive'}),{signal}),
      request<{total:number}>('/api/admin/report-count?'+new URLSearchParams({...filter,view:'trash'}),{signal}),
    ]);
    if(!signal.aborted){setPage(result);setTotals({archive:archive.total,trash:trash.total});setError('');}
  });
  const selected=page?.items.filter(row=>checked.includes(row.id))??[];
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
  function switchView(next:View){if(next!==view){resetSelection();setNotice('');setView(next);}}
  function propose(action:Action){if(selected.length)setPending({action,rows:selected});}
  function applyFilter(q:string,b:string){
    resetSelection();setNotice('');setFilter({q:q.trim(),batch:b.trim()});
  }
  async function download(row:Row){
    setDownloadId(row.id);setError('');
    try{saveJson(await request<Report>('/api/admin/reports/'+row.id));}
    catch(error){setError(errorMessage(error));}
    finally{setDownloadId('');}
  }
  return <main className="workspace assets-workspace">
    <header className="page-heading collection-heading">
      <div><p className="eyebrow">资产管理 / 留存维护</p><h1>报告资产</h1>
        <p className="muted">按型号、批次或报告编号定位资产，再对选中的报告执行操作。</p></div>
      <a className="subtle-link" href="#reports">转到报告档案 →</a>
    </header>
    <div className="asset-states" role="group" aria-label="资产视图">
      {(['archive','trash'] as const).map(item=><button key={item} type="button" className="asset-state"
        aria-pressed={view===item} onClick={()=>switchView(item)}>
        <span><strong>{item==='archive'?'在库报告':'回收站'}</strong><small>{item==='archive'?'可查看和对比':'可恢复或永久删除'}</small></span>
        <b>{totals?.[item]??'—'}</b>
      </button>)}
    </div>
    <section className="panel asset-panel" aria-label="报告资产列表">
      <form className="filters asset-filters" onSubmit={event=>{event.preventDefault();applyFilter(query,batch);}}>
        <label className="main-search">搜索资产<input maxLength={80} value={query} onChange={e=>setQuery(e.target.value)}
          placeholder="型号、ROM / 构建号、报告编号…"/></label>
        <label>批次<input maxLength={32} value={batch} onChange={e=>setBatch(e.target.value)} placeholder="全部批次"/></label>
        <button>查询资产</button>{(filter.q||filter.batch)&&<button className="secondary" type="button" onClick={()=>{
          setQuery('');setBatch('');applyFilter('','');
        }}>清除</button>}
      </form>
      <div className="asset-toolbar">
        <div className="asset-selection"><strong>{busy?'正在读取…':`已选 ${selected.length} / ${page?.items.length??0} 份`}</strong>
          <span>{!refreshSeconds()?'自动刷新已关闭':selected.length?'已暂停刷新，保护当前勾选':cursor?'历史页保持当前位置':`首页每 ${refreshSeconds()} 秒同步`}</span></div>
        <div className="actions">
          <button className="secondary" onClick={()=>{resetSelection();refresh(n=>n+1);}} disabled={busy}>刷新</button>
          {view==='archive'?<button className="secondary" disabled={busy||!selected.length} onClick={()=>propose('trash')}>移入回收站</button>:<>
            <button disabled={busy||!selected.length} onClick={()=>propose('restore')}>恢复</button>
            <button className="danger" disabled={busy||!selected.length} onClick={()=>propose('purge')}>永久删除</button>
          </>}
        </div>
      </div>
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
          <td><strong>{row.report.model}</strong><small><code>{row.id.slice(0,8)}</code> · {caption(row.report.network)}</small></td>
          <td data-label="批次">{row.batch}</td>
          <td data-label="版本">API {row.report.androidApi||'—'}<small>App {row.report.appVersion}</small></td>
          <td data-label={view==='trash'?'移入时间':'接收时间'}>{date(row.trashedAt??row.receivedAt)}</td>
          <td><div className="actions">{view==='archive'?<a className="subtle-link" href={'#reports?report='+row.id}>查看报告</a>:
            <button className="secondary" onClick={()=>setPending({action:'restore',rows:[row]})}>恢复此报告</button>}
            <button className="text-button" disabled={!!downloadId} onClick={()=>void download(row)}>{downloadId===row.id?'下载中…':'下载 JSON'}</button>
          </div></td>
        </tr>)}</tbody>
      </table>}
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
      setNotice(`${rows.length} 份报告${action==='trash'?'已移入回收站':action==='restore'?'已恢复':'已永久删除'}。`);
    }}/>}
  </main>;
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
