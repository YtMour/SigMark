import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {compareSecurity,evaluateSecurity,type Evidence} from './security-rules';
import {caption,date,saveDownload,type Page,type Report} from './reports';
import {parameterKey} from './compare';
import {BaselineDialog,BaselineLibrary,useBaselines,type Baseline} from './baselines';
import {regressionResult} from './regression';

const labels={observed:'有读数',review:'建议复核',unknown:'证据不足',context:'环境线索'};
const readSelection=()=>{
  const p=new URLSearchParams(location.hash.split('?')[1]);
  return {id:p.get('report')??'',baseline:p.get('baseline')??'',saved:p.get('saved')??'',
    expectUnlock:p.has('expectUnlock')?p.get('expectUnlock')==='1':undefined};
};
export const securityLink=(id:string)=>'#security?'+new URLSearchParams({report:id});
export const securityPairLink=(baseline:string,current:string)=>'#security?'+new URLSearchParams({report:current,baseline});

export function SecurityPage(){
  const [selection,setSelection]=useState(readSelection);
  const {id,baseline,saved}=selection;
  const library=useBaselines();
  const profile=library.items.find(item=>item.id===saved&&item.reportId===baseline);
  const expectUnlock=selection.expectUnlock??profile?.expectUnlock??false;
  const [saveOpen,setSaveOpen]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState(''),[q,setQ]=useState('');
  const [list,setList]=useState<Page>();
  const [listError,setListError]=useState('');
  const [report,setReport]=useState<Report>();
  const [error,setError]=useState('');
  const [reference,setReference]=useState<Report>();
  const [referenceError,setReferenceError]=useState('');
  const [history,setHistory]=useState<{asset:string;items:Page['items']}>();
  useEffect(()=>{
    const follow=()=>setSelection(readSelection());
    window.addEventListener('hashchange',follow);
    return ()=>window.removeEventListener('hashchange',follow);
  },[]);
  useEffect(()=>{
    const c=new AbortController();setList(undefined);setListError('');
    request<Page>('/api/admin/reports?'+new URLSearchParams({q}),{signal:c.signal}).then(data=>{
      if(!c.signal.aborted)setList(data);
    }).catch(err=>{if(!c.signal.aborted)setListError(errorMessage(err));});
    return ()=>c.abort();
  },[q]);
  useEffect(()=>{
    const c=new AbortController();setReport(undefined);setError('');
    if(id&&!/^[0-9a-f-]{36}$/.test(id)){setError('报告编号无效。');return;}
    if(!id)return;
    request<Report>('/api/admin/reports/'+id+'?include=asset',{signal:c.signal}).then(data=>{
      if(!c.signal.aborted){
        if(data.trashedAt)setError('报告已移入回收站，请从资产管理恢复后再分析。');
        else setReport(data);
      }
    }).catch(err=>{if(!c.signal.aborted)setError(errorMessage(err));});
    return ()=>c.abort();
  },[id]);
  const inspected=report?.id===id?report:undefined;
  const asset=inspected?.assetId;
  useEffect(()=>{
    if(!asset)return;
    const c=new AbortController();
    request<Page>('/api/admin/reports?'+new URLSearchParams({q:'asset:'+asset}),{signal:c.signal})
      .then(page=>{if(!c.signal.aborted)setHistory({asset,items:page.items});}).catch(()=>{});
    return ()=>c.abort();
  },[asset]);
  useEffect(()=>{
    setReference(undefined);setReferenceError('');
    if(!baseline||!id)return;
    if(baseline===id||!/^[0-9a-f-]{36}$/.test(baseline)){setReferenceError('请选择不同的基线报告。');return;}
    const c=new AbortController();
    request<Report>('/api/admin/reports/'+baseline+'?include=asset',{signal:c.signal}).then(row=>{
      if(!c.signal.aborted){
        if(row.trashedAt)setReferenceError('基线已移入回收站，请另选报告。');
        else setReference(row);
      }
    }).catch(err=>{if(!c.signal.aborted)setReferenceError(errorMessage(err));});
    return ()=>c.abort();
  },[id,baseline]);
  const left=reference?.id===baseline?reference:undefined;
  const pair=!!(inspected?.assetId&&left?.assetId===inspected.assetId);
  const possible=new Map([...(history&&history.asset===asset?history.items:[]),...(list?.items??[])].map(row=>[row.id,row]));
  const changeSelection=(changes:Partial<typeof selection>)=>{
    const next={...selection,...changes};
    setSelection(next);
    const p=new URLSearchParams();
    if(next.id)p.set('report',next.id);
    if(next.baseline)p.set('baseline',next.baseline);
    if(next.saved)p.set('saved',next.saved);
    if(next.baseline&&next.expectUnlock!==undefined)p.set('expectUnlock',next.expectUnlock?'1':'0');
    location.hash='#security'+(p.size?'?'+p:'');
  };
  const useSaved=(item:Baseline)=>{
    changeSelection({id:id===item.reportId?'':id,baseline:item.reportId,saved:item.id,expectUnlock:item.expectUnlock});
    setLibraryOpen(false);setNotice('');
  };
  const evidence=new Map(inspected?.report.parameters?.map(row=>[parameterKey(row),row]));
  const legacy=new Map(inspected?.report.schemaVersion===1?inspected.report.metrics.map(row=>[row.key,row]):[]);
  const checks=inspected?evaluateSecurity(inspected.report):[];
  const changes=left&&inspected?compareSecurity(left.report.parameters??[],inspected.report.parameters??[],expectUnlock&&pair):[];
  const result=left&&inspected?regressionResult(left,inspected,changes,{sameAsset:pair,expectUnlock,
    baseline:profile?{id:profile.id,name:profile.name}:undefined}):undefined;
  const evidencePanel=<section className="security-results" aria-label="安全检查结果">
    <div className="pane-title"><div><h2>当前样本证据</h2>
      <p className="muted">{checks.filter(c=>c.state==='review').length} 项建议复核 · {checks.filter(c=>c.state==='unknown').length} 项证据不足</p></div></div>
    <div className="security-grid">
    {checks.map(check=><article key={check.id} className="panel security-card" data-card={check.id}>
      <header><h2>{check.title}</h2><span className={'tag security-'+check.state}>{labels[check.state]}</span></header>
      <p>{check.finding}</p>
      <details><summary>展开原始证据</summary>
        <dl>{check.fields.map(key=>{
          const field=evidence.get(key),record=legacy.get(key);
          return <div key={key}><dt>{field?.label??key} <code>{field?key:''}</code></dt>
            <dd>{field?<><strong>{field.value??caption(field.status)}</strong>
              <small>{field.source}{field.reason?' · '+caption(field.reason):''}{field.errno!=null?' · errno='+field.errno:''}</small>
              {field.note&&<small>{field.note}</small>}</>:record?<small>旧协议仅保存：{caption(record.status)}</small>:<small>未归档</small>}</dd></div>;
        })}</dl>
      </details>
    </article>)}</div>
  </section>;
  return <main className="workspace security-workspace">
    <header className="page-heading collection-heading"><div>
      <p className="eyebrow">指纹安全 / 设备证据</p><h1>指纹安全</h1>
      <p className="muted">检查一份报告，或用保存的基线复测 ROM 变化。</p>
    </div><span className="tag">设备真实性：未认证</span></header>
    <section className="panel" aria-label="选择安全分析样本">
      <div className="pane-title"><div><h2>选择样本</h2><p className="muted">{baseline?
        (profile?`当前基线：${profile.name}`:`已选基线 · ${baseline.slice(0,8)}`):'单份检查不需要基线。'}</p></div>
        <div className="actions">
          {baseline&&<button type="button" className="text-button" onClick={()=>changeSelection({baseline:'',saved:'',expectUnlock:false})}>取消对比</button>}
          <button type="button" className="secondary" aria-expanded={libraryOpen} aria-controls="baseline-library" onClick={()=>{if(!libraryOpen)library.reload();setLibraryOpen(open=>!open);}}>已保存的基线{library.items.length?` · ${library.items.length}`:''}</button>
        </div></div>
      {libraryOpen&&<div id="baseline-library"><BaselineLibrary {...library} use={useSaved}/></div>}
      <div className="security-select">
      <form className="actions" onSubmit={e=>{e.preventDefault();setQ(search.trim());}}>
        <label>查找报告<input value={search} maxLength={80} onChange={e=>setSearch(e.target.value)} placeholder="型号、批次、报告编号或构建号"/></label>
        <button>搜索</button>
      </form>
      <label>分析样本<select aria-label="分析样本" value={id} onChange={e=>{
        setNotice('');const value=e.target.value;
        changeSelection(value===baseline?{id:value,baseline:'',saved:'',expectUnlock:false}:{id:value});
      }}>
        <option value="">选择最近报告或搜索报告</option>
        {id&&!list?.items.some(row=>row.id===id)&&<option value={id}>{inspected?.report.model??'链接中的报告'} · {id.slice(0,8)}</option>}
        {list?.items.map(row=><option key={row.id} value={row.id}>{row.report.model} · {row.batch} · {date(row.receivedAt)} · {row.id.slice(0,8)}</option>)}
      </select></label>
      {listError&&<p className="error" role="status">{listError}</p>}
      </div>
    </section>
    {!id?<section className="panel empty">直接选一份报告开始检查。最近样本在上方，也可以按型号、批次或报告编号搜索。</section>:
      error?<p className="panel inset error" role="alert">{error}</p>:!inspected?
      <p className="panel empty" role="status">正在读取归档证据…</p>:<>
        <section className="panel security-context"><div>
          <h2>{inspected.report.model} · API {inspected.report.androidApi||'—'}</h2>
          <p className="muted">{inspected.batch} · App {inspected.report.appVersion} · 采样 {date(inspected.report.capturedAtEpochMs)}</p>
          <code>{inspected.id}</code>
        </div><div><strong>证据来源：普通应用报告</strong>
          <p className="muted">以下信号由客户端上传，未做硬件证明或独立身份验证。环境变更后请重新采样。</p></div>
          <div className="actions"><button className="secondary" type="button" onClick={()=>setSaveOpen(true)}>保存当前为回归基线</button>
            <a className="subtle-link" href={'#reports?report='+inspected.id}>查看完整报告 →</a></div>
        </section>
        {notice&&<p className="panel inset" role="status">{notice}</p>}
        {!baseline&&evidencePanel}
        <section className="panel security-change" aria-label="安全变化对比">
          <div className="pane-title"><div><h2>安全变化对比</h2>
            <p className="muted">比较两份报告的安全读数；未归档与读数变化分开统计。</p></div>
            {result&&<button type="button" className="secondary" onClick={()=>saveDownload(
              new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),
              `SigMark-regression-${id.slice(0,8)}.json`)}>导出对比 JSON</button>}</div>
          <div className="security-compare-tools">
            <label>临时选择基线<select aria-label="基线报告" value={baseline} onChange={e=>changeSelection({baseline:e.target.value,saved:'',expectUnlock:false})}>
              <option value="">选择一份基线报告</option>
              {baseline&&!possible.has(baseline)&&<option value={baseline}>{left?.report.model??'链接中的基线'} · {baseline.slice(0,8)}</option>}
              {[...possible.values()].filter(row=>row.id!==id).sort((a,b)=>Number(!!asset&&b.report.assetId===asset)-Number(!!asset&&a.report.assetId===asset)).map(row=>
                <option value={row.id} key={row.id}>{asset&&row.report.assetId===asset?'同设备 · ':''}{row.report.model} · {date(row.report.capturedAtEpochMs??row.receivedAt)} · {row.id.slice(0,8)}</option>)}
            </select></label>
            {!!baseline&&<label className="build-check"><input type="checkbox" checked={expectUnlock&&pair} disabled={!pair}
              onChange={e=>changeSelection({expectUnlock:e.target.checked})}/>本次实验 ROM 预期解锁</label>}
          </div>
          {referenceError?<p className="error inset" role="alert">{referenceError}</p>:baseline&&!left?
            <p className="empty" role="status">正在读取基线…</p>:left&&result&&<>
              <section className="regression-counters" aria-label="复测摘要">
                <div><b>{result.verdicts.review}</b> 建议复核</div><div><b>{result.verdicts.insufficient}</b> 安全证据不足</div>
                <div><b>{result.counts.lostValue}</b> 已归档字段失去读数</div><div><b>{result.counts.currentOnly}</b> 当前新增归档字段</div>
              </section>
              <div className="security-compare-note">
                <p>{pair?'同一仓库设备的两次采样。':'这两份报告未确认属于同一设备；只做证据对照，不应视为某部手机的变化。'}</p>
                {(left.report.fieldSetVersion??0)!==(inspected.report.fieldSetVersion??0)&&
                  <p>字段集不同。新增字段或缺失证据不计为变化。</p>}
                {left.report.capturedAtEpochMs>=inspected.report.capturedAtEpochMs&&<p>基线采样时间不早于当前样本，请检查选择顺序。</p>}
                <a className="subtle-link" href={'#reports?report='+left.id}>查看基线原报告 →</a>
              </div>
              <div className="stats-table-scroll" role="region" aria-label="安全证据对照表，可横向滚动" tabIndex={0}>
                <table className="security-compare-table"><thead><tr><th>证据</th><th>基线读数</th><th>当前读数</th><th>结果</th></tr></thead>
                  <tbody>{changes.map(row=>
                    <tr key={row.key}><th scope="row">{row.title}<small><code>{row.key}</code></small></th>
                      <td><CompareEvidence evidence={row.baseline}/></td><td><CompareEvidence evidence={row.current}/></td>
                      <td><b className={row.verdict==='review'?'security-review':undefined}>{changeLabels[row.verdict]}</b><small>{row.note}</small></td>
                    </tr>)}</tbody></table>
              </div>
            </>}
        </section>
        {!!baseline&&evidencePanel}
        {saveOpen&&<BaselineDialog reportId={inspected.id} model={inspected.report.model} expectUnlock={false}
          close={()=>setSaveOpen(false)} saved={()=>{setSaveOpen(false);library.reload();setNotice('已保存回归基线。可在页面顶部使用它复测。');}}/>}
      </>}
  </main>;
}

const changeLabels={unchanged:'读数一致',changed:'读数变化',review:'建议复核',expected:'预期变化',insufficient:'证据不足'};
function CompareEvidence({evidence}:{evidence?:Evidence}){
  if(!evidence)return <small>未归档</small>;
  return <><span>{evidence.value??caption(evidence.status)}</span>
    <small>{evidence.source}{evidence.reason?' · '+caption(evidence.reason):''}{evidence.errno!=null?' · errno='+evidence.errno:''}</small></>;
}
