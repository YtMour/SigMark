import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {date,saveDownload} from './reports';
import {EmptyState,PageHead} from './workspace-ui';

type IdentityValues={model?:string;device?:string;board?:string;boardPlatform?:string;bootHardware?:string;hardwareSku?:string};
type Decl=IdentityValues&{reports:number;lastCapturedAtEpochMs:number;lastReportId:string};
type Drift={assetId:string;identities:Decl[];reports:number;lastCapturedAtEpochMs:number};
type Shared=IdentityValues&{assetCount:number;reports:number;lastCapturedAtEpochMs:number;lastReportId:string};
type Pair={leftKey:string;rightKey:string;left:string;right:string};
type Conflict={reportId:string;assetId?:string;capturedAtEpochMs:number;pairs:Pair[]};
type Summary={schemaVersion:number;ruleVersion:string;generatedAtEpochMs:number;reports:number;assets:number;
  multiIdentityAssets:Drift[];sharedIdentities:Shared[];conflictReports:number;conflictSamples:Conflict[];truncated:boolean};

const assetHref=(id:string)=>'#assets?'+new URLSearchParams({tab:'devices',sampleAsset:id});
const reportHref=(id:string)=>'#reports?'+new URLSearchParams({report:id});
const shown=(value?:string)=>value&&value.trim()?value:'—';
const pairs=(values:IdentityValues)=>
  `${shown(values.model)} / ${shown(values.device)} · 主板 ${shown(values.board)}${values.boardPlatform?' / '+values.boardPlatform:''} · 硬件 ${shown(values.bootHardware)}${values.hardwareSku?' / '+values.hardwareSku:''}`;

export function IdentitySummaryPage(){
  const [data,setData]=useState<Summary>();const [error,setError]=useState('');const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const ctl=new AbortController();setError('');
    request<Summary>('/api/admin/identity-summary',{signal:ctl.signal}).then(summary=>{
      if(!ctl.signal.aborted)setData(summary);
    }).catch(err=>{if(!ctl.signal.aborted)setError(errorMessage(err));});
    return ()=>ctl.abort();
  },[retry]);
  return <main className="workspace">
    <PageHead section="identity" description="按归档里的身份声明看：同一资产是否换过身份、同一身份是否落在多台设备、哪些报告内部不一致。">
      {data&&<button type="button" className="secondary" onClick={()=>saveDownload(
        new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-身份分布.json')}>导出身份分布 JSON</button>}
    </PageHead>
    {error?<div className="panel inset"><span role="alert">{error}</span>{' '}
      <button type="button" className="secondary" onClick={()=>setRetry(n=>n+1)}>重试</button></div>:
      !data?<p role="status">正在读取身份分布…</p>:<>
      <section className="panel asset-summary" aria-label="身份分布概览">
        <div className="pane-title"><div><h2>概览</h2><p className="muted">只读统计 · 取自归档参数，不改变报告和资产关系</p></div>
          <div className="actions"><small className="overview-updated">生成 {date(data.generatedAtEpochMs)}</small></div></div>
        <div className="asset-overview">
          {[
            {label:'在库报告',value:data.reports,action:<a className="subtle-link" href="#reports">看全部报告 →</a>},
            {label:'已归组设备',value:data.assets,action:<a className="subtle-link" href="#assets?tab=devices">设备档案 →</a>},
            {label:'多身份资产',value:data.multiIdentityAssets.length,action:<a className="subtle-link" href="#identity">见下方列表</a>},
            {label:'跨资产同身份',value:data.sharedIdentities.length,action:<a className="subtle-link" href="#identity">见下方列表</a>},
            {label:'内部冲突报告',value:data.conflictReports,action:<a className="subtle-link" href="#identity">见下方列表</a>},
          ].map(({label,value,action})=><div key={label}><span>{label}</span>
            <strong>{value.toLocaleString('zh-CN')}</strong>{action}</div>)}
        </div>
        <p className="muted">规则 {data.ruleVersion} · 身份声明来自报告里的 Build 字段与只读属性；它不等于物理设备认证，限制读取的字段不会被当成“不一致”。{data.truncated&&' 列表已截断，只显示最近 20 项。'}</p>
      </section>

      <section className="panel" aria-label="多身份资产">
        <div className="pane-title"><div><h2>多身份资产</h2><p className="muted">同一已归组设备出现过不止一套「型号 + 主板 + 硬件」声明</p></div></div>
        {data.multiIdentityAssets.length?<div className="scope-table"><table>
          <thead><tr><th>资产</th><th>身份套数</th><th>报告</th><th>最近声明</th></tr></thead>
          <tbody>{data.multiIdentityAssets.map(row=><tr key={row.assetId}>
            <td><a className="subtle-link" href={assetHref(row.assetId)}>打开档案</a></td>
            <td>{row.identities.length}</td><td>{row.reports}</td>
            <td><ul className="identity-list">{row.identities.map(identity=><li key={identity.lastReportId}>
              {pairs(identity)} · {identity.reports} 份 · 最近 {date(identity.lastCapturedAtEpochMs)} ·{' '}
              <a className="subtle-link" href={reportHref(identity.lastReportId)}>查看报告</a></li>)}</ul></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有多身份资产">同一资产的历史声明只有一套，或还没有已归组报告。</EmptyState>}
      </section>

      <section className="panel" aria-label="跨资产同身份">
        <div className="pane-title"><div><h2>跨资产同身份</h2><p className="muted">同一套声明出现在两台及以上已归组设备；同型号本来就会撞码，不据此判定克隆</p></div></div>
        {data.sharedIdentities.length?<div className="scope-table"><table>
          <thead><tr><th>身份声明</th><th>设备数</th><th>报告</th><th>最近</th></tr></thead>
          <tbody>{data.sharedIdentities.map(row=><tr key={(row.lastReportId??'')+pairs(row)}>
            <td>{pairs(row)}</td><td>{row.assetCount}</td><td>{row.reports}</td>
            <td>{date(row.lastCapturedAtEpochMs)} · <a className="subtle-link" href={reportHref(row.lastReportId)}>查看报告</a></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有跨资产同身份">没有两套已归组设备声明完全相同。</EmptyState>}
      </section>

      <section className="panel" aria-label="内部冲突报告">
        <div className="pane-title"><div><h2>内部冲突报告</h2><p className="muted">同一份报告里 Build 声明与只读属性声明不一致；两侧都有值才比较</p></div></div>
        {data.conflictReports?<div className="scope-table"><table>
          <thead><tr><th>报告</th><th>资产</th><th>采样</th><th>冲突对</th></tr></thead>
          <tbody>{data.conflictSamples.map(row=><tr key={row.reportId}>
            <td><a className="subtle-link" href={reportHref(row.reportId)}>打开报告</a></td>
            <td>{row.assetId?<a className="subtle-link" href={assetHref(row.assetId)}>打开档案</a>:'未归组'}</td>
            <td>{date(row.capturedAtEpochMs)}</td>
            <td><ul className="identity-list">{row.pairs.map(pair=><li key={pair.leftKey+pair.rightKey}>
              <code>{pair.leftKey}</code> = {pair.left} ≠ <code>{pair.rightKey}</code> = {pair.right}</li>)}</ul></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有内部冲突报告">Build 与属性声明要么一致，要么至少一侧没有可用读数。</EmptyState>}
        {data.conflictReports>data.conflictSamples.length&&<p className="muted">另有 {data.conflictReports-data.conflictSamples.length} 份冲突报告未列出。</p>}
      </section>
    </>}
  </main>;
}
