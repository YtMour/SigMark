import {useId,useState} from 'react';
import {caption,date,type Report} from './reports';
import {compareObservation,fields,maxObservationBytes,parseObservation,type Observation} from './observation.mjs';
import './observation.css';

export function ObservationPanel({report}:{report:Report}) {
  const id = useId();
  const [observation,setObservation] = useState<Observation>();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const archived = new Map(report.report.parameters?.map(row => [row.group+'.'+row.key,row]));
  return <section className="panel evidence-observations" aria-labelledby={id+'-title'}>
    <h2 id={id+'-title'}>证据来源对照</h2>
    <p className="muted">选取同一台设备的 ADB 观察文件，在浏览器内与当前报告并排查看。文件仅在本页使用。</p>
    <div className="evidence-file">
      <label htmlFor={id+'-file'}>打开 ADB 观察 JSON</label>
      <input id={id+'-file'} type="file" accept=".json,application/json" disabled={busy}
        aria-invalid={!!error} aria-describedby={error ? id+'-error' : undefined}
        onChange={async e=>{
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setObservation(undefined);
          setError('');
          setBusy(true);
          try {
            if (file.size > maxObservationBytes) throw Error('观察文件超过 8 KiB，请选择脚本生成的 JSON。');
            setObservation(parseObservation(await file.text()));
          } catch (e) {
            setError(e instanceof Error ? e.message : '读取文件失败，请重新选择。');
          } finally { setBusy(false); }
        }}/>
      {error&&<p id={id+'-error'} className="error" role="alert">{error}</p>}
    </div>
    <dl className="observation-meta">
      <div><dt>App 采样</dt><dd>{report.report.model} · {report.report.collectorVersion??report.report.appVersion} · 字段集 {report.report.fieldSetVersion??'未标注'}</dd>
        <dd>{date(report.report.capturedAtEpochMs)}</dd></div>
      <div><dt>ADB 观察</dt><dd>{observation?observation.model:'尚未打开文件'}</dd>
        {observation&&<dd>{date(observation.observedAtEpochMs)}</dd>}</div>
      <div><dt>独立验证</dt><dd>未执行</dd></div>
    </dl>
    {observation&&<>
      <div className="pane-title">
        <p role="status">{report.report.model.trim()===observation.model
          ?'已加载 ADB 读数。设备对应关系由操作者确认。'
          :'两份记录的型号不同，请核对选中的报告和设备。'}</p>
        <button className="secondary" type="button" onClick={()=>setObservation(undefined)}>移除观察文件</button>
      </div>
      <div className="observation-scroll" role="region" aria-label="App 与 ADB 读数，可横向滚动" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">检查项</th><th scope="col">App 报告</th><th scope="col">ADB shell</th><th scope="col">对照结果</th></tr></thead>
          <tbody>{fields.map(([key,label,source])=>{
            const app=archived.get(key), adb=observation.readings[key];
            return <tr key={key}><th scope="row">{label}</th>
              <td>{app ? (app.status==='AVAILABLE' ? (app.value??'无有效读数') : caption(app.status)) : '该报告未归档'}
                {app?.errno!=null&&' · errno='+app.errno}{app?.source&&<small>{app.source}</small>}</td>
              <td>{adb??'未返回'}<small>{source}</small></td>
              <td>{compareObservation(key,app,adb)}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
