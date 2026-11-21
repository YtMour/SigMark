import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {useVisiblePoll} from './live';
import {reportScope,type ReportFilters} from './workspace-route';
export {emptyReportFilters,reportWorkspaceLink,type ReportFilters} from './workspace-route';

const dimensions = [
  ['android','Android 版本'],['api','API 级别'],['brand','品牌'],['model','型号'],['device','子型号 / 设备代号'],
] as const;
type Key = typeof dimensions[number][0];
type Options = Partial<Record<Key,{value:string;count:number}[]>>;
const display=(value:string)=>value==='~missing'?'未记录':value;
export const facetCaptions = Object.fromEntries(dimensions) as Record<Key,string>;
export function activeReportFilters(filters:ReportFilters) {
  return (['q','batch',...dimensions.map(([key])=>key)] as const).flatMap(key=>filters[key]?
    [{key,label:key==='q'?'搜索':key==='batch'?'批次':facetCaptions[key],
      value:filters[key]==='asset:unassigned'?'待归组报告':display(filters[key])}]:[]);
}

export function linkedReportFilters():ReportFilters {
  return reportScope(location.hash);
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
