import {useId,type ReactNode} from 'react';
import {caption,date,groups,saveDownload} from './reports';
import {experimentLabels,probeComparisonLabels,type buildVerification} from './verification-package';
import {identityVerificationLabel,RiskRuleList,riskLevelText} from './risk-panel';

type Packet=ReturnType<typeof buildVerification>;
const context:Record<string,string>={full:'整体获取',standard:'标准采集',rom:'ROM 验收',network:'网络复测',usb:'USB 插拔实验',gnss:'GNSS 读数核对',granted:'已授权',not_granted:'未授权',
  precise:'精确',approximate:'仅大致',enabled:'已开',disabled:'已关'};

export function VerificationPanel({packet,pending,conditions}:{packet:Packet;pending:boolean;conditions:ReactNode}){
  const uid=useId(),p=packet.source.current,c=packet.conditions.current;
  const comparison=packet.regression;
  const selected=packet.policy;
  const completed=packet.experiments.filter(({current})=>current.state==='passed'||current.state==='failed').length;
  const passed=packet.experiments.filter(({current})=>current.state==='passed').length;
  return <section className="panel verification verification-workspace" aria-labelledby={uid}>
    <div className="pane-title verification-heading"><h2 id={uid}>本次验收</h2>
      <button type="button" disabled={pending} onClick={()=>saveDownload(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}),
        'SigMark-verification-'+p.reportId.slice(0,8)+'.json')}>{pending?'正在核对参考资料…':'导出验收证据包 JSON'}</button>
    </div>
    <div className="verification-grid">
      <div className="verification-result" data-level={packet.risk.level}>
        <strong>本次实验</strong><p className="verification-total">{completed} <span>/ {packet.experiments.length} 项有结果</span></p>
        {completed>0&&<p>{passed} 项通过{completed>passed?` · ${completed-passed} 项未通过`:''}</p>}
      </div>
      <div><strong>风险评估</strong><p className="risk-level" data-level={packet.risk.level}>{riskLevelText[packet.risk.level][0]}</p>
        <p>{identityVerificationLabel}</p>
        {packet.strength.totalChecks>packet.strength.knownChecks&&
          <p>{packet.strength.totalChecks-packet.strength.knownChecks} 项关键检查待确认</p>}</div>
      <div className="verification-comparison"><strong>对照结论</strong><p>{comparison?selected?'登记基线：'+selected.name:'同资产历史对照':'仅核对当前样本'}</p>
        {comparison&&comparison.verdicts.review>0&&<p>{comparison.verdicts.review} 项差异需复核</p>}
        {comparison&&selected?.expectedNetwork&&comparison.context.network.state==='mismatch'&&<p>默认网络与基线条件不同</p>}</div>
    </div>
    {packet.baselineUnavailable&&<p className="muted" role="status">所选基线不可用，请重新选择。</p>}
    {/* The export keeps the rule version, observer and each unconfirmed input. */}
    <details className="verification-risk" data-risk-level={packet.risk.level}>
      <summary><strong>查看风险依据</strong></summary>
      <div className="verification-risk-content">
        <p>{riskLevelText[packet.risk.level][1]}</p>
        {packet.risk.policy.baseline&&<p className="muted">基线「{packet.risk.policy.baseline.name}」允许预期解锁。</p>}
        <RiskRuleList data={packet.risk}/>
      </div>
    </details>
    <div className="verification-columns">
    <section aria-labelledby={uid+'-experiments'} className="verification-experiments">
      <h3 id={uid+'-experiments'}>实验结果</h3>
      {packet.experiments.map(({current,baseline,observedRuns,comparison})=><details key={current.id} className="experiment-card">
        <summary>
          <strong>{current.title}</strong>
          <span className="experiment-status" data-result={current.state}>{experimentLabels[current.state]}</span>
        </summary>
        <div className="experiment-body">
        {baseline&&<p><strong>实验对照：</strong>{probeComparisonLabels[comparison]}。</p>}
        <p>{current.plan==='rom'?'可随「整体获取」运行。':'请在手机上单独运行。'}</p>
        <ol>{current.steps.map(step=><li key={step}>{step}</li>)}</ol>
        <p>本报告记录 {current.runsInReport} 次{baseline?' · 基线：'+experimentLabels[baseline.state]:''}；
          {current.timing.duration?'间隔／耗时 '+current.timing.duration+'；':''}
          {!current.timing.startEpochMs&&!current.timing.endEpochMs?'起止墙钟未记录。':
            `设备墙钟：${current.timing.startEpochMs?date(current.timing.startEpochMs):'起点未记录'} → ${current.timing.endEpochMs?date(current.timing.endEpochMs):'终点未记录'}。`}
          {current.timing.waitLimitMs?' 实验等待／有效窗 '+current.timing.waitLimitMs+' ms。':''}</p>
        <p>已载入的同资产记录：{observedRuns.total} 次 · 达到条件 {observedRuns.passed} · 未达到 {observedRuns.failed} · 证据未齐 {observedRuns.incomplete}
          {observedRuns.historyLimited?'（历史窗口有限）':''}。</p>
        {current.id==='route'&&<p>达到条件需 Wi‑Fi 起点、蜂窝终点且系统验证联网。观测间隔并非断网时长。</p>}
        {current.id==='usb'&&<p>达到条件仅表示可见设备数量变化。没有变化时，先核对 USB Host、OTG 和连接，不能据此判断硬件故障。</p>}
        {current.id==='gnss'&&<p>观察到非空回调是功能证据；证据未齐不等于硬件故障，也不验证系统型号年。</p>}
        {(current.runsInReport>0||!!baseline?.runsInReport)&&<ul>{current.evidence.map((e,i)=>{
          const display=(field:typeof e.reading)=>field?.value??(field?caption(field.reason??field.status):'未归档');
          const prior=baseline?.evidence[i]?.reading??null;
          return <li key={e.key}><code>{e.key}</code>：{baseline&&<>基线 {display(prior)}{prior?.source&&<small> · {prior.source}</small>}；当前 </>}
            {display(e.reading)}{e.reading?.source&&<small> · {e.reading.source}</small>}</li>;
        })}</ul>}
        </div>
      </details>)}
    </section>
    {conditions}
    </div>
    <details className="verification-context">
      <summary>查看采样条件与权限</summary>
      <p>{context[c.plan.value??'']??'采样方案未记录'}</p>
      <p>采样 {p.captureAt?date(p.captureAt):'未记录'} · 接收 {date(p.receivedAt)}</p>
      <p>电话 {context[c.phone.value??'']??'未记录'} · 位置 {context[c.location.value??'']??'未记录'} / {context[c.locationSwitch.value??'']??'未记录'}</p>
    </details>
    <details className="verification-coverage"><summary>查看归档覆盖与状态</summary>
      <ul className="verification-cover">{packet.coverage.map(g=><li key={g.group}><b>{groups[g.group]??g.group}</b>
        <small>归档 {g.archived} · 有值 {g.available} · 受限 {g.restricted} · 无值 {g.unavailable} · 异常 {g.errors}</small></li>)}</ul>
    </details>
  </section>;
}
