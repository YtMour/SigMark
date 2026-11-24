import {useEffect,useId,useMemo,useState} from 'react';
import {errorMessage,request} from './console';
import {caption,date,groups,saveDownload,type Report} from './reports';
import {PageHead} from './workspace-ui';
import {navigateReader,followReadLink,returnFromReader,returnLabel} from './reader-history';
import {hashParams} from './workspace-route';
import {ReportPicker} from './report-picker';
import {buildLab,suggestedBaseline,type LabSheet} from './lab-model';
import type {Parameter} from './compare';
import {AcceptanceComparison,AcceptancePanel} from './acceptance-panel';
import {buildVerification,objectiveOf,objectives,type FieldCatalog,type Objective} from './verification-package';
import {releaseQuery,type ReleaseReference} from './security-rules';
import {VerificationPanel} from './verification-panel';
import './lab.css';

const verdicts={lost:'失去读数',restored:'恢复读数',changed:'值变化',unchanged:'未变化',provenance:'来源或状态变化',not_comparable:'缺一侧档案'};
const renderState=(p:Parameter|undefined)=>p?(p.status==='AVAILABLE'?(p.value??'未取得读数'):caption(p.reason??p.status)):'未归档';
const keyValid=(id:string)=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export const labLink=(id:string,params:Record<string,string>={})=>'#lab?'+new URLSearchParams({report:id,...params});

