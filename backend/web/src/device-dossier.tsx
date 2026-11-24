import {useEffect,useState,type MouseEvent} from 'react';
import {errorMessage,request,RequestError} from './console';
import {useVisiblePoll} from './live';
import {openFromList} from './reader-history';
import {caption,date,groups,saveDownload} from './reports';
import {emptyReportFilters,reportWorkspaceLink} from './workspace-route';
import type {Parameter} from './compare';
import {ConfigurationEvidence,type ConfigurationCode} from './configuration-evidence';
import './device-dossier.css';

type Kind='configuration'|'snapshot';
type GapCode='OLDER_FIELD_SET'|'API_UNKNOWN'|'API_BELOW_MINIMUM'|'PLAN_UNKNOWN'|'OTHER_CAPTURE_PLAN'|
  'CELLULAR_NOT_OBSERVED'|'PRECISE_LOCATION_NOT_GRANTED'|'LOCATION_SWITCH_OFF'|'ACCESS_UNKNOWN'|'NOT_RECORDED';
type Counts={available:number;restricted:number;unavailable:number;errors:number};
type Gap={group:string;key:string;label:string;kind:Kind;code:GapCode;minSchemaVersion:number;sinceFieldSet?:number;minApi?:number;
  requiredPlan?:string;legacyStatusOnly?:{key:string;status:string;reason?:string}};
type Field=Parameter&{kind:Kind;unit?:string};
type Category={group:string;counts:Counts;checklistSaved:number;checklistScope:number;fields:Field[];gaps:Gap[]};
type Dossier={schemaVersion:1;ruleVersion:string;assetId:string;reportId:string;batch:string;receivedAt:string;capturedAtEpochMs:number;
  reportSchemaVersion:number;fieldSetVersion?:number;appVersion:string;collectorVersion?:string;androidApi:number;android?:string;
  buildId?:string;romHint?:string;context:{capturePlan?:string;phoneAccess?:string;locationAccess?:string;locationSwitch?:string};
  categories:Category[];latestGnssReportId?:string;configurationCode?:ConfigurationCode};

const counts={available:'已取得',restricted:'受限',unavailable:'接口无可用值',errors:'读取异常'} as const;
const kinds={configuration:'配置与能力',snapshot:'本次状态与实测'} as const;
const plans:Record<string,string>={standard:'标准采集',rom:'ROM 验收',network:'网络切换实验',usb:'USB 插拔实验',gnss:'GNSS 读数核对'};
const access:Record<string,string>={granted:'已授权',not_granted:'未授权',precise:'精确',approximate:'仅大致',enabled:'已开',disabled:'已关'};
const display=(value:string|undefined,map:Record<string,string>)=>value?(map[value]??value):'未记录';
const statuses:Record<string,string>={AVAILABLE:'已取得',RESTRICTED:'受限',UNAVAILABLE:'接口无可用值',ERROR:'读取异常'};

function gapMessage(g:Gap){
  switch(g.code){
    case 'OLDER_FIELD_SET': return g.sinceFieldSet?(`从字段集 ${g.sinceFieldSet} 开始归档；这份旧报告未记录。`):
      `从报告协议 ${g.minSchemaVersion} 开始归档；这份旧报告未记录。`;
    case 'API_UNKNOWN': return `需要 API ${g.minApi}；报告未记录设备 API，适用性待确认。`;
    case 'API_BELOW_MINIMUM': return `需要 API ${g.minApi}；本次 Android 版本低于接口要求。`;
    case 'PLAN_UNKNOWN': return `适用于「${display(g.requiredPlan,plans)}」；该报告未记录采样方案。`;
    case 'OTHER_CAPTURE_PLAN': return `仅「${display(g.requiredPlan,plans)}」包含此项，本次方案不适用。`;
    case 'CELLULAR_NOT_OBSERVED': return '本次 App 未观察到设备声明蜂窝能力，未进入小区采集流程。';
    case 'PRECISE_LOCATION_NOT_GRANTED': return '未归档，且采样时未授予精确位置。需要时可在 App 授权后重采。';
    case 'LOCATION_SWITCH_OFF': return '未归档，且采样时系统位置关闭。需要时可开启后重采。';
    case 'ACCESS_UNKNOWN': return '未归档；采样时的精确位置授权或位置开关未记录，适用性待确认。';
    case 'NOT_RECORDED': return '此报告未保存该字段；没有读数，无法判断采集结果。';
  }
}

