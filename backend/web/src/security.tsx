import {DeviceProfilePanel} from './device-profile';
import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {compareSecurity,evaluateSecurity,releaseQuery,ruleVersion,type ReleaseReference,type Evidence} from './security-rules';
import {caption,date,saveDownload,type Report} from './reports';
import {parameterKey} from './compare';
import {BaselineDialog,BaselineLibrary,useBaselines,type Baseline} from './baselines';
import {regressionResult} from './regression';
import {hashParams,relationToAsset,reportScope,reportWorkspaceLink} from './workspace-route';
import {ReportPicker} from './report-picker';
import {navigateReader,followReadLink} from './reader-history';
import {PageHead} from './workspace-ui';

const labels={observed:'有读数',review:'建议复核',unknown:'证据不足',context:'环境线索'};
const readSelection=()=>{
  const p=hashParams(location.hash);
  return {id:p.get('report')??'',baseline:p.get('baseline')??'',saved:p.get('saved')??'',
    expectUnlock:p.has('expectUnlock')?p.get('expectUnlock')==='1':undefined,retest:p.get('mode')==='retest',
    filters:reportScope(location.hash)};
};
export function SecurityPage(){
  const [selection,setSelection]=useState(readSelection);
  const {id,baseline,saved}=selection;
  const [libraryOpen,setLibraryOpen]=useState(false);
  const retest=selection.retest||!!baseline;
  const library=useBaselines(retest||libraryOpen);
  const profile=library.items.find(item=>item.id===saved&&item.reportId===baseline);
  const expectUnlock=selection.expectUnlock??profile?.expectUnlock??false;
  const [saveOpen,setSaveOpen]=useState(false);
  const [showCurrentPicker,setShowCurrentPicker]=useState(false);
  const [showHistoryPicker,setShowHistoryPicker]=useState(false);
  const [showOtherBaselines,setShowOtherBaselines]=useState(false);
  const [notice,setNotice]=useState('');
  const [report,setReport]=useState<Report>();
  const [error,setError]=useState('');
  const [reference,setReference]=useState<Report>();
  const [referenceError,setReferenceError]=useState('');
  useEffect(()=>{
    const follow=()=>setSelection(readSelection());
    window.addEventListener('hashchange',follow);
    return ()=>window.removeEventListener('hashchange',follow);
  },[]);
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
  const query=inspected?releaseQuery(inspected.report.appVersion,inspected.report.parameters??[]):'';
  const [publication,setPublication]=useState<{query:string;result:ReleaseReference}>();
  useEffect(()=>{
    if(!query)return;
    const ctl=new AbortController();
    request<ReleaseReference>('/api/admin/release-signer?'+query,{signal:ctl.signal})
      .then(result=>{if(!ctl.signal.aborted)setPublication({query,result});})
      .catch(()=>{if(!ctl.signal.aborted)setPublication({query,result:{state:'error'}});});
    return ()=>ctl.abort();
  },[query]);
  const asset=inspected?.assetId;
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
  const relation=relationToAsset(asset,left?.assetId);
  const pair=relation==='same';
  const savedCandidates=library.items.filter(item=>item.state==='ready'&&item.reportId!==id);
  const matching=savedCandidates.filter(item=>relationToAsset(asset,item.assetId)==='same');
  const others=savedCandidates.filter(item=>relationToAsset(asset,item.assetId)!=='same');
  const changeSelection=(changes:Partial<typeof selection>)=>{
    const next={...selection,...changes};
    setSelection(next);
    const hash=reportWorkspaceLink('security',next.filters,{report:next.id,baseline:next.baseline,
      saved:next.saved,retest:next.retest,expectUnlock:next.expectUnlock});
    if(next.id===id&&history.state?.sigmarkOrigin)navigateReader(hash);
    else location.hash=hash;
  };
  const useSaved=(item:Baseline)=>{
    changeSelection({id:id===item.reportId?'':id,baseline:item.reportId,saved:item.id,retest:true,expectUnlock:item.expectUnlock});
    setLibraryOpen(false);setShowHistoryPicker(false);setShowOtherBaselines(false);setNotice('');
  };
  const chooseCurrent=(value:string)=>{
    setNotice('');setShowCurrentPicker(false);setShowHistoryPicker(false);setShowOtherBaselines(false);
    changeSelection(value===baseline?{id:value,baseline:'',saved:'',expectUnlock:false}:{id:value});
  };
  const goToArchive=reportWorkspaceLink('reports',selection.filters,{report:id});
  const baselineChoices=(items:Baseline[])=><ul className="baseline-choices">{items.map(item=>
    <li key={item.id}>
      <div><strong>{item.name}</strong><small>{item.model} · {item.batch} · {item.reportId.slice(0,8)}{item.assetId&&asset&&item.assetId!==asset?' · 跨设备对照':''}</small></div>
      <button type="button" className="secondary" onClick={()=>useSaved(item)} aria-label={`使用基线：${item.name}`}>使用基线</button>
    </li>)}</ul>;
  const evidence=new Map(inspected?.report.parameters?.map(row=>[parameterKey(row),row]));
  const legacy=new Map(inspected?.report.schemaVersion===1?inspected.report.metrics.map(row=>[row.key,row]):[]);
  const priority={review:0,unknown:1,observed:2,context:3};
  const checks=inspected?evaluateSecurity(inspected.report,query?(publication?.query===query?publication.result:{state:'loading'}):undefined)
    .sort((a,b)=>priority[a.state]-priority[b.state]):[];
  const changes=left&&inspected?compareSecurity(left.report.parameters??[],inspected.report.parameters??[],expectUnlock&&pair):[];
  const result=left&&inspected?regressionResult(left,inspected,changes,{sameAsset:pair,expectUnlock,
    baseline:profile?{id:profile.id,name:profile.name}:undefined,expectedNetwork:profile?.expectedNetwork}):undefined;
  const evidencePanel=<section className="security-results" aria-label="安全检查结果">
    <div className="pane-title"><div><h2>当前样本证据</h2>
      <p className="muted">{checks.filter(c=>c.state==='review').length} 项建议复核 · {checks.filter(c=>c.state==='unknown').length} 项证据不足 · 未进行硬件证明 · {ruleVersion}</p></div></div>
    <div className="security-readings">
    {checks.map(check=><details key={id+check.id} className="panel security-card" data-card={check.id}>
      <summary><strong>{check.title}</strong> <span className={'tag security-'+check.state}>{labels[check.state]}</span><span className="security-finding">{check.finding}</span></summary>
        <dl>{check.fields.map(key=>{
          const field=evidence.get(key),record=legacy.get(key);
          return <div key={key}><dt>{field?.label??key} <code>{field?key:''}</code></dt>
            <dd>{field?<><strong>{field.value??caption(field.status)}</strong>
              <small>{field.source}{field.reason?' · '+caption(field.reason):''}{field.errno!=null?' · errno='+field.errno:''}</small>
              {field.note&&<small>{field.note}</small>}</>:record?<small>旧协议仅保存：{caption(record.status)}</small>:<small>未归档</small>}</dd></div>;
        })}{check.id==='signer'&&publication?.query===query&&publication.result.state==='registered'&&
          <div><dt>对应发布证书 SHA-256 · 内网发布登记</dt><dd><code>{publication.result.signerSha256}</code></dd></div>}</dl>
    </details>)}</div>
  </section>;
  return <main className="workspace security-workspace">
    <PageHead section="security" title={retest?'安全复测':undefined}
      description={retest?'对照复测前后的证据，区分预期变化与待复核项。':'查看启动链、保护状态和调试线索。这些证据不等于硬件认证。'}>
      <button type="button" className="secondary" aria-expanded={libraryOpen} aria-controls={libraryOpen?'baseline-library':undefined}
        onClick={()=>{if(!libraryOpen)library.reload();setLibraryOpen(open=>!open);}}>已保存的基线{library.items.length?` · ${library.items.length}`:''}</button>
    </PageHead>
    {(!id||libraryOpen)&&<section className="panel" aria-label="选择安全分析样本">
      <div className="pane-title"><div><h2>{id?'管理回归基线':'选择待分析报告'}</h2><p className="muted">{baseline?
        (profile?`当前基线：${profile.name}`:`已选基线 · ${baseline.slice(0,8)}`):'单份检查不需要基线。'}</p></div>
        <div className="actions">
          {baseline&&<button type="button" className="text-button" onClick={()=>changeSelection({baseline:'',saved:'',expectUnlock:false})}>取消对比</button>}
        </div></div>
      {libraryOpen&&<div id="baseline-library"><BaselineLibrary {...library} use={useSaved}/></div>}
      {!id&&<ReportPicker label="分析样本" value="" select={chooseCurrent} exclude={baseline} asset={profile?.assetId??undefined}/>}
    </section>}
    {id&&(error?<p className="panel inset error" role="alert">{error} <a className="subtle-link" href="#security">选择其他报告</a></p>:!inspected?
      <p className="panel empty" role="status">正在读取归档证据…</p>:<>
        <section className="panel security-context"><div>
          <p className="eyebrow">当前报告</p>
          <h2>{inspected.report.model} · API {inspected.report.androidApi||'—'}</h2>
          <p className="muted">{inspected.batch} · App {inspected.report.appVersion} · 采样 {date(inspected.report.capturedAtEpochMs)}</p>
          <code>{inspected.id}</code>
        </div>
          <div className="actions">
            {!retest&&<button type="button" onClick={()=>changeSelection({retest:true})}>与基线复测</button>}
            <button type="button" className="secondary" aria-expanded={showCurrentPicker} onClick={()=>setShowCurrentPicker(open=>!open)}>更换当前报告</button>
            <a className="subtle-link" onClick={followReadLink} href={goToArchive}>返回报告详情</a>
          </div>
          {showCurrentPicker&&<ReportPicker label="分析样本" value={id} select={chooseCurrent} exclude={baseline}
            fallback={inspected.report.model}/>}
        </section>
        {notice&&<p className="panel inset" role="status">{notice}</p>}
        {retest&&<section className="panel security-change" aria-label="安全变化对比">
          <div className="pane-title"><div><h2>{baseline?'安全变化对比':'选择复测基线'}</h2>
            <p className="muted">{baseline?(profile?.name??`临时基线 · ${baseline.slice(0,8)}`):'当前报告已带入。请选择一份基线，不会自动开始比较。'}</p></div>
            <div className="actions">
            {baseline&&<button className="secondary" type="button" onClick={()=>changeSelection({baseline:'',saved:'',expectUnlock:undefined,retest:true})}>更换基线</button>}
            {result&&<button type="button" className="secondary" onClick={()=>saveDownload(
              new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),
              `SigMark-regression-${id.slice(0,8)}.json`)}>导出对比 JSON</button>}
            <button className="text-button" type="button" onClick={()=>changeSelection({baseline:'',saved:'',expectUnlock:undefined,retest:false})}>退出复测</button>
            </div></div>
          {!baseline&&<div className="baseline-picker">
            <h3>同设备的已保存基线</h3>
            {library.loading?<p className="muted" role="status">正在读取已保存基线…</p>:
              library.error?<p className="error" role="alert">{library.error} <button type="button" className="secondary" onClick={library.reload}>重试</button></p>:
              matching.length?baselineChoices(matching):<p className="muted">{asset?'此设备没有可用的已保存基线。':'当前报告未归组，无法识别同设备基线。'}</p>}
            <div className="actions">
              <button type="button" className="secondary" aria-expanded={showHistoryPicker} onClick={()=>setShowHistoryPicker(open=>!open)}>从历史报告选择</button>
              {!!others.length&&<button type="button" className="text-button" aria-expanded={showOtherBaselines} onClick={()=>setShowOtherBaselines(open=>!open)}>其他已保存基线 · {others.length}</button>}
            </div>
            {showOtherBaselines&&baselineChoices(others)}
            {showHistoryPicker&&<ReportPicker key={id} label="基线报告" value="" select={value=>{
              if(value){changeSelection({baseline:value,saved:'',expectUnlock:false,retest:true});setShowHistoryPicker(false);}
            }} exclude={id} asset={asset}/>}
          </div>}
          {referenceError?<p className="error inset" role="alert">{referenceError}</p>:baseline&&!left?
            <p className="empty" role="status">正在读取基线…</p>:left&&result&&<>
              <section className="regression-counters" aria-label="复测摘要">
                <div><b>{result.verdicts.review}</b> 建议复核</div><div><b>{result.verdicts.insufficient}</b> 安全证据不足</div>
                <div><b>{result.counts.lostValue}</b> 已归档字段失去读数</div><div><b>{result.counts.currentOnly}</b> 当前新增归档字段</div>
              </section>
              <div className="security-compare-note">
                <p>{pair?'同一仓库设备的两次采样。':relation==='different'?'跨设备对照：两份报告属于不同设备，不代表同一台设备的变化。':'设备归属未确认：只做证据对照，不应视为某部手机的变化。'}</p>
                {pair&&<label className="build-check"><input type="checkbox" checked={expectUnlock} onChange={e=>changeSelection({expectUnlock:e.target.checked})}/>本次实验 ROM 预期解锁</label>}
                {(left.report.fieldSetVersion??0)!==(inspected.report.fieldSetVersion??0)&&
                  <p>字段集不同。新增字段或缺失证据不计为变化。</p>}
                {left.report.capturedAtEpochMs>=inspected.report.capturedAtEpochMs&&<p>基线采样时间不早于当前样本，请检查选择顺序。</p>}
                {result.context.network.expected&&<p className={result.context.network.state==='mismatch'?'security-review':undefined}>
                  预期默认网络：{caption(result.context.network.expected)} · 基线：{caption(result.context.network.baseline??'unknown')} · 当前：{caption(result.context.network.current??'unknown')} · {
                    {matched:'条件一致',mismatch:'条件不一致，建议在相同网络下复测',insufficient:'证据不足',not_required:''}[result.context.network.state]}
                </p>}
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
        </section>}
        <DeviceProfilePanel key={inspected.id} reportId={inspected.id} />
        {evidencePanel}
        <div className="actions security-secondary"><button className="secondary" type="button" onClick={()=>setSaveOpen(true)}>保存当前为回归基线</button>
          <button className="text-button" type="button" onClick={()=>{setLibraryOpen(true);library.reload();window.scrollTo(0,0);}}>管理已保存的基线</button></div>
        {saveOpen&&<BaselineDialog reportId={inspected.id} model={inspected.report.model} expectUnlock={false}
          close={()=>setSaveOpen(false)} saved={()=>{setSaveOpen(false);library.reload();setNotice('已保存回归基线。可在页面顶部使用它复测。');}}/>}
      </>)}
  </main>;
}

const changeLabels={unchanged:'读数一致',changed:'读数变化',review:'建议复核',expected:'预期变化',insufficient:'证据不足'};
function CompareEvidence({evidence}:{evidence?:Evidence}){
  if(!evidence)return <small>未归档</small>;
  return <><span>{evidence.value??caption(evidence.status)}</span>
    <small>{evidence.source}{evidence.reason?' · '+caption(evidence.reason):''}{evidence.errno!=null?' · errno='+evidence.errno:''}</small></>;
}
