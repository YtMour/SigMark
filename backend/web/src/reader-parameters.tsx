import {useId,useMemo,useRef,useState} from 'react';
import {parameterKey,type Parameter} from './compare';
import {caption,date} from './reports';
import {briefReason,groupReadings,readStates} from './reader-fields';
import {architectureFields,captureHardware,hardwareFields,graphicsFields} from './hardware-capture';
import {gnssAudit,otherFieldQuality,qualityVersion} from './field-quality';

const gnssYearKey='system.gnssHardwareYear';
const gnssCrossFields=[
  ['system.interfaceCapabilities','功能声明'],['system.gnssProvider','GPS 提供器'],
  ['system.gnssModelReported','型号名称是否上报'],['system.gnssCapabilities','测量等能力声明'],
  ['system.gnssAntennaSupport','天线信息声明'],['system.gnssCheckPrerequisite','实测起点条件'],
  ['system.gnssCheckStatus','状态回调'],['system.gnssCheckMeasurements','测量回调'],
  ['system.gnssCheckStartAt','实测开始'],['system.gnssCheckEndAt','实测结束'],['system.gnssCheckElapsed','观测用时'],
];
const gnssValues:Record<string,string>={yes:'是',no:'否',observed:'本次观察到',not_seen:'本次未观察到',ready:'精确位置已授权且 GPS 可用',
  permission_required:'未授权精确位置',location_disabled:'系统位置关闭',location_unknown:'位置状态未知',provider_missing:'未暴露 GPS 提供器'};

export function ReaderParameters({fields,fieldSet=0,capturedAt}:{fields:Parameter[];fieldSet?:number;capturedAt?:number}){
  const [query,setQuery]=useState(''),[status,setStatus]=useState('');
  const [expandedOnly,setExpandedOnly]=useState(false);
  const hardware=useMemo(()=>captureHardware(fields),[fields]);
  const audit=useMemo(()=>gnssAudit(fields,capturedAt),[fields,capturedAt]);
  const index=useMemo(()=>new Map(fields.map(p=>[parameterKey(p),p])),[fields]);
  const {counts,matched,visible,sections}=useMemo(()=>groupReadings(expandedOnly?hardware.rows:fields,query,status),[fields,hardware,query,status,expandedOnly]);
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
    <section className="capture-extension" aria-labelledby={prefix+'-expanded'}>
      <div><h2 id={prefix+'-expanded'}>扩展采集</h2>
        <p>{fieldSet?`字段集 v${fieldSet}`:'旧协议'} · 已归档 {hardware.rows.length} 项 · 有值 {hardware.available} 项</p></div>
      <div className="actions">
        {hardware.rows.length>0&&<button type="button" className="secondary" aria-pressed={expandedOnly} onClick={()=>{
          setExpandedOnly(p=>!p);setQuery('');setStatus('');
        }}>{expandedOnly?'返回全部参数':'只看扩展采集'}</button>}
      </div>
      <details><summary>查看各版本和采样条件</summary>
        <ul>
          <li>v11 架构与接口：{hardware.architecture}/{architectureFields.length} 项已归档。</li>
          <li>v12 GNSS、输入、传感器、Camera2：{hardware.hardware}/{hardwareFields.length} 项已归档。</li>
          <li>v12 图形回读：{hardware.graphics}/{graphicsFields.length} 项已归档。可用整体获取或 ROM 验收运行。</li>
        </ul>
      </details>
      {fieldSet<12?<small>这是历史快照：新字段不会补写。请用新版重新采集后上传新报告。</small>:
        !hardware.graphics&&<small>这份报告未记录图形实测。在 App 点「整体获取」或「ROM 验收」生成新采样。</small>}
    </section>
    {!visible&&<div className="workspace-empty"><strong>没有匹配参数</strong>
      <div><button className="secondary" onClick={()=>{setQuery('');setStatus('');setExpandedOnly(false);search.current?.focus();}}>清除参数筛选</button></div></div>}
    <div className="parameter-sections" role="region" aria-label="报告参数">
      {sections.map(({key,label,rows})=><section className="parameter-group" key={key} aria-labelledby={prefix+'-'+key}>
        <header><h2 tabIndex={-1} id={prefix+'-'+key}>{label}<small>{rows.length} 项</small></h2>
          <button className="text-button" onClick={()=>directory.current?.focus()}>返回分类导航 ↑</button></header>
        <ul>{rows.map(p=><li key={parameterKey(p)}><details className="field-evidence">
          <summary>
            <span className="field-label">{parameterKey(p)===gnssYearKey?'GNSS 硬件与软件型号年':p.label||p.key}</span>
            <span className={'field-reading '+(p.value==null?'no-value':'')}>{p.value??briefReason(p)}</span>
            <span className={'state '+p.status.toLowerCase()}>{caption(p.status)}</span>
            <span className="evidence-cue">依据</span>
          </summary>
          <dl><dt>字段键</dt><dd><code>{parameterKey(p)}</code></dd><dt>来源</dt><dd><code>{p.source||'报告未记录'}</code></dd>
            {p.reason&&<><dt>原因码</dt><dd><code>{p.reason}</code> · {caption(p.reason)}</dd></>}
            {p.errno!=null&&<><dt>系统错误码</dt><dd><code>errno={p.errno}</code></dd></>}
            {p.note&&<><dt>采集说明</dt><dd>{p.note}</dd></>}
          </dl>
          {otherFieldQuality(p)&&<p className="muted">{otherFieldQuality(p)?.text} <code>{otherFieldQuality(p)?.code}</code></p>}
          {parameterKey(p)===gnssYearKey&&<div className="gnss-audit">
            <p><strong>读数核对</strong> · <code>{qualityVersion}</code> · {capturedAt?date(capturedAt):'采样时间未记录'}</p>
            {p.label!=='GNSS 硬件与软件型号年'&&<p className="muted">原归档标签：{p.label}</p>}
            <ul>{audit.map(n=><li key={n.code}>{n.text} <small><code>{n.code}</code></small></li>)}</ul>
            <dl>{gnssCrossFields.map(([key,label])=>{
              const field=index.get(key),v=field?.value;
              const display=v?(key.endsWith('At')&&/^\d{12,13}$/.test(v)?date(Number(v)):gnssValues[v]??v):
                field?caption(field.reason??field.status):'本报告未归档';
              return <div key={key}><dt>{label}</dt><dd>{display}{field&&<small> · {field.source}</small>}</dd></div>;
            })}</dl>
            <p className="muted">要复测：在手机点「更多工具 → GNSS 读数核对」，保存新报告，再手动上传并选择关联此设备。网页不会远程启动手机定位。</p>
          </div>}
        </details></li>)}</ul>
      </section>)}
    </div>
  </>;
}
