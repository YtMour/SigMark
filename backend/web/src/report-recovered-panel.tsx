import {useEffect,useState} from 'react';
import {request} from './console';
import type {Parameter} from './compare';
import {caption} from './reports';
import {energyFromArchive,newerMatchingBuild,type PublishedBuild} from './report-recovered';

export function ReportRecoveredPanel({fields}:{fields:Parameter[]}) {
  const [release,setRelease]=useState<PublishedBuild>();
  const hasBuild=fields.some(field=>field.group==='app'&&field.key==='version'&&field.status==='AVAILABLE');
  useEffect(()=>{
    if(!hasBuild)return;
    const ctl=new AbortController();
    request<PublishedBuild>('/api/downloads/current',{signal:ctl.signal})
      .then(result=>{if(!ctl.signal.aborted)setRelease(result);}).catch(()=>{});
    return ()=>ctl.abort();
  },[hasBuild]);
  const newer=newerMatchingBuild(fields,release);
  const energy=energyFromArchive(fields);
  if(!newer&&!energy)return null;
  return <div className="report-recovered">
    {newer&&<p><strong>此报告由 App {newer.observed} 采样</strong> · 当前内网发布 {newer.published}。<br/>
      <a href="#downloads">打开下载页</a>；更新手机后重新「整体获取」，上传新采样。旧报告即使再次上传也不会增加字段。</p>}
    {energy&&<details>
      <summary><strong>剩余能量粗估：约 {energy.wh} Wh</strong> · 由本次归档数据计算</summary>
      <dl>
        <div><dt>剩余电荷 · <code>battery.chargeCounter</code></dt><dd>{energy.charge.value}<small>{energy.charge.source}</small></dd></div>
        <div><dt>采样电压 · <code>battery.voltage</code></dt><dd>{energy.voltage.value}<small>{energy.voltage.source}</small></dd></div>
        <div><dt>硬件能量计 · <code>battery.energyCounter</code></dt>
          <dd>{caption(energy.counter.status)}{energy.counter.reason&&' · '+caption(energy.counter.reason)}</dd></div>
      </dl>
      <p>以电荷乘采样电压估算，不是能量计实测。没有改写原报告。<code>{energy.rule}</code></p>
    </details>}
  </div>;
}