export function LabPage(){
  const [hash,setHash]=useState(()=>location.hash);
  useEffect(()=>{const change=()=>setHash(location.hash);window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const params=hashParams(hash),id=params.get('report')??'',saved=params.get('saved')??'';
  const objective=objectiveOf(params.get('objective'));
  const selected=params.get('baseline');
  const requestKey=id+':'+saved;
  const [revision,retry]=useState(0);
  const [state,setState]=useState<{id:string;data?:LabSheet;error?:string}>();
  useEffect(()=>{
    if(!keyValid(id)||saved&&!keyValid(saved))return;
    const ctl=new AbortController();
    request<LabSheet>('/api/admin/reports/'+id+'/lab'+(saved?'?'+new URLSearchParams({saved}):''),{signal:ctl.signal})
      .then(data=>{if(!ctl.signal.aborted)setState({id:requestKey,data});})
      .catch(error=>{if(!ctl.signal.aborted)setState({id:requestKey,error:errorMessage(error)});});
    return ()=>ctl.abort();
  },[id,saved,requestKey,revision]);
  const data=state?.id===requestKey?state.data:undefined;
  const err=state?.id===requestKey?state.error:undefined;
  return <main className="workspace lab">
    <PageHead section="lab" description="从设备或报告开始，选择验收目标、实验和基线，核对风险并导出证据包。"/>
    {!id?<section className="panel"><h2>选择待复测报告</h2><p><a href="#assets?tab=devices">先从设备档案选择资产 →</a></p>
      <ReportPicker label="验收样本" value="" select={value=>{if(value)navigateReader(labLink(value));}}/></section>:
      !keyValid(id)||saved&&!keyValid(saved)?<p role="alert">报告或基线编号格式有误。<a href="#lab">重新选择</a></p>:
      err?<p role="alert">{err} <button type="button" className="secondary" onClick={()=>{setState(undefined);retry(n=>n+1);}}>重试</button></p>:
      data?<LabSheetView key={id} sheet={data} savedId={saved} selected={selected} objective={objective}/>:<p role="status">正在核对当前报告及同设备历史…</p>}
  </main>;
}

function LabSheetView({sheet,savedId,selected,objective}:{sheet:LabSheet;savedId:string;selected:string|null;objective:Objective}){
  const uid=useId(),current=sheet.current;
  const baselineID=selected??(savedId?'':suggestedBaseline(sheet)?.id??'');
  const [scope,setScope]=useState('delta'),[group,setGroup]=useState(''),[keyword,setKeyword]=useState('');
  const [inputs,setInputs]=useState({scope:'delta',group:'',keyword:''});
  const [catalog,setCatalog]=useState<{value?:FieldCatalog}>();
  const query=releaseQuery(current.report.appVersion,current.report.parameters??[]);
  const [publication,setPublication]=useState<{query:string;result:ReleaseReference}>();
  useEffect(()=>{
    const ctl=new AbortController(),signal=AbortSignal.any([ctl.signal,AbortSignal.timeout(8000)]);
    request<FieldCatalog>('/api/admin/field-dictionary',{signal}).then(value=>{if(!ctl.signal.aborted)setCatalog({value});})
      .catch(()=>{if(!ctl.signal.aborted)setCatalog({});});
    return ()=>ctl.abort();
  },[]);
  useEffect(()=>{
    if(!query)return;
    const ctl=new AbortController(),signal=AbortSignal.any([ctl.signal,AbortSignal.timeout(8000)]);
    request<ReleaseReference>('/api/admin/release-signer?'+query,{signal})
      .then(result=>{if(!ctl.signal.aborted)setPublication({query,result});})
      .catch(()=>{if(!ctl.signal.aborted)setPublication({query,result:{state:'error'}});});
    return ()=>ctl.abort();
  },[query]);
  const signer=query?(publication?.query===query?publication.result:{state:'loading'} as const):undefined;
  const packet=useMemo(()=>buildVerification(sheet,baselineID,savedId,objective,catalog?.value,signer),[sheet,baselineID,savedId,objective,catalog,signer]);
  const baseline=packet.source.baseline?[...sheet.history,sheet.registeredReport].find(row=>row?.id===packet.source.baseline?.reportId):undefined;
  const result=useMemo(()=>buildLab({...sheet,history:baseline?[baseline]:[]},baseline),[sheet,baseline]);
  const dispositions=new Map(packet.fields.map(f=>[f.key,f]));
  const rows=result.rows.filter(row=>(!group||row.group===group)&&(!keyword||[row.key,row.label,row.before?.value,row.after?.value,row.after?.source]
    .some(value=>value?.toLowerCase().includes(keyword)))&&
    (scope==='all'||(scope==='delta'&&(!baseline||(dispositions.get(row.key)?.temporal==='configuration'&&row.delta!=='unchanged'&&row.delta!=='not_comparable')))||
      (scope==='lost'&&row.delta==='lost')||(scope==='blocked'&&row.after?.status==='RESTRICTED')||
      (scope==='fieldset'&&dispositions.get(row.key)?.comparison==='field_set_gap')||
      (scope==='context'&&dispositions.get(row.key)?.comparison==='context_or_experiment')||
      (scope==='coverage'&&row.delta==='not_comparable')));
  const link=(row:Report)=>'#reports?report='+row.id;
  const assetLink=current.assetId?'#assets?'+new URLSearchParams({tab:'devices',sampleAsset:current.assetId}):'';
  const securityLink='#security?'+new URLSearchParams({report:current.id,...(baseline?{baseline:baseline.id}:{}),
    ...(packet.policy?{saved:packet.policy.id}:{})});
  const pick=savedId?'saved:'+savedId:baselineID;
  const r=result.restricted,t=result.transition;
  const validation=(value:string|null)=>value==='yes'?'已验证联网':value==='no'?'未验证联网':'未记录';
  const summary=baseline?[
    ['失去读数',result.counts.lost],['恢复读数',result.counts.restored],['值变化',result.counts.changed],['仅一侧归档',result.counts.not_comparable],
  ]:[['需用户授权',r.permission],['位置未开',r.location],['系统拒读',r.policy],['其他受限',r.other]];
  return <>
    <section className="panel lab-hero" aria-labelledby={uid+'-run'}>
      <div><p className="eyebrow">当前验收样本</p><h2 id={uid+'-run'}>{current.report.model}</h2>
        <p className="muted">API {current.report.androidApi||'—'} · {date(current.report.capturedAtEpochMs)}</p>
        <div className="actions"><a href={link(current)} onClick={followReadLink}>查看原报告</a>
          {assetLink&&<a href={assetLink} onClick={followReadLink}>回到设备档案</a>}
          <a href={securityLink} onClick={followReadLink}>指纹安全</a><a href="#lab" onClick={followReadLink}>换验收样本</a></div>
        {history.state?.sigmarkOrigin&&<div><button type="button" className="text-button" onClick={()=>returnFromReader('#lab')}>{returnLabel()}</button></div>}
      </div>
      <form aria-label="切换复测基线" action="#lab" onSubmit={event=>{
        event.preventDefault();
        const values=new FormData(event.currentTarget);
        const next=String(values.get('baseline')??'');
        navigateReader(labLink(current.id,{objective:objectiveOf(String(values.get('objective')??'')),
          ...(next.startsWith('saved:')?{saved:next.slice(6)}:{baseline:next})}));
      }}>
        <label htmlFor={uid+'-objective'}>验收目标</label>
        <select key={objective} id={uid+'-objective'} name="objective" defaultValue={objective}>
          {Object.entries(objectives).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
        <label htmlFor={uid+'-base'}>同一资产的基线</label>
        <div className="lab-inline"><select key={pick} id={uid+'-base'} name="baseline" defaultValue={pick}>
          <option value="">仅看当前</option>
          {packet.baselineUnavailable&&pick&&<option value={pick}>原基线已失效 · 请选择其他基线</option>}
          {!!sheet.registeredBaselines?.length&&<optgroup label="已登记的 ROM 基线">{sheet.registeredBaselines.map(x=>
            <option key={x.id} value={'saved:'+x.id}>{x.name} · {x.reportId.slice(0,8)}</option>)}</optgroup>}
          {sheet.history.map(row=><option key={row.id} value={row.id}>{date(row.report.capturedAtEpochMs)} · v{row.report.fieldSetVersion??'旧'} · {row.id.slice(0,8)}</option>)}
        </select><button type="submit">应用基线</button></div>
        <small>{!current.assetId?'当前报告未归组，不按型号推断同机。':!sheet.history.length?'没有更早且在库的同设备报告。':sheet.hasEarlier?'显示最近 '+sheet.historyLimit+' 份同设备旧报告。':'已列出更早、且在当前样本接收前已入库的同设备报告。'}</small>
        {baseline&&<a href={link(baseline)} onClick={followReadLink}>查看基线原报告</a>}
      </form>
    </section>
    <VerificationPanel packet={packet} pending={!catalog||signer?.state==='loading'} securityLink={securityLink}/>
    <section className="lab-kpis" aria-label={baseline?'读数变化统计':'当前受限原因'}>{summary.map(([title,count])=>
      <div key={title} className="panel"><strong>{count}</strong><span>{title}</span></div>)}</section>
    {result.hasTransition&&<section className="panel" aria-label="网络切换实验">
      <h2>网络切换实验</h2><p>{caption(t.before??'unknown')} → {caption(t.after??'unknown')} · {t.elapsed??'间隔未记录'}</p>
      <p className="muted">联网验证：{validation(t.beforeValidated)} → {validation(t.afterValidated)}。这是两次观测，间隔不是断网时长。</p>
    </section>}
    {result.acceptance?<AcceptanceComparison result={result.acceptance}/>:<AcceptancePanel row={current}/>}
    <section className="panel" aria-label="复测证据清单">
      <div className="pane-title"><div><h2>复测证据清单</h2><p className="muted">关注失值、受限和来源变化。网络、电量等即时波动不默认列作变化。</p></div>
        <button type="button" className="secondary" onClick={()=>saveDownload(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),
          'SigMark-lab-'+current.id.slice(0,8)+'.json')}>导出证据单 JSON</button></div>
      <search><form className="lab-filters" aria-label="筛选证据" action="#lab" onSubmit={event=>{
        event.preventDefault();setScope(inputs.scope);setGroup(inputs.group);setKeyword(inputs.keyword.trim().toLowerCase());
      }}>
        <div><label htmlFor={uid+'-scope'}>显示</label><select id={uid+'-scope'} name="scope" value={inputs.scope} onChange={e=>setInputs({...inputs,scope:e.target.value})}>
          <option value="delta">静态变化（无基线时显示当前）</option><option value="lost">失去读数</option>
          <option value="blocked">当前受限</option><option value="coverage">仅一侧归档</option><option value="all">全部</option>
          <option value="fieldset">跨字段集缺行</option><option value="context">瞬时或实验差异</option>
        </select></div>
        <div><label htmlFor={uid+'-group'}>分类</label><select id={uid+'-group'} name="group" value={inputs.group} onChange={e=>setInputs({...inputs,group:e.target.value})}>
          <option value="">所有分类</option>{[...new Set(result.rows.map(row=>row.group))].map(key=><option key={key} value={key}>{groups[key]??key}</option>)}
        </select></div>
        <label>字段或读数<input name="q" type="search" value={inputs.keyword} maxLength={80} onChange={e=>setInputs({...inputs,keyword:e.target.value})}/></label>
        <button type="submit">应用筛选</button>
      </form></search>
      <p role="status" className="muted">{rows.length} / {result.rows.length} 项</p>
      {rows.length?<div className="lab-table" tabIndex={0} role="region" aria-label="复测证据，可横向滚动">
        <table><thead><tr><th scope="col">字段</th>{baseline&&<th scope="col">基线</th>}<th scope="col">当前</th><th scope="col">结果</th></tr></thead>
          <tbody>{rows.map(row=><tr key={row.key}><th scope="row">{row.label}<small><code>{row.key}</code></small></th>
            {baseline&&<td>{renderState(row.before)}{row.before?.source&&<small>{row.before.source}</small>}</td>}
            <td>{renderState(row.after)}{row.after?.source&&<small>{row.after.source}{row.after.errno!=null?' · errno='+row.after.errno:''}</small>}</td>
            <td>{baseline?dispositions.get(row.key)?.comparison==='field_set_gap'?'字段在较新的协议中引入':
              dispositions.get(row.key)?.comparison==='context_or_experiment'?'瞬时或实验差异':verdicts[row.delta]:
              row.after?caption(row.after.status):'未归档'}</td></tr>)}</tbody>
        </table>
      </div>:<p className="muted">没有符合条件的字段。可在「显示」切换到全部或仅一侧归档。</p>}
    </section>
  </>;
}
