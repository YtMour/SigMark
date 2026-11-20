import {useEffect,useState,type ReactNode} from 'react';
import {errorMessage,request} from './console';
import {useVisiblePoll} from './live';

const dimensions = [
  ['android','Android 版本'],['api','API 级别'],['brand','品牌'],['model','型号'],['device','子型号 / 设备代号'],
] as const;
type Key = typeof dimensions[number][0];
export type ReportFilters = {q:string;batch:string}&Record<Key,string>;
type Options = Partial<Record<Key,{value:string;count:number}[]>>;
export const emptyReportFilters:ReportFilters = {q:'',batch:'',android:'',api:'',brand:'',model:'',device:''};
const display=(value:string)=>value==='~missing'?'未记录':value;

export function linkedReportFilters():ReportFilters {
  const params=new URLSearchParams(location.hash.split('?')[1]);
  return {...emptyReportFilters,...Object.fromEntries(Object.keys(emptyReportFilters).map(key=>[key,params.get(key)??'']))};
}

export function reportWorkspaceLink(section:'reports'|'assets'|'stats',filters:ReportFilters):string {
  const params=new URLSearchParams(Object.entries(filters).filter(([,value])=>value));
  if(section==='stats')params.set('tab','coverage');
  return '#'+(section==='stats'?'assets':section)+(params.size?'?'+params:'');
}

export function withFacet(filters:ReportFilters,key:Key,value:string):ReportFilters {
  const next={...filters,[key]:value};
  if(key==='brand'){next.model='';next.device='';}
  if(key==='model')next.device='';
  return next;
}

export function ReportFacets({filters,select,view='archive',showCounts=true}:{
  filters:ReportFilters;select:(key:Key,value:string)=>void;view?:'archive'|'trash';showCounts?:boolean;
}){
  const [result,setResult]=useState<{path:string;options?:Options;error?:string}>();
  const path='/api/admin/report-facets?'+new URLSearchParams({...filters,view});
  const options=result?.path===path?result.options:undefined;
  const error=result?.path===path?result.error:undefined;
  useVisiblePoll(!!options,async signal=>{
    const data=await request<Options>(path,{signal});
    if(!signal.aborted)setResult({path,options:data});
  },path);
  useEffect(()=>{
    const controller=new AbortController();
    request<Options>(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setResult({path,options:data});
    }).catch(err=>{if(!controller.signal.aborted)setResult({path,error:errorMessage(err)});});
    return ()=>controller.abort();
  },[path]);
  return <fieldset className="facet-fields">
    <legend>分类筛选</legend>
    {dimensions.map(([key,label])=>{
      const rows=options?.[key]??[];
      return <label key={key}>{label}<select aria-label={label} value={filters[key]} onChange={e=>select(key,e.target.value)}>
        <option value="">全部</option>
        {filters[key]&&!rows.some(row=>row.value===filters[key])&&<option value={filters[key]}>{display(filters[key])}</option>}
        {rows.map(row=><option key={row.value} value={row.value}>{display(row.value)}{showCounts?` · ${row.count}`:''}</option>)}
      </select></label>;
    })}
    {(error||!options)&&<small role="status">{error??'正在更新分类…'}</small>}
  </fieldset>;
}

export function ReportFilterBar({filters,apply,children,showCounts=true}:{
  filters:ReportFilters;apply:(value:ReportFilters)=>void;children?:ReactNode;showCounts?:boolean;
}){
  const [query,setQuery]=useState(filters.q),[batch,setBatch]=useState(filters.batch);
  const active=Object.values(filters).some(Boolean);
  return <form className="panel top-report-filters" aria-label="报告筛选条件"
      onSubmit={event=>{event.preventDefault();apply({...filters,q:query.trim(),batch:batch.trim()});}}>
    <ReportFacets filters={filters} showCounts={showCounts} select={(key,value)=>apply(withFacet(filters,key,value))}/>
    <div className="top-filter-tools">
      <label className="report-query">搜索<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}
        placeholder="型号、构建号、报告编号…"/></label>
      <label>批次<input value={batch} onChange={e=>setBatch(e.target.value)} maxLength={32} placeholder="全部批次"/></label>
      <div className="actions"><button>应用搜索</button>
        {(active||query||batch)&&<button type="button" className="secondary" onClick={()=>{
          setQuery('');setBatch('');apply(emptyReportFilters);
        }}>清除筛选</button>}
        {children}
      </div>
    </div>
  </form>;
}
