import * as Popover from '@radix-ui/react-popover';
import {useEffect,useState,type ReactNode} from 'react';
import {activeReportFilters,emptyReportFilters,ReportFacets,withFacet,type ReportFilters} from './facets';

export function ReportFiltersBar({filters,view='archive',apply,children,applyFacet}:{
  filters:ReportFilters;view?:'archive'|'trash';apply:(filters:ReportFilters)=>void;
  children?:ReactNode;applyFacet?:(filters:ReportFilters,key:string)=>void;
}){
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState(filters);
  const [batch,setBatch]=useState(filters.batch);
  const [query,setQuery]=useState(filters.q);
  useEffect(()=>setQuery(filters.q),[filters.q]);
  const active=activeReportFilters(filters);
  const visibleFacets=!!applyFacet;
  const count=active.filter(item=>item.key!=='q').length;
  return <div className="asset-filter-toolbar">
    <div className="asset-filter-controls">
      <form className="asset-search" aria-label="报告筛选条件" onSubmit={e=>{e.preventDefault();apply({...filters,q:query.trim()});}}>
        <label><span className="visually-hidden">搜索报告</span><input type="search" aria-label="搜索报告" maxLength={80} value={query} onChange={e=>setQuery(e.target.value)}
          placeholder="搜索型号、构建号、报告编号…"/></label>
        <button>搜索</button>
      </form>
      <Popover.Root open={open} onOpenChange={next=>{
        if(next){setDraft(filters);setBatch(filters.batch);}
        setOpen(next);
      }}>
        <Popover.Trigger asChild><button type="button" className="secondary">
          {visibleFacets?'批次筛选':'更多筛选'}{!visibleFacets&&count?` · ${count}`:''}
        </button></Popover.Trigger>
        <Popover.Portal>
          <Popover.Content aria-label="更多筛选条件" className="filter-popover" align="end" sideOffset={8} collisionPadding={10}>
            <form onSubmit={e=>{
              e.preventDefault();setOpen(false);apply({...draft,batch:batch.trim()});
            }}>
              <h2>{visibleFacets?'按采集批次筛选':'筛选报告'}</h2>
              <label>批次<input maxLength={32} value={batch} onChange={e=>setBatch(e.target.value)} placeholder="全部批次"/></label>
              {!visibleFacets&&<ReportFacets filters={draft} view={view} select={(key,value)=>setDraft(previous=>withFacet(previous,key,value))}/>}
              <div className="actions">
                <button type="button" className="text-button" onClick={()=>{if(!visibleFacets)setDraft({...emptyReportFilters,q:filters.q});setBatch('');}}>清空{visibleFacets?'批次':'条件'}</button>
                <Popover.Close asChild><button type="button" className="secondary">取消</button></Popover.Close>
                <button>应用筛选</button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {children}
    </div>
    {applyFacet&&<ReportFacets filters={filters} view={view} select={(key,value)=>applyFacet(withFacet(filters,key,value),key)}/>}
    {!!active.length&&<div className="asset-filter-chips" aria-label="已应用筛选">
      {active.map(({key,label,value})=><button key={key} type="button" className="secondary" onClick={()=>{
        apply(key==='brand'||key==='model'?withFacet(filters,key,''):{...filters,[key]:''});
      }} aria-label={`清除${label}筛选：${value}`}>
        <span>{label}：</span>{value}<b aria-hidden="true">×</b>
      </button>)}
      {active.length>1&&<button type="button" className="text-button" onClick={()=>apply(emptyReportFilters)}>全部清除</button>}
    </div>}
  </div>;
}
