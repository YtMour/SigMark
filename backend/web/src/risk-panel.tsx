import {useId} from 'react';
import {caption,saveDownload} from './reports';
import type {assessRisk,RiskLevel} from './risk-assessment';
import './risk-panel.css';

export const riskLevelText:Record<RiskLevel,[string,string]> = {
  red:['优先核查','发现关键保护异常，请优先核对下方项目。'],
  yellow:['需要复核','请核对下方的异常或冲突读数。'],
  gray:['证据不足','部分关键检查缺少有效读数。'],
  blue:['本次未见异常','结论基于本次采样，尚未进行独立验证。'],
};
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
      <summary><strong>{rule.title}</strong> <span className="risk-rule-status">{labels[rule.state]}</span>
        <span className="security-finding">{rule.finding}</span></summary>
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
        <p>{riskLevelText[data.level][1]}</p>
        {data.policy.baseline&&<p>同资产实验基线：{data.policy.baseline.name}</p>}</div>
      <button type="button" className="secondary" onClick={()=>saveDownload(
        new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-risk-'+data.reportId+'.json')}>导出风险依据 JSON</button>
    </div>
    <RiskRuleList data={data}/>
    <details className="risk-all-checks">
      <summary>查看其余检查</summary>
      <RiskRuleList data={data} additionalOnly/>
    </details>
  </section>;
}
