import {useId} from 'react';
import {caption,saveDownload} from './reports';
import type {assessRisk,RiskLevel} from './risk-assessment';
import './risk-panel.css';

export const riskLevelText:Record<RiskLevel,[string,string]> = {
  red:['App 观测需优先核查','App 报告中出现关键保护异常线索。'],
  yellow:['App 观测需要复核','请核对下方的异常或冲突读数。'],
  gray:['App 观测证据不足','部分关键检查缺少有效读数。'],
  blue:['App 观测未触发警示','当前 App 归档读数满足规则的观测条件。'],
};
export const identityVerificationLabel='设备身份未验证';
const labels={critical:'优先核对',review:'需复核',unknown:'未确认',observed:'已观察',expected:'实验预期',context:'环境线索'};
type Assessment=ReturnType<typeof assessRisk>;

function prioritizedRules(data:Assessment){
  const triggered=new Set(data.triggered);
  return data.rules.slice().sort((a,b)=>Number(triggered.has(b.code))-Number(triggered.has(a.code)));
}

export function RiskRuleList({data,additionalOnly=false}:{data:Assessment;additionalOnly?:boolean}){
  const order=prioritizedRules(data);
  const triggered=new Set(data.triggered);
  const rules=order.filter(rule=>{
    const primary=triggered.has(rule.code)||(!!rule.required&&
      (data.level==='blue'||rule.state==='unknown'||rule.state==='context'));
    return additionalOnly?!primary:primary;
  });
  // Rule IDs and raw status stay machine-readable here and in the existing export.
  return <div className="security-readings">
    {rules.map(rule=><details key={rule.code} className="panel security-card" data-risk-rule={rule.code} data-risk-state={rule.state}>
      <summary><strong>{rule.title}</strong> <span className="risk-rule-status">{labels[rule.state]}</span></summary>
      <p>{rule.finding}</p>
      <p>下一步：{rule.next}</p>
      <details className="risk-rule-evidence">
        <summary>原始读数</summary>
        <dl>{rule.evidence.map(field=><div key={field.key} data-risk-field={field.key} data-status={field.status}>
          <dt><code>{field.key}</code></dt><dd>
            {field.status==='AVAILABLE'?(field.value??'无有效读数'):field.status==='NOT_ARCHIVED'?'该报告未归档':caption(field.reason??field.status)}
            {(field.errno!=null||field.source)&&<small>{[field.source,field.errno!=null?'errno='+field.errno:null].filter(Boolean).join(' · ')}</small>}
          </dd></div>)}
          {rule.code==='APP_SIGNER'&&data.signerReference?.state==='registered'&&
            <div><dt>已发布版本的签名 SHA-256</dt><dd><code>{data.signerReference.signerSha256}</code></dd></div>}
        </dl>
      </details>
    </details>)}
  </div>;
}

export function RiskPanel({data}:{data:Assessment}){
  const id=useId();
  return <section className="panel risk-panel" aria-labelledby={id}>
    <div className="pane-title">
      <div><h2 id={id} className="risk-level" data-level={data.level}>{riskLevelText[data.level][0]}</h2>
        <p><strong>{identityVerificationLabel}</strong></p>
        {data.policy.baseline&&<p>同资产实验基线：{data.policy.baseline.name}</p>}</div>
    </div>
    <RiskRuleList data={data}/>
    <details className="risk-all-checks">
      <summary>其他检查与导出</summary>
      <RiskRuleList data={data} additionalOnly/>
      <button type="button" className="secondary" onClick={()=>saveDownload(
        new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-risk-'+data.reportId+'.json')}>导出风险依据 JSON</button>
    </details>
  </section>;
}
