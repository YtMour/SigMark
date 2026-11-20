import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {linkedReportFilters,ReportFilterBar,reportWorkspaceLink,type ReportFilters} from './facets';
import {caption,date,groups,saveDownload} from './reports';

type FieldCoverage = {
  field:string;group:string;key:string;label:string|null;
  available:number;restricted:number;unavailable:number;errors:number;legacy:number;missing:number;
  reasons:Record<string,number>;
};
type Stats = {
  schemaVersion:2;
  generatedAt:string;
  scope:{archived:number};
  fieldSets:string[];
  fields:FieldCoverage[];
};
const statuses = [
  ['available','有值'],['restricted','受限'],['unavailable','无可用值'],
  ['errors','异常'],['legacy','旧版仅状态'],['missing','未归档'],
] as const;
const fmt = (n:number|undefined)=>n==null?'—':n.toLocaleString('zh-CN');

export function RepositoryStats(){
  const [filters,setFilters]=useState<ReportFilters>(linkedReportFilters);
  const [fieldSet,setFieldSet]=useState(()=>new URLSearchParams(location.hash.split('?')[1]).get('fieldSet')??'');
  const [group,setGroup]=useState('');
  const [search,setSearch]=useState('');
  const [mode,setMode]=useState('recorded');
  const [revision,refresh]=useState(0);
  const [result,setResult]=useState<{path:string;revision:number;body:Stats}>();
  const [failure,setFailure]=useState<{path:string;revision:number;text:string}>();
  const params=new URLSearchParams({...filters,fieldSet});
  const path='/api/admin/repository-stats?'+params;
  const current=result?.path===path&&result.revision===revision?result.body:undefined;
  const failureText=failure?.path===path&&failure.revision===revision?failure.text:undefined;
  const total=current?.scope.archived??0;
  const availableSets=result?.body.fieldSets??[];
  const fieldSetOptions=fieldSet&&!availableSets.includes(fieldSet)?[...availableSets,fieldSet]:availableSets;
  const rows=(current?.fields??[]).filter(row=>
    (!group||row.group===group)&&(!search.trim()||[row.field,row.label,...Object.keys(row.reasons).flatMap(reason=>[reason,caption(reason)])]
      .some(term=>term?.toLowerCase().includes(search.trim().toLowerCase())))&&
    (mode==='all'||(mode==='gaps'?row.available<total:row.missing<total)));

  useEffect(()=>{
    const controller=new AbortController();
    request<Stats>(path,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])})
      .then(body=>{if(!controller.signal.aborted){setFailure(undefined);setResult({path,revision,body});}})
      .catch(error=>{if(!controller.signal.aborted)setFailure({path,revision,text:errorMessage(error)});});
    return ()=>controller.abort();
  },[path,revision]);

  return <>
    <ReportFilterBar filters={filters} showCounts={false} apply={next=>{setFilters(next);refresh(value=>value+1);}}>
      <a className="subtle-link" href={reportWorkspaceLink('reports',filters)}>返回档案查看样本 →</a>
    </ReportFilterBar>
    <section className="panel stats-analysis" aria-labelledby="coverage-title">
      <div className="pane-title"><div><h2 id="coverage-title">字段覆盖</h2>
        <p className="muted">{fmt(current?.scope.archived)} 份匹配报告（同一设备可有多次采样）
          {current&&` · 更新于 ${date(current.generatedAt)}`}</p></div>
        <div className="actions"><button type="button" className="secondary" onClick={()=>refresh(value=>value+1)} disabled={!current&&!failureText}>刷新覆盖</button>
        <button type="button" className="secondary" disabled={!current} onClick={()=>current&&saveDownload(
          new Blob([JSON.stringify({...current,filters:{...filters,fieldSet}},null,2)],{type:'application/json'}),'SigMark-repository-stats.json',
        )}>导出覆盖 JSON</button></div>
      </div>
      <div className="stats-tools">
        <label>字段集<select aria-label="字段集" value={fieldSet} onChange={e=>setFieldSet(e.target.value)}>
          <option value="">所有版本</option>
          {fieldSetOptions.map(item=><option value={item} key={item}>{item==='legacy'?'旧协议 · 无字段集版本':'字段集 v'+item}</option>)}
        </select></label>
        <label>参数分类<select aria-label="参数分类" value={group} onChange={e=>setGroup(e.target.value)}>
          <option value="">全部参数</option>
          {Object.entries(groups).map(([key,label])=><option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>显示范围<select aria-label="显示范围" value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="recorded">本组归档过的字段</option><option value="all">所有已知字段</option><option value="gaps">有缺口的字段</option>
        </select></label>
        <label>查找字段<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="名称、字段键或原因码"/></label>
      </div>
      <p className="stats-help">有值率 = 有值的报告 ÷ 匹配报告。「旧版仅状态」不是实测值；「未归档」也不等于设备不支持。</p>
      {failureText?<p className="error inset" role="alert">{failureText}</p>:!current?
        <p className="empty" role="status">正在汇总归档记录…</p>:!rows.length?
        <p className="empty">{total?'没有符合条件的字段。':'当前范围没有可统计的报告。'}</p>:
        <div className="stats-table-scroll" role="region" aria-label="字段覆盖表，可横向滚动" tabIndex={0}>
          <table className="stats-table"><thead><tr>
            <th scope="col">字段</th><th scope="col">有值率</th>
            {statuses.map(([key,label])=><th scope="col" key={key}>{label}</th>)}
          </tr></thead><tbody>
            {rows.map(row=><tr key={row.field}>
              <th scope="row">
                <strong>{row.label??caption(row.field)}</strong><code>{row.field}</code>
                {!!Object.keys(row.reasons).length&&<details className="coverage-reasons">
                  <summary>查看原因</summary>
                  <ul>{Object.entries(row.reasons).map(([reason,count])=><li key={reason}>{caption(reason)} · {fmt(count)}</li>)}</ul>
                </details>}
              </th>
              <td><div className="coverage-meter"><meter min={0} max={total} value={row.available} aria-label={`${row.field} 有值率`}/>
                <span>{(row.available*100/total).toLocaleString('zh-CN',{maximumFractionDigits:1})}%</span></div></td>
              {statuses.map(([key])=><td className={row[key]?'':'zero-value'} key={key}>{fmt(row[key])}</td>)}
            </tr>)}
          </tbody></table>
        </div>}
    </section>
  </>;
}
