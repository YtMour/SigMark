import {useEffect,useRef,useState} from 'react';
import {errorMessage,request,requestResponse} from './console';
import {caption,date} from './reports';

export type Baseline={id:string;name:string;reportId:string;expectUnlock:boolean;createdAt:string;
  state:'ready'|'trashed'|'missing';model:string|null;batch:string|null;assetId:string|null;expectedNetwork?:string};
const endpoint='/api/admin/regression-baselines';
export function useBaselines(enabled=true){
  const [items,setItems]=useState<Baseline[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [revision,refresh]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    const control=new AbortController();
    setError('');setLoading(true);
    request<{schemaVersion:1;items:Baseline[]}>(endpoint,{signal:control.signal}).then(data=>{
      if(!control.signal.aborted)setItems(data.items);
    }).catch(error=>{if(!control.signal.aborted)setError(errorMessage(error));})
      .finally(()=>{if(!control.signal.aborted)setLoading(false);});
    return ()=>control.abort();
  },[enabled,revision]);
  return {items,error,loading,reload:()=>refresh(n=>n+1),removed:(id:string)=>setItems(previous=>previous.filter(item=>item.id!==id))};
}

export function BaselineDialog({reportId,model,expectUnlock,close,saved}:{
  reportId:string;model:string;expectUnlock:boolean;close:()=>void;saved:(id:string)=>void;
}){
  const ref=useRef<HTMLDialogElement>(null);
  const [name,setName]=useState('');
  const [expect,setExpect]=useState(expectUnlock);
  const [expectedNetwork,setExpectedNetwork]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const el=ref.current;el?.showModal();return ()=>el?.close();},[]);
  return <dialog ref={ref} className="manage-dialog" aria-labelledby="save-baseline-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <form onSubmit={async e=>{
      e.preventDefault();if(busy||!name.trim())return;
      setBusy(true);setError('');
      try{
        const result=await request<{id:string}>(endpoint,{method:'POST',body:JSON.stringify({name:name.trim(),reportId,expectUnlock:expect,expectedNetwork})});
        saved(result.id);
      }catch(err){setError(errorMessage(err));setBusy(false);}
    }}>
      <h2 id="save-baseline-title">保存回归基线</h2>
      <p>{model} · <code>{reportId}</code></p>
      <p className="muted">基线只引用这份原报告。以后可选新报告与它对比。</p>
      <label>基线名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={60} disabled={busy} autoFocus
        placeholder="例如：MI 8 刷机前"/></label>
      <label className="build-check"><input type="checkbox" checked={expect} onChange={e=>setExpect(e.target.checked)} disabled={busy}/>
        默认将同设备的实验解锁列为预期变化</label>
      <label>预期默认网络<select aria-label="预期默认网络" value={expectedNetwork} onChange={e=>setExpectedNetwork(e.target.value)} disabled={busy}>
        <option value="">不要求</option>{['wifi','cellular','ethernet','vpn','none'].map(network=><option key={network} value={network}>{caption(network)}</option>)}
      </select></label>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="actions"><button className="secondary" type="button" disabled={busy} onClick={close}>取消</button>
        <button disabled={busy||!name.trim()}>{busy?'保存中…':'保存基线'}</button></div>
    </form>
  </dialog>;
}

export function BaselineLibrary({items,loading,error,reload,removed,use}:ReturnType<typeof useBaselines>&{use:(item:Baseline)=>void}){
  const [removing,setRemoving]=useState<Baseline>();
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(!removing)return;
    const node=dialog.current;node?.showModal();return ()=>node?.close();
  },[removing]);
  return <>
    {error&&<p className="error inset" role="alert">{error} <button type="button" onClick={reload}>重试</button></p>}
    {!items.length&&<p className="empty">{loading?'正在读取基线…':'还没有保存的基线。打开一份报告，点击「保存回归基线」即可创建。'}</p>}
    <ul className="baseline-library-list">{items.map(item=><li key={item.id}>
      <div><strong>{item.name}</strong><small>{item.model??'报告已删除'} · {date(item.createdAt)}
        {item.state==='trashed'?' · 报告在回收站':item.state==='missing'?' · 引用已失效':''}
        {item.expectUnlock?' · 预期解锁':''}{item.expectedNetwork?' · 预期 '+caption(item.expectedNetwork):''}</small></div>
      <div className="actions"><button type="button" className="secondary" disabled={item.state!=='ready'} onClick={()=>use(item)}>使用基线</button>
        <button type="button" className="text-button" onClick={()=>{setFailure('');setRemoving(item);}}>移除基线</button></div>
    </li>)}</ul>
    {removing&&<dialog ref={dialog} className="manage-dialog" aria-labelledby="remove-baseline-title"
      onCancel={e=>{e.preventDefault();if(!busy)setRemoving(undefined);}}>
      <form onSubmit={async e=>{
        e.preventDefault();if(busy)return;
        setBusy(true);setFailure('');
        try{await requestResponse(endpoint+'/'+removing.id,{method:'DELETE'});removed(removing.id);setRemoving(undefined);reload();}
        catch(err){setFailure(errorMessage(err));}finally{setBusy(false);}
      }}>
        <h2 id="remove-baseline-title">移除基线</h2><p>移除「{removing.name}」只删除基线引用，原报告不受影响。</p>
        {failure&&<p className="error" role="alert">{failure}</p>}
        <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setRemoving(undefined)}>取消</button>
          <button className="danger" disabled={busy}>{busy?'移除中…':'确认移除'}</button></div>
      </form>
    </dialog>}
  </>;
}
