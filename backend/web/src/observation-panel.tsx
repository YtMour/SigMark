import {useId,useState} from 'react';
import {caption,date,type IdentityReview,type Report} from './reports';
import {request} from './console';
import {compareObservation,followupFor,extendedObservationFields,rootObservationFields,maxObservationBytes,parseObservation,
  appIdentityKeys,parseAppIdentity,summarizeObservationIdentity,type AppIdentitySample,type Observation} from './observation.mjs';
import './observation.css';

type ObservationSample = Pick<Report['report'],'capturedAtEpochMs'|'model'|'parameters'|'collectorVersion'|'fieldSetVersion'> &
  {appVersion?:string};

const identityLabels:Record<string,string>={
  'system.model':'型号','system.device':'设备代号','system.initialSdk':'初始 Android API 级别',
  'system.boardPlatform':'平台代号','system.bootHardware':'启动硬件','system.hardwareSku':'硬件 SKU',
};

export function SavedIdentityReview({reportId,review}:{reportId:string;review:IdentityReview}){
  // A separate App + ADB record, never a source of App risk or missing App fields.
  const sameReport=review.reportId===reportId;
  return <details className="panel security-card" data-section="saved-external-identity-review">
    <summary><strong>{review.different?`${review.different} 项身份声明不一致`:'已比对的身份声明一致'}</strong>
      {!sameReport&&<small className="risk-rule-status">同资产历史记录</small>}
    </summary>
    <p>App 采样：{date(review.capturedAtEpochMs)} · ADB 观察：{date(review.observedAtEpochMs)}</p>
    <p className="muted">这是 App 与 ADB 的历史对照，不计入 App 安全结果，也不用于确认设备身份。</p>
    {!sameReport&&<p><a href={'#security?report='+review.reportId}>查看原对照报告</a></p>}
    <dl>{review.pairs.filter(pair=>pair.state!=='missing').map(pair=><div key={pair.key}>
      <dt>{identityLabels[pair.key]??pair.key}</dt>
      <dd>App：{pair.app} · ADB：{pair.shell}</dd>
    </div>)}</dl>
  </details>;
}