function FieldEvidence({field}:{field:Field}){
  const {group,key,label,value,unit,source,status,reason,errno,note}=field;
  return <li className="dossier-evidence">
    <div><strong>{label}</strong><code>{group}.{key}</code></div>
    <div><span className="dossier-state" data-state={status}>{statuses[status]??status}</span>
      {value!==null&&<p><b>{value}</b>{unit&&<small> 单位／格式：{unit}</small>}</p>}
      {(reason||errno!=null||status!=='AVAILABLE')&&<p>{reason?caption(reason):'报告未记录具体原因'}
        {errno!=null&&<> · errno={errno}</>}</p>}
      {note&&<p>{note}</p>}
      <small>来源：{source}</small>
    </div>
  </li>;
}

function GapEvidence({gap}:{gap:Gap}){
  return <li className="dossier-evidence">
    <div><strong>{gap.label}</strong><code>{gap.group}.{gap.key}</code></div>
    <div><span className="dossier-state" data-state="MISSING">{gap.code==='OLDER_FIELD_SET'?'旧报告未记录':'无归档字段'}</span>
      <p>{gapMessage(gap)}</p>
      {gap.legacyStatusOnly&&<small>报告另有状态摘要：{caption(gap.legacyStatusOnly.status)}
        {gap.legacyStatusOnly.reason&&' · '+caption(gap.legacyStatusOnly.reason)}；未保存完整字段证据。</small>}
    </div>
  </li>;
}

function DossierCategory({category,missingOnly}:{category:Category;missingOnly:boolean}){
  const {counts:totals,gaps,group,fields,checklistSaved,checklistScope}=category;
  const visible=missingOnly?fields.filter(f=>f.status!=='AVAILABLE'):fields;
  const legacy=gaps.filter(g=>g.code==='OLDER_FIELD_SET').length;
  return <details className="dossier-group">
    <summary>
      <strong>{groups[group]??group}</strong>
      <span className="dossier-summary"><span>取得 {totals.available}</span><span>受限 {totals.restricted}</span>
        <span>无值 {totals.unavailable}</span><span>异常 {totals.errors}</span><span>旧报告 {legacy}</span>
        <span>其他缺行 {gaps.length-legacy}</span></span>
    </summary>
    <div className="dossier-group-body">
      <p className="muted">适用清单：{checklistScope?`已归档 ${checklistSaved}/${checklistScope} 项`:'没有确认适用项'}。已归档可包含无值状态。</p>
      {!visible.length&&!gaps.length&&<p>{missingOnly?'已归档字段中没有缺项。':'此分类没有已归档字段或适用清单。'}</p>}
      {(Object.keys(kinds) as Kind[]).map(kind=>{
        const rows=visible.filter(f=>f.kind===kind),missing=gaps.filter(g=>g.kind===kind);
        if(!rows.length&&!missing.length)return null;
        return <div key={kind} className="dossier-bucket">
          <h5>{kinds[kind]}</h5>
          <ul>{rows.map(f=><FieldEvidence key={f.key} field={f}/>)}{missing.map(g=><GapEvidence key={g.key} gap={g}/>)}</ul>
        </div>;
      })}
    </div>
  </details>;
}

