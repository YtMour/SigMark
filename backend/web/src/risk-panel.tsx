import {useId} from 'react';
import {caption,date,saveDownload} from './reports';
import type {assessRisk,RiskLevel} from './risk-assessment';
import './risk-panel.css';

const levelText:Record<RiskLevel,[string,string]> = {
  red:['红色 · 关键失败线索','归档中有关键失败信号，需要优先从独立来源复核。'],
  yellow:['黄色 · 需要复核','观察到保护薄弱、证据冲突或与预期不符的读数。'],
  gray:['灰色 · 关键证据不足','至少一项关键读数尚未确认。缺失或受限不计作失败。'],
  blue:['蓝色 · 本机未见所列异常','关键读数已齐，未命中本规则列出的异常；仍未经独立验证。'],
};
const labels={critical:'优先核对',review:'需复核',unknown:'未确认',observed:'已观察',expected:'实验预期',context:'环境线索'};
type Assessment=ReturnType<typeof assessRisk>;

export function RiskPanel({data}:{data:Assessment}){
  const id=useId();
  const active=new Set(data.triggered);
  const order=data.rules.slice().sort((a,b)=>Number(active.has(b.code))-Number(active.has(a.code)));
  const missing=data.rules.filter(rule=>rule.required&&(rule.state==='unknown'||rule.state==='context')).length;
  return <section className="panel risk-panel" aria-labelledby={id}>
    <div className="pane-title">
      <div><p className="eyebrow">样本风险分级</p><h2 id={id} className="risk-level" data-level={data.level}>{levelText[data.level][0]}</h2>
        <p>{levelText[data.level][1]}</p></div>
      <button type="button" className="secondary" onClick={()=>saveDownload(
        new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-risk-'+data.reportId+'.json')}>导出风险依据 JSON</button>
    </div>
    <dl className="risk-meta">
      <div><dt>规则版本</dt><dd><code>{data.ruleVersion}</code></dd></div>
      <div><dt>采样时间</dt><dd>{data.capturedAtEpochMs>0?date(data.capturedAtEpochMs):'未记录'}</dd></div>
      <div><dt>策略</dt><dd>{data.policy.baseline?'同资产实验基线：'+data.policy.baseline.name:'常规观察'}</dd></div>
      <div><dt>证据范围</dt><dd>App 归档 · 硬件证明未执行 · 滥用未评估</dd></div>
    </dl>
    <p className="muted">{data.triggered.length?data.triggered.length+' 条规则触发此等级。':'未命中异常规则。'}关键检查未确认 {missing} 项。绿色仅用于未来独立验证通过的结果。</p>
    <div className="security-readings">
      {order.map(rule=><details key={rule.code} className="panel security-card" data-risk-rule={rule.code}>
        <summary><strong>{rule.title}</strong> <span className="tag">{labels[rule.state]}</span> <code>{rule.code}</code>
          <span className="security-finding">{rule.finding}</span></summary>
        <p>下一步：{rule.next}</p>
        <dl>{rule.evidence.map(field=><div key={field.key}><dt><code>{field.key}</code></dt>
          <dd>{field.status==='AVAILABLE'?(field.value??'无有效读数'):field.status==='NOT_ARCHIVED'?'该报告未归档':caption(field.status)}
            <small>{field.status}{field.reason?' · '+caption(field.reason):''}{field.errno!=null?' · errno='+field.errno:''}{field.source?' · '+field.source:''}</small>
          </dd></div>)}
          {rule.code==='APP_SIGNER'&&data.signerReference?.state==='registered'&&
            <div><dt>对应内网发布记录 · 证书 SHA-256</dt><dd><code>{data.signerReference.signerSha256}</code></dd></div>}
        </dl>
      </details>)}
    </div>
  </section>;
}
