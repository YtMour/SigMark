import {useId,useMemo,useRef,useState} from 'react';
import {parameterKey,type Parameter} from './compare';
import {caption} from './reports';
import {briefReason,groupReadings,readStates} from './reader-fields';

export function ReaderParameters({fields}:{fields:Parameter[]}){
  const [query,setQuery]=useState(''),[status,setStatus]=useState('');
  const {counts,matched,visible,sections}=useMemo(()=>groupReadings(fields,query,status),[fields,query,status]);
  const prefix=useId(),search=useRef<HTMLInputElement>(null),directory=useRef<HTMLSelectElement>(null);
  return <>
    <div className="reader-controls">
      <div className="reader-search">
        <label>搜索本报告参数<input ref={search} type="search" value={query} placeholder="参数名、值、字段键、来源或 errno…" onChange={e=>setQuery(e.target.value)}/></label>
        <label>定位分类<select ref={directory} value="" disabled={!sections.length} onChange={e=>{
          const target=document.getElementById(prefix+'-'+e.target.value);
          target?.focus({preventScroll:true});target?.scrollIntoView({block:'start'});
        }}><option value="">跳至分类…</option>{sections.map(g=><option key={g.key} value={g.key}>{g.label} · {g.rows.length}</option>)}</select></label>
      </div>
      <div className="reader-states" role="group" aria-label="按采集状态筛选">
        {['',...readStates].map(s=><button type="button" className="secondary" key={s} aria-pressed={status===s}
          onClick={()=>setStatus(s===status?'':s)}>{s?caption(s):'全部'} <b>{s?counts.get(s)??0:matched}</b></button>)}
        <small role="status">显示 {visible} / 已归档 {fields.length} 项</small>
      </div>
    </div>
    {!visible&&<div className="workspace-empty"><strong>没有匹配参数</strong>
      <div><button className="secondary" onClick={()=>{setQuery('');setStatus('');search.current?.focus();}}>清除参数筛选</button></div></div>}
    <div className="parameter-sections" role="region" aria-label="报告参数">
      {sections.map(({key,label,rows})=><section className="parameter-group" key={key} aria-labelledby={prefix+'-'+key}>
        <header><h2 tabIndex={-1} id={prefix+'-'+key}>{label}<small>{rows.length} 项</small></h2>
          <button className="text-button" onClick={()=>directory.current?.focus()}>返回分类导航 ↑</button></header>
        <ul>{rows.map(p=><li key={parameterKey(p)}><details className="field-evidence">
          <summary>
            <span className="field-label">{p.label||p.key}</span>
            <span className={'field-reading '+(p.value==null?'no-value':'')}>{p.value??briefReason(p)}</span>
            <span className={'state '+p.status.toLowerCase()}>{caption(p.status)}</span>
            <span className="evidence-cue">依据</span>
          </summary>
          <dl><dt>字段键</dt><dd><code>{parameterKey(p)}</code></dd><dt>来源</dt><dd><code>{p.source||'报告未记录'}</code></dd>
            {p.reason&&<><dt>原因码</dt><dd><code>{p.reason}</code> · {caption(p.reason)}</dd></>}
            {p.errno!=null&&<><dt>系统错误码</dt><dd><code>errno={p.errno}</code></dd></>}
            {p.note&&<><dt>采集说明</dt><dd>{p.note}</dd></>}
          </dl>
        </details></li>)}</ul>
      </section>)}
    </div>
  </>;
}