export function DeviceDossier({asset,pages,onSettled}:{asset:string;pages:string[];onSettled:(ready:boolean)=>void}){
  const [data,setData]=useState<Dossier>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [revision,refresh]=useState(0);
  const [missingOnly,setMissingOnly]=useState(false);
  const path='/api/admin/device-assets/'+encodeURIComponent(asset)+'/dossier';
  function recordError(err:unknown){
    if(err instanceof RequestError&&[401,403,404].includes(err.status))setData(undefined);
    setError(errorMessage(err));
  }
  useEffect(()=>{
    const control=new AbortController();
    setLoading(true);
    request<Dossier>(path,{signal:control.signal}).then(result=>{
      if(!control.signal.aborted){setData(result);setError('');}
    }).catch(err=>{
      if(!control.signal.aborted)recordError(err);
    }).finally(()=>{
      if(!control.signal.aborted){setLoading(false);onSettled(true);}
    });
    return ()=>control.abort();
  },[path,revision,onSettled]);
  useVisiblePoll(!loading,async signal=>{
    try {
      const result=await request<Dossier>(path,{signal});
      if(!signal.aborted){setData(result);setError('');}
    } catch(err) {
      if(!signal.aborted)recordError(err);
    }
  },path);

  const aggregate=data?.categories.reduce((all,{counts:current,gaps})=>({
    available:all.available+current.available,restricted:all.restricted+current.restricted,
    unavailable:all.unavailable+current.unavailable,errors:all.errors+current.errors,missing:all.missing+gaps.length,
  }),{available:0,restricted:0,unavailable:0,errors:0,missing:0});
  const follow=(e:MouseEvent<HTMLAnchorElement>)=>openFromList(e,pages,'返回设备档案','samples-'+asset);
  return <section className="dossier" aria-labelledby="dossier-title">
    <div className="pane-title"><div><h3 id="dossier-title">最近一次采样</h3>
      <p className="muted">按手机记录的采样时间选择，不按上传先后。这里仅显示这一份报告，不用历史报告补值。</p></div>
      <div className="actions">
        {data&&<button type="button" className="secondary" onClick={()=>saveDownload(
          new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`SigMark-设备诊断-${data.reportId}.json`)}>导出诊断 JSON</button>}
        <button type="button" className="secondary" disabled={loading} onClick={()=>refresh(n=>n+1)}>{loading?'正在读取…':'刷新采样诊断'}</button>
      </div>
    </div>
    {loading&&!data&&<p role="status">正在读取最近采样…</p>}
    {error&&<p role="status" className="inset error">{data?'更新失败，当前保留上次成功读取的采样。':''}{error}</p>}
    {data&&aggregate&&<>
      <dl className="dossier-meta">
        <div><dt>采样 · 接收</dt><dd>{data.capturedAtEpochMs?date(data.capturedAtEpochMs):'采样时间未记录'}<small>接收 {date(data.receivedAt)} · {data.batch}</small></dd></div>
        <div><dt>系统与构建</dt><dd>{[data.android&&'Android '+data.android,data.androidApi&&'API '+data.androidApi,data.buildId].filter(Boolean).join(' · ')||'未记录'}
          {data.romHint&&<small>{data.romHint}</small>}</dd></div>
        <div><dt>采样方案</dt><dd>{display(data.context.capturePlan,plans)}
          <small>电话 {display(data.context.phoneAccess,access)} · 位置权限 {display(data.context.locationAccess,access)} · 位置开关 {display(data.context.locationSwitch,access)}</small></dd></div>
        <div><dt>归档版本</dt><dd>App {data.appVersion||'—'} · 协议 {data.reportSchemaVersion||'—'} · 字段集 {data.fieldSetVersion??'未记录'}
          <small>{data.collectorVersion&&`采集器 ${data.collectorVersion} · `}{data.ruleVersion}</small></dd></div>
      </dl>
      <ul className="dossier-totals" aria-label="最近采样统计">
        {(Object.keys(counts) as (keyof Counts)[]).map(k=><li key={k}><strong>{aggregate[k]}</strong><span>{counts[k]}</span></li>)}
        <li><strong>{aggregate.missing}</strong><span>清单未归档</span></li>
      </ul>
      <ConfigurationEvidence code={data.configurationCode} fields={data.categories.flatMap(category=>category.fields)}
        previousLink={data.configurationCode?.previousReportId?
          reportWorkspaceLink('reports',{...emptyReportFilters,q:'asset:'+asset},{report:data.configurationCode.previousReportId}):undefined}/>
      <div className="dossier-tools">
        <div className="actions">
          <a className="button-link secondary" id="dossier-report" onClick={follow}
            href={reportWorkspaceLink('reports',{...emptyReportFilters,q:'asset:'+asset},{report:data.reportId})}>查看这一份原报告</a>
          <a className="subtle-link" id="dossier-lab" onClick={follow}
            href={'#lab?'+new URLSearchParams({report:data.reportId})}>到验收工作台对比同机采样 →</a>
          {data.latestGnssReportId&&<a className="subtle-link" onClick={follow}
            href={reportWorkspaceLink('reports',{...emptyReportFilters,q:'asset:'+asset},{report:data.latestGnssReportId})}>查看最近一份 GNSS 核对报告 →</a>}
        </div>
        <label className="build-check"><input type="checkbox" checked={missingOnly} onChange={e=>setMissingOnly(e.target.checked)}/>仅看缺项</label>
      </div>
      <p className="muted">App 观察视角。前四项只计已归档字段；“清单未归档”单独计数，包含旧协议、接口版本、方案或授权不适用等情况，不代表手机故障。
        适用清单只算已归档或按当次条件确定适用的代表字段，不是设备全部能力。</p>
      <section aria-labelledby="dossier-category-title" className="dossier-categories">
        <h4 id="dossier-category-title">12 类设备参数</h4>
        {data.categories.map(category=><DossierCategory key={category.group} category={category} missingOnly={missingOnly}/>)}
      </section>
    </>}
  </section>;
}
