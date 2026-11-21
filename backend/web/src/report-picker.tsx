import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {date,type Page,type Row} from './reports';
import {relationToAsset} from './workspace-route';

export function ReportPicker({label,value,select,exclude,asset,fallback}:{
  label:string;value:string;select:(id:string)=>void;exclude?:string;asset?:string;fallback?:string;
}){
  const [input,setInput]=useState('');
  const [query,setQuery]=useState('');
  const [sameOnly,setSameOnly]=useState(!!asset);
  const [cursor,setCursor]=useState('');
  const [revision,retry]=useState(0);
  const [data,setData]=useState<{scope:string;items:Row[];nextCursor:string}>();
  const [error,setError]=useState('');
  const [pending,setPending]=useState(true);
  const scope=sameOnly&&asset?'asset:'+asset:query;
  const list=data?.scope===scope?data:undefined;
  const rows=list?.items.filter(row=>row.id!==exclude)??[];
  useEffect(()=>{
    const control=new AbortController();
    setPending(true);setError('');
    request<Page>('/api/admin/reports?'+new URLSearchParams({q:scope,before:cursor}),{signal:control.signal})
      .then(page=>{
        if(control.signal.aborted)return;
        setData(previous=>{
          const combined=cursor&&previous?.scope===scope?[...previous.items,...page.items]:page.items;
          return {scope,items:[...new Map(combined.map(row=>[row.id,row])).values()],nextCursor:page.nextCursor};
        });
      }).catch(err=>{if(!control.signal.aborted)setError(errorMessage(err));})
      .finally(()=>{if(!control.signal.aborted)setPending(false);});
    return ()=>control.abort();
  },[scope,cursor,revision]);
  return <div className="sample-picker">
    <form className="asset-search" onSubmit={e=>{
      e.preventDefault();setSameOnly(false);setQuery(input.trim());setCursor('');retry(n=>n+1);
    }}>
      <label>搜索历史报告<input type="search" value={input} onChange={e=>setInput(e.target.value)} maxLength={80}
        placeholder="型号、批次、构建号或报告编号"/></label>
      <button type="submit" className="secondary">搜索</button>
    </form>
    <div className="sample-select-row">
      <label>{label}<select aria-label={label} value={value} onChange={e=>select(e.target.value)}>
        <option value="">请选择报告</option>
        {value&&!rows.some(row=>row.id===value)&&<option value={value}>{fallback??'已选报告'} · {value.slice(0,8)}</option>}
        {rows.map(row=>{
          const relation=relationToAsset(asset,row.report.assetId);
          return <option key={row.id} value={row.id}>
            {relation==='same'?'同设备 · ':relation==='different'?'跨设备 · ':''}{row.report.model} · {row.batch} · {date(row.report.capturedAtEpochMs??row.receivedAt)} · {row.id.slice(0,8)}
          </option>;
        })}
      </select></label>
      {list?.nextCursor&&<button type="button" className="secondary" disabled={pending} onClick={()=>setCursor(list.nextCursor)}>加载更多报告</button>}
    </div>
    <div className="actions sample-scope">
      {asset&&<button type="button" className="text-button" onClick={()=>{setSameOnly(!sameOnly);setCursor('');setInput('');setQuery('');}}>
        {sameOnly?'查看全部设备':'只看同一设备'}
      </button>}
      {error?<span className="error" role="alert">{error} <button type="button" className="secondary" onClick={()=>retry(n=>n+1)}>重试</button></span>:
        <small role="status">{pending?'正在读取…':rows.length?`${sameOnly&&asset?'同设备历史':'搜索范围'} · 已加载 ${rows.length} 份`:'没有匹配报告，可更改搜索条件。'}</small>}
    </div>
  </div>;
}
