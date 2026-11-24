import {useEffect,useRef,useState} from 'react';
import {errorMessage,request,RequestError} from './console';
import {date} from './reports';

type DeviceChoice={id:string;label:string;model:string};
type Scope={id:string;title:string;reports:number;trashed:number;baselines:number;installations:number};
type Preview={source:Scope;target:Scope;previewToken:string;undoWindowHours:number};
type Entry={id:string;sourceId:string;targetId:string;sourceTitle:string;targetTitle:string;reports:number;trashed:number;
  baselines:number;installations:number;createdAt:string;expiresAt:string;undoneAt?:string;state:'eligible'|'undone'|'expired'|'changed'};
const legalId=(value:string)=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const activity={eligible:'可尝试撤销',undone:'已撤销',expired:'撤销期已过',changed:'目标已变更'};

export function MergeDevice({row,candidates,close,done}:{row:DeviceChoice;candidates:DeviceChoice[];close:()=>void;done:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [target,setTarget]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<Preview>();
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{const node=ref.current;node?.showModal();return ()=>node?.close();},[]);
  const targetId=target.trim(),ready=legalId(targetId)&&targetId!==row.id;
  return <dialog ref={ref} className="manage-dialog" aria-labelledby="merge-title" onClose={close}
    onCancel={e=>{if(busy)e.preventDefault();}}>
    <form onSubmit={async e=>{
      e.preventDefault();
      if(!ready||busy||preview&&!confirmed)return;
      setBusy(true);setError('');
      try{
        if(!preview){
          const p=await request<Preview>('/api/admin/device-assets/merge-preview?'+new URLSearchParams({source:row.id,target:targetId}));
          setPreview(p);
        }else{
          await request('/api/admin/device-assets/merge',{method:'POST',
            body:JSON.stringify({source:row.id,target:targetId,confirmed,previewToken:preview.previewToken})});
          done();
        }
      }catch(err){
        if(err instanceof RequestError&&err.code==='asset_merge_preview_changed'){setPreview(undefined);setConfirmed(false);}
        setError(errorMessage(err));
      }finally{setBusy(false);}
    }}>
      <h2 id="merge-title">合并设备资产</h2>
      <p>只合并确认属于同一部手机的资产。保留所有报告和基线引用，改变的是归属。</p>
      <label>目标设备编号<input autoFocus list="merge-device-targets" maxLength={36} value={target} onChange={e=>{
        setTarget(e.target.value);setPreview(undefined);setConfirmed(false);setError('');
      }} disabled={busy}/>
        <datalist id="merge-device-targets">{candidates.filter(item=>item.id!==row.id).map(item=>
          <option key={item.id} value={item.id}>{item.label||item.model}</option>)}</datalist></label>
      {preview&&<>
        <div role="status" className="inset merge-impact">
          <strong>{preview.source.title} → {preview.target.title}</strong>
          <p>迁移 {preview.source.reports} 份在库报告、{preview.source.trashed} 份回收站报告、
            {preview.source.baselines} 个基线引用、{preview.source.installations} 个后续上传关联。</p>
          <p>目标合并后有 {preview.source.reports+preview.target.reports} 份在库报告，保留目标别名。
            目标归属未变动时，{preview.undoWindowHours} 小时内可从「合并记录」撤销。</p>
        </div>
        <label className="build-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>
          我已确认两个资产是同一部手机</label>
      </>}
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={()=>ref.current?.close()}>取消</button>
        <button type="submit" disabled={!ready||busy||!!preview&&!confirmed}>{busy?'正在处理…':preview?'确认合并':'预览影响'}</button></div>
    </form>
  </dialog>;
}

export function MergeAudit({revision,changed}:{revision:number;changed:()=>void}){
  const [page,setPage]=useState<{items:Entry[];nextCursor:string}>();
  const [cursor,setCursor]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [entry,setEntry]=useState<Entry>();
  useEffect(()=>{
    const control=new AbortController();setPage(undefined);setError('');
    request<{items:Entry[];nextCursor:string}>('/api/admin/device-assets/merges?'+new URLSearchParams({before:cursor}),{signal:control.signal})
      .then(value=>{if(!control.signal.aborted)setPage(value);})
      .catch(err=>{if(!control.signal.aborted)setError(errorMessage(err));});
    return()=>control.abort();
  },[cursor,revision]);
  return <section className="panel" aria-labelledby="asset-audit">
    <div className="pane-title"><div><h2 id="asset-audit">设备合并记录</h2>
      <p className="muted">只记录新版的合并。当前使用共享管理凭据，日志不是个人身份审计。</p></div>
      <button type="button" className="secondary" onClick={()=>{setCursor('');changed();}}>刷新记录</button></div>
    {notice&&<p className="inset" role="status">{notice}</p>}
    {error?<p role="alert" className="error">{error}</p>:!page?<p role="status">正在读取合并记录…</p>:!page.items.length?<p>暂无合并记录。</p>:
      <ul className="device-inventory">{page.items.map(item=><li key={item.id}>
        <div><strong>{item.sourceTitle} → {item.targetTitle}</strong><small>{date(item.createdAt)} · {item.id.slice(0,8)}</small></div>
        <div><span>在库 {item.reports} · 回收站 {item.trashed} · 基线 {item.baselines}</span>
          <small>{activity[item.state]}{item.undoneAt?' · '+date(item.undoneAt):item.state==='eligible'?' · 截止 '+date(item.expiresAt):''}</small></div>
        <div className="actions">{item.state==='eligible'&&<button type="button" className="secondary" onClick={()=>setEntry(item)}>撤销这次合并</button>}</div>
      </li>)}</ul>}
    <div className="actions">{cursor&&<button type="button" className="secondary" onClick={()=>setCursor('')}>回到最新</button>}
      {page?.nextCursor&&<button type="button" className="secondary" onClick={()=>setCursor(page.nextCursor)}>查看更早记录</button>}</div>
    {entry&&<UndoMerge entry={entry} close={()=>setEntry(undefined)} done={()=>{
      setEntry(undefined);setCursor('');setNotice('已恢复来源资产及其报告归属。');changed();
    }}/>}
  </section>;
}

function UndoMerge({entry,close,done}:{entry:Entry;close:()=>void;done:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const node=ref.current;node?.showModal();return()=>node?.close();},[]);
  return <dialog ref={ref} className="manage-dialog" aria-labelledby="undo-merge-title" onClose={close} onCancel={e=>{if(busy)e.preventDefault();}}>
    <form onSubmit={async e=>{
      e.preventDefault();if(busy)return;
      setBusy(true);setError('');
      try{await request('/api/admin/device-assets/merges/'+entry.id+'/undo',{method:'POST',body:'{"confirmed":true}'});done();}
      catch(err){setError(errorMessage(err));setBusy(false);}
    }}>
      <h2 id="undo-merge-title">撤销设备合并</h2>
      <p>恢复「{entry.sourceTitle}」及其原有报告归属。回收站状态和报告正文保持原样。若目标后来接收了新报告或归属变更，系统会阻止自动撤销。</p>
      {error&&<p role="alert" className="error">{error}</p>}
      <div className="actions"><button autoFocus type="button" className="secondary" disabled={busy} onClick={()=>ref.current?.close()}>取消</button>
        <button type="submit" disabled={busy}>{busy?'正在撤销…':'确认撤销'}</button></div>
    </form>
  </dialog>;
}
