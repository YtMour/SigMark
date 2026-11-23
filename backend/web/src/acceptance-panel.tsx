import {useId} from 'react';
import type {Report} from './reports';
import {acceptance,acceptanceComparison} from './acceptance';

const titles={plan:'采样方案',phone:'电话状态权限',location:'位置权限',locationSwitch:'系统位置开关',
  fixture:'样片版本',output:'首帧结果',stage:'测试阶段',decoder:'解码器',elapsed:'本次耗时'};
const labels:Record<string,string>={standard:'标准采集',rom:'ROM 验收',network:'网络复测',granted:'已授权',not_granted:'未授权',
  precise:'精确',approximate:'仅大致',enabled:'开启',disabled:'关闭',pass:'通过',fail:'未通过',
  source:'读取样片',configure:'初始化解码器',decode:'等待首帧',done:'首帧已输出'};
type View = ReturnType<typeof acceptance>;
const display=(v:View[keyof View])=>v.value?(labels[v.value]??v.value):v.status==='NOT_ARCHIVED'?'未归档':'未取得读数';
const keys = Object.keys(titles) as (keyof View)[];

export function AcceptancePanel({row}:{row:Report}) {
  const id=useId(), data=acceptance(row);
  const archived=keys.some(k=>data[k].status!=='NOT_ARCHIVED');
  const media=data.output.value?' · 视频首帧'+display(data.output):'';
  return <section className="panel security-card" aria-labelledby={id}>
    <h2 id={id}>验收证据</h2>
    {!archived?<p className="muted">这份报告未归档验收方案、采集时授权或固定样片结果。</p>:<>
      <p>{data.plan.value?display(data.plan):'未记录验收方案'}{media}</p>
      <details className="security-readings">
        <summary>查看验收读数与来源</summary>
        <dl>{keys.map(k=><div key={k}><dt>{titles[k]}</dt><dd><span>{display(data[k])}</span>
          {data[k].source&&<small>{data[k].source}</small>}</dd></div>)}</dl>
      </details>
    </>}
  </section>;
}

const outcomes={cross_asset:'资产归属不同或未知，只作对照',invalid_order:'基线采样并不早于当前样本',
  insufficient:'缺少同版本样片的两次读数',different_fixture:'样片版本不同',
  both_pass:'两次首帧均通过',both_fail:'两次首帧均未通过',recovered:'本次首帧恢复',regression:'首帧由通过变为未通过，建议复测'};
export function AcceptanceComparison({result}:{result:ReturnType<typeof acceptanceComparison>}) {
  const id=useId();
  return <section className="panel security-card" aria-labelledby={id}>
    <h2 id={id}>验收对照</h2>
    <p>{outcomes[result.media]}。耗时仅供本次诊断，不参与结论。</p>
    {Object.values(result.context).includes('changed')&&<p>采集授权条件有变化。遇到蜂窝字段差异，请先在相同授权条件下复测。</p>}
    <details className="security-readings"><summary>查看前后采样条件及实测</summary>
      <dl>{keys.map(k=><div key={k}><dt>{titles[k]}</dt>
        <dd>基线：{display(result.baseline[k])}<br/>当前：{display(result.current[k])}</dd></div>)}</dl>
    </details>
  </section>;
}
