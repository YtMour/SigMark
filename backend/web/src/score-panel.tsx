import {useId} from 'react';
import {scoreView,type ScorePayload} from './score-view';
import './score-view.css';

// 打分区只做一件事：把 scoreView() 的结果画出来。
// 所有判断（未给分、未计入总分、决定性项）都在 score-view.ts 里算好，这里不重新推导。
export function ScorePanel({score}:{score?:ScorePayload|null}){
  const id=useId();
  const view=scoreView(score);
  // 旧报告没有 score 字段：整块缺省，不报错也不留空壳。
  if(!view)return null;
  const axisLabel=(code:string)=>view.axes.find(axis=>axis.code===code)?.label||code;
  return <section className="panel score-panel" aria-labelledby={id}
    data-score-band={view.band} data-score-scored={view.scored?'true':'false'}>
    <div className="pane-title">
      <div><h2 id={id}>设备安全打分</h2>
        <p className="muted">等级是主结论；分数只用于同一批设备之间排序，不代表通过率。
          这套判定只看本次采样看见的痕迹，<b>不能证明是真机</b>，也不能证明设备没有被改装。</p></div>
      <span className={'tag score-tag'} data-tone={view.tone}>{view.scored?'已给分':'未给分'}</span>
    </div>
    <div className="score-body">
      {/* 版本不认识时置顶说明：颜色已经停用，但等级和数字仍是后端原样给的。
          放在最上面，是因为它改变的是「这整块颜色该怎么读」，不是某个轴的细节。 */}
      {view.versionWarning&&<div className="score-version" role="note" data-score-version={view.version}>
        <h3>打分规则版本不一致，颜色已停用</h3>
        <p>{view.versionWarning}</p>
      </div>}
      {/* 决定性命中置顶：一条致命项不能被九条合格项平均掉。 */}
      {view.hasCaps&&<div className="score-cap" role="note" data-score-caps={view.caps.length}>
        <h3>决定性项命中：等级已直接压到 D</h3>
        <p>{view.capNotice}</p>
        <ul>{view.caps.map(cap=><li key={cap.code}>
          <code>{cap.code}</code>{cap.reason&&<span>{cap.reason}</span>}
        </li>)}</ul>
        <p className="muted">{view.capExplanation}</p>
      </div>}
      <div className="score-headline">
        <strong className="score-band" data-band={view.band}>{view.headline}</strong>
        {view.scored&&<p className="score-figure">
          <b>{view.scoreText}</b><small>{view.scoreQualifier}</small>
        </p>}
      </div>
      <p className="score-meta">覆盖 {view.coverageText}
        {view.coverageLabel&&' · '+view.coverageLabel}
        {view.decisive&&' · 含决定性项'}</p>
      {view.note&&<p className="score-note">{view.note}</p>}
      <ul className="score-axes" aria-label="打分轴">
        {/* 每条轴都渲染 coverage：未给分时分数位置写「未给分」，但覆盖照常显示——
            coverage 是「这一轴读到了多少」，正是没给分的原因，不能跟着被抹掉。 */}
        {view.axes.map(axis=><li key={axis.code} className="score-axis"
          data-axis={axis.code} data-axis-counted={axis.counted?'true':'false'}>
          <div className="score-axis-head">
            <span className="score-axis-name">{axis.label}</span>
            <span className="score-axis-score">{axis.scoreText??'未给分'}</span>
            <span className="score-axis-coverage">覆盖 {axis.coverageText}</span>
          </div>
          {axis.note&&<p className="score-axis-flag" role="note">{axis.note}</p>}
          <details className="score-ledger">
            <summary>扣分账本 · {axis.deductions.length} 条</summary>
            {axis.deductions.length?<ul>{axis.deductions.map(deduction=><li key={deduction.code+'|'+deduction.label}
              className="score-deduction" data-deduction={deduction.code}>
              {/* 主标题是分支代码，不是标签名：hardware_declaration_conflict 下面挂着三条
                  不同的分支（FOREIGN_PROFILE / HARDWARE_CHANNEL_CONFLICT /
                  OVERLAY_CODENAME_MISMATCH），只写标签会让三条看起来一模一样。 */}
              <p className="score-deduction-head"><b>{deduction.pointsText}</b> <code>{deduction.code}</code></p>
              {!!deduction.keys.length&&<ul className="score-deduction-keys">
                {deduction.keys.map(key=><li key={key}><code>{key}</code></li>)}</ul>}
              {deduction.detail&&<p>{deduction.detail}</p>}
              <small>来源标签 <code>{deduction.label}</code> · {axis.weightText}</small>
            </li>)}</ul>:<p>本轴本次没有扣分项。</p>}
          </details>
        </li>)}
      </ul>
      {view.axes.length===0&&<p className="muted">后端没有给出打分轴。</p>}
      {/* undetermined 是判断缺口，不是「这些通道正常」。 */}
      {!!view.undetermined.length&&<section className="score-undetermined" aria-label="本次判断未覆盖的通道">
        <h3>本次判断不覆盖的通道</h3>
        <p>{view.undeterminedLead}</p>
        <ul>{view.undetermined.map((item,index)=><li key={item.axis+'|'+item.reason+'|'+index}>
          <strong>{axisLabel(item.axis)}</strong><span className="score-undetermined-reason">{item.reasonText}</span>
          {!!item.keys.length&&<span className="score-undetermined-keys">
            {item.keys.map(key=><code key={key}>{key}</code>)}</span>}
        </li>)}</ul>
        <p className="muted">{view.undeterminedNote}</p>
      </section>}
      {!view.scored&&!view.undetermined.length&&<p className="muted">后端没有列出具体缺了哪些通道。</p>}
    </div>
  </section>;
}