export function ObservationPanel({report,showGaps=false,local=false,onSaveIdentityReview}:{
  report:{id?:string;report:ObservationSample};showGaps?:boolean;local?:boolean;
  onSaveIdentityReview?:(review:IdentityReview)=>void;
}) {
  const id = useId();
  const [loaded,setLoaded] = useState<{observation:Observation;confirmed:boolean}>();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [saveStatus,setSaveStatus] = useState('');
  const archived = new Map(report.report.parameters?.map(row => [row.group+'.'+row.key,row]));
  const gaps=[...archived.values()].filter(row=>row.status!=='AVAILABLE');
  const selinuxBasis=archived.get('system.selinuxEvidence');
  const observation=loaded?.observation;
  const capture=report.report.capturedAtEpochMs;
  const comparableTime=!!observation&&capture>0&&Math.abs(capture-observation.observedAtEpochMs)<=300000;
  const identity=summarizeObservationIdentity(report.report.model,archived,observation,loaded?.confirmed??false,comparableTime);
  const coverage=`可比 ${identity.compared} / ${identity.total} 项`;
  const identityText={
    not_loaded:'尚未导入 ADB 观察文件',
    unpaired:'等待确认两份记录来自同一台设备',
    stale:'采样时间不在五分钟对照窗口内，请重新采样',
    insufficient:'双方缺少可比较的身份声明',
    matching:`已比较的声明一致（${coverage}）`,
    different:`发现 ${identity.different} 项声明不一致（${coverage}）`,
  }[identity.state];
  return <section className="panel evidence-observations" aria-labelledby={id+'-title'}>
    <h2 id={id+'-title'}>证据来源对照</h2>
    <p role="status" data-identity-state={identity.state}><strong>跨来源身份对照</strong> · {identityText}</p>
    <p className="muted">确认同机后比对。采样相差超过 5 分钟时仅展示读数。</p>
    {showGaps&&<details open>
      <summary>本次已归档待复核字段 · {gaps.length} 项</summary>
      <p>未归档的字段不计入这个列表。补充证据独立显示，不更改 App 原值、覆盖统计或风险等级。</p>
      <ul className="observation-gaps">{gaps.map(row=><li key={row.group+'.'+row.key}>
        <strong>{row.label}</strong> · <code>{row.group}.{row.key}</code><br/>
        <small>{caption(row.status)}{row.reason?' · '+caption(row.reason):''}{row.errno!=null?' · errno='+row.errno:''} · {row.source}</small><br/>
        <span>{followupFor(row,archived)}</span>
      </li>)}</ul>
      {!gaps.length&&<p>{archived.size?'这份报告的已归档字段均有读数。':'这份报告没有归档字段可核对。'}</p>}
    </details>}
    <div className="evidence-file">
      <label htmlFor={id+'-file'}>打开 ADB 观察 JSON</label>
      <input id={id+'-file'} type="file" accept=".json,application/json" disabled={busy}
        aria-invalid={!!error} aria-describedby={error ? id+'-error' : undefined}
        onChange={async e=>{
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setLoaded(undefined);
          setError('');
          setSaveStatus('');
          setBusy(true);
          try {
            if (file.size > maxObservationBytes) throw Error('观察文件超过 8 KiB，请选择脚本生成的 JSON。');
            setLoaded({observation:parseObservation(await file.text()),confirmed:false});
          } catch (e) {
            setError(e instanceof Error ? e.message : '读取文件失败，请重新选择。');
          } finally { setBusy(false); }
        }}/>
      {error&&<p id={id+'-error'} className="error" role="alert">{error}</p>}
    </div>
    <dl className="observation-meta">
      <div><dt>App 采样</dt><dd>{report.report.model==='unknown'?'型号未上报':report.report.model} · {report.report.collectorVersion??report.report.appVersion}
        {!local&&` · 字段集 ${report.report.fieldSetVersion??'未标注'}`}</dd>
        <dd>{date(report.report.capturedAtEpochMs)}</dd></div>
      <div><dt>外部观察</dt><dd>{observation?(observation.model??'型号未上报'):'尚未打开文件'}</dd>
        {observation&&<dd>{date(observation.observedAtEpochMs)}</dd>}</div>
      <div><dt>独立验证</dt><dd>未执行</dd></div>
    </dl>
    {loaded&&observation&&<>
      <div className="pane-title">
        <p>{observation.model===null?'外部观察未上报型号。请根据采样记录核对设备对应关系。':
          report.report.model.trim().toLowerCase()===observation.model.toLowerCase()
          ?'两份记录的型号相同。请核对设备对应关系。'
          :'两份记录的型号不同。请根据采样记录核对设备对应关系。'}</p>
        <button className="secondary" type="button" onClick={()=>setLoaded(undefined)}>移除观察文件</button>
      </div>
      <div className="observation-confirmation">
        <input id={id+'-same-device'} type="checkbox" checked={loaded.confirmed}
          disabled={busy}
          onChange={event=>setLoaded({...loaded,confirmed:event.currentTarget.checked})}/>
        <label htmlFor={id+'-same-device'}>已核对，这是同一台设备</label>
      </div>
      {report.id&&onSaveIdentityReview&&observation.observer==='ADB_SHELL'&&identity.compared>0&&
        <button type="button" className="secondary" disabled={busy} onClick={async ()=>{
          setBusy(true);
          setSaveStatus('');
          try {
            const readings=Object.fromEntries([...appIdentityKeys].map(key=>
              [key,key==='system.model'?observation.model:observation.readings[key]??null]));
            const review=await request<IdentityReview>('/api/admin/reports/'+report.id+'/identity-review',
              {method:'PUT',body:JSON.stringify({observer:observation.observer,observedAtEpochMs:observation.observedAtEpochMs,
                readings,confirmed:loaded.confirmed})});
            onSaveIdentityReview(review);
            setSaveStatus('已保存至辅助对照，不计入 App 安全结果');
          } catch {
            setSaveStatus('保存未完成，请核对报告权限和采样时间');
          } finally {
            setBusy(false);
          }
        }}>保存身份对照</button>}
      {saveStatus&&<p role="status">{saveStatus}</p>}
      <p className="muted">App 与外部观察均来自设备系统。独立验证状态见上方。</p>
      <div className="observation-scroll" role="region" aria-label="App 与 ADB 读数，可横向滚动" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">检查项</th><th scope="col">{local?'App 身份文件':'App 报告'}</th><th scope="col">{observation.observer==='ROOT'?'root 观察':'ADB shell'}</th>{loaded.confirmed&&<th scope="col">对照结果</th>}</tr></thead>
          <tbody>{(observation.observer==='ROOT'?rootObservationFields:extendedObservationFields)
            .filter(([key])=>Object.hasOwn(observation.readings,key)&&(!local||appIdentityKeys.has(key))).map(([key,label,source])=>{
            const app=archived.get(key), adb=observation.readings[key];
            return <tr key={key}><th scope="row">{label}</th>
              <td>{app ? (app.status==='AVAILABLE' ? (app.value??'无有效读数') : caption(app.status)) : '该报告未归档'}
                {app?.errno!=null&&' · errno='+app.errno}{app?.source&&<small>{app.source}</small>}</td>
              <td>{adb??'未返回'}<small>{source}</small></td>
              {loaded.confirmed&&<td>{compareObservation(key,app,adb,comparableTime,selinuxBasis?.status==='AVAILABLE'?selinuxBasis.value:null)}</td>}</tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}

export function LocalIdentityComparison() {
  const inputId = useId();
  const [sample,setSample] = useState<AppIdentitySample>();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  return <>
    <section className="panel evidence-observations" aria-labelledby={inputId+'-title'}>
      <h2 id={inputId+'-title'}>本地身份对照</h2>
      <div className="evidence-file">
        <label htmlFor={inputId}>打开 App 身份对照 JSON</label>
        <p id={inputId+'-hint'} className="muted">在手机「指纹安全」保存身份对照 JSON，再选择同机的 ADB 观察文件。文件仅在浏览器中使用。</p>
        <input id={inputId} type="file" accept=".json,application/json" disabled={busy} aria-invalid={!!error}
          aria-describedby={inputId+'-hint'+(error?' '+inputId+'-error':'')}
          onChange={async event => {
            const file=event.currentTarget.files?.[0];
            event.currentTarget.value='';
            if(!file)return;
            setSample(undefined);
            setError('');
            setBusy(true);
            try {
              if(file.size>maxObservationBytes)throw Error('文件超过 8 KiB，请使用 App 保存的身份对照 JSON。');
              setSample(parseAppIdentity(await file.text()));
            } catch (cause) {
              setError(cause instanceof Error?cause.message:'读取文件失败，请重新选择。');
            } finally {
              setBusy(false);
            }
          }}/>
        {error&&<p id={inputId+'-error'} role="alert" className="error">{error}</p>}
      </div>
    </section>
    {sample&&<ObservationPanel report={{report:sample}} local/>}
  </>;
}
