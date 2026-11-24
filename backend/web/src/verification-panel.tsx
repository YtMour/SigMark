import {useId} from 'react';
import {caption,date,groups,saveDownload} from './reports';
import {experimentLabels,objectives,probeComparisonLabels,type buildVerification} from './verification-package';
import {RiskPanel} from './risk-panel';
import {followReadLink} from './reader-history';

type Packet=ReturnType<typeof buildVerification>;
const levels={red:'红色 · 关键失败线索',yellow:'黄色 · 需要复核',gray:'灰色 · 关键证据不足',blue:'蓝色 · 本机未见所列异常'};
const severity={critical:'高优先级',review:'待复核',none_observed:'未观察到所列异常',unrated:'证据不足，未定级'};
const context:Record<string,string>={standard:'标准采集',rom:'ROM 验收',network:'网络复测',usb:'USB 插拔实验',gnss:'GNSS 读数核对',granted:'已授权',not_granted:'未授权',
  precise:'精确',approximate:'仅大致',enabled:'已开',disabled:'已关'};

export function VerificationPanel({packet,pending,securityLink}:{packet:Packet;pending:boolean;securityLink:string}){
  const uid=useId(),p=packet.source.current,c=packet.conditions.current;
  const comparison=packet.regression;
  const gaps=packet.fields.filter(f=>f.comparison==='field_set_gap').length;
  const volatile=packet.fields.filter(f=>f.comparison==='context_or_experiment').length;
  const selected=packet.policy;
  return <section className="panel verification" aria-labelledby={uid}>
    <div className="pane-title"><div><p className="eyebrow">{objectives[packet.objective]}</p><h2 id={uid}>设备证据与风险验收</h2>
      <p className="muted">核对条件、实验和风险后，导出同一份证据包。后台不会远程启动手机实验。</p></div>
      <button type="button" disabled={pending} onClick={()=>saveDownload(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}),
        'SigMark-verification-'+p.reportId.slice(0,8)+'.json')}>{pending?'正在核对参考资料…':'导出验收证据包 JSON'}</button>
    </div>
    <div className="verification-grid">
      <div><strong>采样条件</strong><p>{context[c.plan.value??'']??'方案未记录'} · API {p.androidApi??'未记录'} · 字段集 {p.fieldSetVersion??'未记录'}</p>
        <p>采样 {p.captureAt?date(p.captureAt):'未记录'} · 接收 {date(p.receivedAt)}</p>
        <p>电话 {context[c.phone.value??'']??'未记录'} · 位置 {context[c.location.value??'']??'未记录'} / {context[c.locationSwitch.value??'']??'未记录'}</p></div>
      <div><strong>对照结论</strong><p>{comparison?selected?'登记基线：'+selected.name:'同资产历史对照':'仅核对当前样本'}</p>
        {comparison&&<p>需复核 {comparison.verdicts.review} · 符合预期 {comparison.verdicts.expected} · 跨字段集缺行 {gaps} · 瞬时或实验差异 {volatile}</p>}
        {comparison&&selected?.expectedNetwork&&<p>默认网络条件：{comparison.context.network.state==='matched'?'一致':comparison.context.network.state==='mismatch'?'与登记条件不同':'证据不足'}</p>}</div>
      <div><strong>风险与证据强度</strong><p className="risk-level" data-level={packet.risk.level}>{levels[packet.risk.level]}</p>
        <p>严重度：{severity[packet.strength.severity]} · 关键检查 {packet.strength.knownChecks}/{packet.strength.totalChecks}</p>
        <p>App 归档视角 · 独立挑战未执行</p></div>
    </div>
    {packet.baselineUnavailable&&<p className="muted" role="status">所选基线已失效或不属于当前资产，不用于对比或风险例外。</p>}
    <details><summary>查看 12 类归档覆盖与状态</summary>
      <p className="muted">以下仅统计这份报告归档的字段，不把全量字典当作适用分母。字段字典：{packet.catalogVersion??'未取得'}。</p>
      <ul className="verification-cover">{packet.coverage.map(g=><li key={g.group}><b>{groups[g.group]??g.group}</b>
        <small>归档 {g.archived} · 有值 {g.available} · 受限 {g.restricted} · 无值 {g.unavailable} · 异常 {g.errors}</small></li>)}</ul>
    </details>
    <section aria-labelledby={uid+'-experiments'} className="verification-experiments">
      <h3 id={uid+'-experiments'}>实验步骤与归档结果</h3>
      {packet.experiments.map(({current,baseline,observedRuns,comparison})=><details key={current.id}>
        <summary><strong>{current.title}</strong> · {experimentLabels[current.state]}</summary>
        {baseline&&<p><strong>实验对照：</strong>{probeComparisonLabels[comparison]}。</p>}
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
        <ul>{current.evidence.map((e,i)=>{
          const display=(field:typeof e.reading)=>field?.value??(field?caption(field.reason??field.status):'未归档');
          const prior=baseline?.evidence[i]?.reading??null;
          return <li key={e.key}><code>{e.key}</code>：{baseline&&<>基线 {display(prior)}{prior?.source&&<small> · {prior.source}</small>}；当前 </>}
            {display(e.reading)}{e.reading?.source&&<small> · {e.reading.source}</small>}</li>;
        })}</ul>
      </details>)}
    </section>
    <details><summary>查看风险规则与原始依据</summary><RiskPanel data={packet.risk}/></details>
    <a className="subtle-link" href={securityLink} onClick={followReadLink}>打开指纹安全查看完整分析 →</a>
  </section>;
}
