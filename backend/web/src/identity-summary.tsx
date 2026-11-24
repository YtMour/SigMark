import {useEffect,useState} from 'react';
import {errorMessage,request} from './console';
import {date,saveDownload} from './reports';
import {openFromList,useRestoreList} from './reader-history';
import {EmptyState,MetricCards} from './workspace-ui';

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
function IdentityReportLink({report,id,label='查看报告'}:{report:string;id:string;label?:string}){
  return <a className="subtle-link" href={reportHref(report)} id={id}
    onClick={event=>openFromList(event,[''],'返回身份分布','identity-title')}>{label}</a>;
}
const shown=(value?:string)=>value&&value.trim()?value:'—';
const pairs=(values:IdentityValues)=>
  `${shown(values.model)} / ${shown(values.device)} · 主板 ${shown(values.board)}${values.boardPlatform?' / '+values.boardPlatform:''} · 硬件 ${shown(values.bootHardware)}${values.hardwareSku?' / '+values.hardwareSku:''}`;
const jump=(id:string)=>{
  const heading=document.getElementById(id);
  heading?.focus({preventScroll:true});
  heading?.scrollIntoView({block:'start'});
};

export function IdentitySummaryPage(){
  const [data,setData]=useState<Summary>();const [error,setError]=useState('');const [retry,setRetry]=useState(0);
  useRestoreList(!!data);
  useEffect(()=>{
    const ctl=new AbortController();setError('');
    request<Summary>('/api/admin/identity-summary',{signal:ctl.signal}).then(summary=>{
      if(!ctl.signal.aborted)setData(summary);
    }).catch(err=>{if(!ctl.signal.aborted)setError(errorMessage(err));});
    return ()=>ctl.abort();
  },[retry]);
  return <section className="identity-workspace" aria-labelledby="identity-title">
    <header className="panel pane-title">
      <div><h2 id="identity-title" tabIndex={-1}>身份分布</h2><p className="muted">核对全库的身份声明和关联设备。</p></div>
      {data&&<button type="button" className="secondary" onClick={()=>saveDownload(
        new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'SigMark-身份分布.json')}>导出身份分布 JSON</button>}
    </header>
    {error?<div className="panel inset"><span role="alert">{error}</span>{' '}
      <button type="button" className="secondary" onClick={()=>setRetry(n=>n+1)}>重试</button></div>:
      !data?<p role="status">正在读取身份分布…</p>:<>
      <section className="panel asset-summary" aria-label="身份分布概览">
        <div className="pane-title"><div><h2>概览</h2><p className="muted">只读统计 · 取自归档参数，不改变报告和资产关系</p></div>
          <div className="actions"><small className="overview-updated">生成 {date(data.generatedAtEpochMs)}</small></div></div>
        <MetricCards label="身份统计" items={[
          {label:'在库报告',value:data.reports,href:'#reports',hint:'查看报告'},
          {label:'已归组设备',value:data.assets,href:'#assets?tab=devices',hint:'查看设备'},
          {label:'多身份资产',value:data.multiIdentityAssets.length,onSelect:()=>jump('identity-drift'),hint:'定位明细'},
          {label:'跨资产同身份',value:data.sharedIdentities.length,onSelect:()=>jump('identity-shared'),hint:'定位明细'},
          {label:'内部冲突报告',value:data.conflictReports,onSelect:()=>jump('identity-conflicts'),hint:'查看冲突'},
        ]}/>
        <p className="muted identity-scope">规则 {data.ruleVersion} · 比较已归档的 Build 字段与只读属性。两侧都有值时才比较。{data.truncated&&' 多身份资产与跨资产同身份卡片显示的是已列项数。'}</p>
      </section>

      <section className="panel" aria-label="多身份资产">
        <div className="pane-title"><div><h2 id="identity-drift" tabIndex={-1}>多身份资产</h2><p className="muted">同一已归组设备出现过不止一套「型号 + 主板 + 硬件」声明</p></div></div>
        {data.multiIdentityAssets.length?<div className="identity-table"><table role="table" aria-labelledby="identity-drift">
          <thead><tr><th scope="col">资产</th><th scope="col">身份套数</th><th scope="col">报告</th><th scope="col">最近声明</th></tr></thead>
          <tbody role="rowgroup">{data.multiIdentityAssets.map(row=><tr role="row" key={row.assetId}>
            <td role="cell" data-label="资产"><a className="subtle-link" href={assetHref(row.assetId)}>打开档案</a></td>
            <td role="cell" data-label="身份套数">{row.identities.length}</td><td role="cell" data-label="报告">{row.reports}</td>
            <td role="cell" data-label="最近声明"><ul className="identity-list">{row.identities.map(identity=><li key={identity.lastReportId}>
              {pairs(identity)} · {identity.reports} 份 · 最近 {date(identity.lastCapturedAtEpochMs)} ·{' '}
              <IdentityReportLink report={identity.lastReportId} id={'identity-drift-'+identity.lastReportId}/></li>)}</ul></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有多身份资产">同一资产的历史声明只有一套，或还没有已归组报告。</EmptyState>}
      </section>

      <section className="panel" aria-label="跨资产同身份">
        <div className="pane-title"><div><h2 id="identity-shared" tabIndex={-1}>跨资产同身份</h2><p className="muted">同一套声明出现在多个已归组设备中，同型号设备可能共享声明。</p></div></div>
        {data.sharedIdentities.length?<div className="identity-table"><table role="table" aria-labelledby="identity-shared">
          <thead><tr><th scope="col">身份声明</th><th scope="col">设备数</th><th scope="col">报告</th><th scope="col">最近</th></tr></thead>
          <tbody role="rowgroup">{data.sharedIdentities.map(row=><tr role="row" key={(row.lastReportId??'')+pairs(row)}>
            <td role="cell" data-label="身份声明">{pairs(row)}</td><td role="cell" data-label="设备数">{row.assetCount}</td><td role="cell" data-label="报告">{row.reports}</td>
            <td role="cell" data-label="最近"><span>{date(row.lastCapturedAtEpochMs)} · <IdentityReportLink
              report={row.lastReportId} id={'identity-shared-'+row.lastReportId}/></span></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有跨资产同身份">没有两套已归组设备声明完全相同。</EmptyState>}
      </section>

      <section className="panel" aria-label="内部冲突报告">
        <div className="pane-title"><div><h2 id="identity-conflicts" tabIndex={-1}>内部冲突报告</h2><p className="muted">同一份报告里的 Build 声明与只读属性声明不一致。</p></div></div>
        {data.conflictReports?<div className="identity-table"><table role="table" aria-labelledby="identity-conflicts">
          <thead><tr><th scope="col">报告</th><th scope="col">资产</th><th scope="col">采样</th><th scope="col">冲突对</th></tr></thead>
          <tbody role="rowgroup">{data.conflictSamples.map(row=><tr role="row" key={row.reportId}>
            <td role="cell" data-label="报告"><IdentityReportLink report={row.reportId}
              id={'identity-conflict-'+row.reportId} label="打开报告"/></td>
            <td role="cell" data-label="资产">{row.assetId?<a className="subtle-link" href={assetHref(row.assetId)}>打开档案</a>:'未归组'}</td>
            <td role="cell" data-label="采样">{date(row.capturedAtEpochMs)}</td>
            <td role="cell" data-label="冲突对"><ul className="identity-list">{row.pairs.map(pair=><li key={pair.leftKey+pair.rightKey}>
              <code>{pair.leftKey}</code> = {pair.left} ≠ <code>{pair.rightKey}</code> = {pair.right}</li>)}</ul></td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="没有内部冲突报告">Build 与属性声明要么一致，要么至少一侧没有可用读数。</EmptyState>}
        {data.conflictReports>data.conflictSamples.length&&<p className="muted">另有 {data.conflictReports-data.conflictSamples.length} 份冲突报告未列出。</p>}
      </section>
    </>}
  </section>;
}
