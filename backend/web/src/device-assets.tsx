import {useEffect,useRef,useState} from 'react';
import {errorMessage,request} from './console';
import {useVisiblePoll,refreshSeconds} from './live';
import {date,saveDownload,type Page,type Row} from './reports';
import {reportWorkspaceLink,emptyReportFilters} from './workspace-route';
import {listPages,openFromList,useRestoreList} from './reader-history';

type DeviceRow={id:string;label:string;model:string;reports:number;firstSeen:string;lastSeen:string};
type Inventory={items:DeviceRow[];nextCursor:string;totals:{devices:number;reports:number;unassigned:number;trash:number}};
const assetReports=(id:string)=>'#assets?'+new URLSearchParams({q:'asset:'+id});
const devicePage=(sampleAsset?:string)=>reportWorkspaceLink('assets',undefined,{devices:true,sampleAsset});

type DistributionKey='brand'|'model'|'android'|'api'|'batch';
type AssetOverview={schemaVersion:1;generatedAt:string;totals:Inventory['totals'];
  distributions:Partial<Record<DistributionKey,{buckets:{value:string;reports:number;devices:number}[];otherBuckets:number}>>};

export function InventorySummary({revision}:{revision:number}){
  const [overview,setOverview]=useState<AssetOverview>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [dimension,setDimension]=useState<DistributionKey>('brand');
  const path='/api/admin/device-assets?summary=1';
  const totals=overview?.totals;
  const distribution=overview?.distributions[dimension];
  useEffect(()=>{
    const control=new AbortController();setLoading(true);
    request<AssetOverview>(path,{signal:control.signal}).then(data=>{
      if(!control.signal.aborted){setOverview(data);setError('');}
    }).catch(err=>{if(!control.signal.aborted)setError(errorMessage(err));})
      .finally(()=>{if(!control.signal.aborted)setLoading(false);});
    return ()=>control.abort();
  },[revision,retry]);
  useVisiblePoll(!loading,async signal=>{
    const data=await request<AssetOverview>(path,{signal});
    if(!signal.aborted){setOverview(data);setError('');}
  },`${revision}:${retry}`);
  return <section className="panel asset-summary" aria-label="仓库设备统计">
    <div className="pane-title"><div><h2>仓库总览</h2><p className="muted">全库统计 · 同一已归组手机只计一部</p></div>
      <div className="actions">{overview&&<small className="overview-updated">更新于 {date(overview.generatedAt)}</small>}
        <button type="button" className="secondary" disabled={!overview} onClick={()=>overview&&saveDownload(
          new Blob([JSON.stringify(overview,null,2)],{type:'application/json'}),'SigMark-仓库统计.json')}>导出统计</button>
        <button type="button" className="secondary" disabled={loading} onClick={()=>setRetry(n=>n+1)}>{loading?'读取统计…':'刷新统计'}</button></div>
    </div>
    <div className="asset-overview">
      {[
        {label:'已归组设备',value:totals?.devices,action:<a className="subtle-link" href="#assets?tab=devices">查看设备档案 →</a>},
        {label:'在库报告',value:totals?.reports,action:<a className="subtle-link" href={reportWorkspaceLink('assets',undefined,{view:'archive'})}>看全部报告</a>},
        {label:'未归组报告',value:totals?.unassigned,action:<a className="subtle-link" href={assetReports('unassigned')}>处理未归组报告</a>},
        {label:'回收站报告',value:totals?.trash,action:<a className="subtle-link" href="#assets?view=trash">打开回收站</a>},
      ].map(({label,value,action})=><div key={label}><span>{label}</span><strong>{value?.toLocaleString('zh-CN')??'—'}</strong>{action}</div>)}
    </div>
    <details className="overview-details"><summary>分类统计 <small>品牌、型号、Android、API 与批次</small></summary>
    <div className="overview-distribution">
      <label>报告分布<select aria-label="报告分布" value={dimension} onChange={e=>setDimension(e.target.value as DistributionKey)}>
        <option value="brand">按品牌</option><option value="model">按型号</option><option value="android">按 Android 版本</option>
        <option value="api">按 API 级别</option><option value="batch">按批次</option>
      </select></label>
      <div className="distribution-list" aria-label="分布分类">
        {distribution?.buckets.map(bucket=><a className="distribution-item" key={bucket.value}
          href={'#assets?'+new URLSearchParams({[dimension]:bucket.value})}>
          <b>{bucket.value==='~missing'?'未记录':bucket.value}</b><small>{bucket.reports} 份 · {bucket.devices} 部已归组</small>
        </a>)}
        {overview&&!distribution?.buckets.length&&<small>暂无在库报告。</small>}
        {!!distribution?.otherBuckets&&<small>另有 {distribution.otherBuckets} 类，请使用列表筛选查看。</small>}
      </div>
    </div>
    <p className="overview-note">分布只统计在库报告；同一设备可能出现在不同系统版本或批次，分类设备数不可相加。
      {overview&&<span className="overview-updated-detail">更新于 {date(overview.generatedAt)}</span>}</p>
    </details>
    {error&&<p className="inset error" role="status">{overview?'当前显示上次成功统计。':''}{error}</p>}
  </section>;
}


export function DeviceInventory({changed,sampleAsset}:{changed:()=>void;sampleAsset:string}){
  const [input,setInput]=useState(''),[q,setQ]=useState('');
  const [pages,setPages]=useState(['']);
  const [revision,refresh]=useState(0);
  const [merge,setMerge]=useState<DeviceRow>();
  const [detail,setDetail]=useState<{id:string;row?:DeviceRow;error?:string}>();
  const [result,setResult]=useState<{path:string;value:Inventory}>();
  const [error,setError]=useState('');
  const path='/api/admin/device-assets?'+new URLSearchParams({q,before:pages[pages.length-1]});
  const current=result?.path===path?result.value:undefined;
  useEffect(()=>{
    const controller=new AbortController();
    request<Inventory>(path,{signal:controller.signal}).then(value=>{
      if(!controller.signal.aborted){setError('');setResult({path,value});}
    }).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error));});
    return ()=>controller.abort();
  },[path,revision]);
  useVisiblePoll(!sampleAsset&&pages.length===1&&!merge,async signal=>{
    const value=await request<Inventory>(path,{signal});
    if(!signal.aborted){setError('');setResult({path,value});}
  },path);
  const localRow=current?.items.find(item=>item.id===sampleAsset);
  useEffect(()=>{
    if(!sampleAsset||localRow)return;
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(sampleAsset)){
      setDetail({id:sampleAsset,error:'设备编号格式不正确。'});return;
    }
    const controller=new AbortController();
    request<Inventory>('/api/admin/device-assets?'+new URLSearchParams({q:sampleAsset}),{signal:controller.signal})
      .then(data=>{
        if(controller.signal.aborted)return;
        const row=data.items.find(item=>item.id===sampleAsset);
        setDetail(row?{id:sampleAsset,row}:{id:sampleAsset,error:'这个设备没有可查看的在库采样。'});
      }).catch(error=>{if(!controller.signal.aborted)setDetail({id:sampleAsset,error:errorMessage(error)});});
    return ()=>controller.abort();
  },[sampleAsset,localRow]);
  const inspected=localRow??(detail?.id===sampleAsset?detail.row:undefined);
  const close=()=>{
    location.hash=devicePage();
    const restoreFocus=()=>requestAnimationFrame(()=>(
      document.getElementById('history-'+sampleAsset)??document.getElementById('device-search')
    )?.focus());
    window.addEventListener('hashchange',restoreFocus,{once:true});
  };
  if(sampleAsset)return inspected?<AssetTimeline key={inspected.id} row={inspected} close={close}/>:
    <section className="panel" aria-label="设备历史报告">
      <div className="pane-title"><button type="button" className="secondary" onClick={close}>← 返回设备列表</button></div>
      {detail?.id===sampleAsset&&detail.error?<p role="alert" className="inset error">{detail.error}</p>:
        <p role="status" className="empty">正在读取设备采样…</p>}
    </section>;
  return <>
    <section className="panel stats-analysis" aria-labelledby="devices-title">
      <div className="pane-title"><div><h2 id="devices-title">设备档案</h2>
        <p className="muted">每部已归组手机只显示一行。点「查看采样」查看该设备的历次报告；搜索不改变顶部全库统计。</p></div>
        <button type="button" className="secondary" onClick={()=>refresh(n=>n+1)}>刷新</button></div>
      <form className="asset-device-search" onSubmit={e=>{e.preventDefault();setPages(['']);setQ(input.trim());setError('');refresh(n=>n+1);}}>
        <label>搜索设备<input id="device-search" value={input} maxLength={80} placeholder="资产别名、型号或资产编号" onChange={e=>setInput(e.target.value)}/></label>
        <button>查询设备</button>
        {q&&<button type="button" className="secondary" onClick={()=>{setInput('');setQ('');setPages(['']);setError('');}}>清除</button>}
      </form>
      {error?<p className="error inset" role="alert">{error}</p>:!current?<p className="empty" role="status">正在读取设备档案…</p>:
        !current.items.length?<p className="empty">没有匹配的已归组设备。可为历史报告手动归组，或在新版 App 上传时开启「关联到同一设备资产」。</p>:
        <ul className="device-inventory">
          {current.items.map(row=><li key={row.id}>
            <div><strong>{row.label||row.model}</strong><small>{row.label?row.model+' · ':''}<code>{row.id}</code></small></div>
            <div><strong>{row.reports} 份采样</strong><small>首次 {date(row.firstSeen)} · 最近 {date(row.lastSeen)}</small></div>
            <div className="actions"><a id={'history-'+row.id} className="button-link secondary" href={devicePage(row.id)}>查看采样</a>
              <a className="subtle-link" href={assetReports(row.id)}>管理报告 →</a>
              <button type="button" className="secondary" onClick={()=>setMerge(row)}>合并到另一设备</button></div>
          </li>)}
        </ul>}
      <nav className="pages" aria-label="设备分页">
        <button type="button" className="secondary" disabled={!current||pages.length===1} onClick={()=>setPages(p=>p.slice(0,-1))}>上一页</button>
        <span>第 {pages.length} 页{pages.length===1&&refreshSeconds()? ' · 自动同步':''}</span>
        <button type="button" className="secondary" disabled={!current?.nextCursor} onClick={()=>current&&setPages(p=>[...p,current.nextCursor])}>下一页</button>
      </nav>
    </section>
    <details className="panel stats-policy"><summary>归组规则和历史报告</summary>
      <p>新版 App 经用户勾选后，同一安装发出的报告会自动归组。清除数据、刷机或重装可能生成新的标记；同型号不代表同一手机。没有关联的报告只能由确认过设备归属的管理员手动归组。</p>
      <p>归组只改变关联，不覆盖或删除原始采样。确认刷机前后是同一部手机，可合并两个资产。该统计不是硬件身份核验。</p>
    </details>
    {merge&&<MergeDevice row={merge} candidates={current?.items??[]} close={()=>setMerge(undefined)} done={()=>{
      setMerge(undefined);setPages(['']);refresh(n=>n+1);changed();
    }}/>}
  </>;
}

function AssetTimeline({row,close}:{row:DeviceRow;close:()=>void}){
  const [entries,setEntries]=useState<Row[]>([]);
  const [savedPages]=useState(listPages);
  const visited=useRef<string[]>([]);
  const [cursor,setCursor]=useState('');
  const [next,setNext]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<string[]>([]);
  const target=useRef<HTMLElement>(null);
  useRestoreList(!loading);
  useEffect(()=>{target.current?.focus();},[]);
  useEffect(()=>{
    const control=new AbortController();
    request<Page>('/api/admin/reports?'+new URLSearchParams({q:'asset:'+row.id,before:cursor}),{signal:control.signal})
      .then(data=>{if(!control.signal.aborted){
        if(!visited.current.includes(cursor))visited.current.push(cursor);
        setEntries(old=>[...old,...data.items.filter(item=>!old.some(prev=>prev.id===item.id))]);setNext(data.nextCursor);
        const restoreCursor=savedPages[visited.current.length];
        if(restoreCursor)setCursor(restoreCursor);else setLoading(false);
      }}).catch(err=>{if(!control.signal.aborted){setError(errorMessage(err));setLoading(false);}});
    return ()=>control.abort();
  },[row.id,cursor,savedPages]);
  return <section className="panel" aria-label="设备历史报告" tabIndex={-1} ref={target}>
    <div className="pane-title"><div className="device-reader-heading">
      <button type="button" className="secondary" onClick={close}>← 返回设备列表</button>
      <h2 tabIndex={-1} id={'samples-'+row.id}>{row.label||row.model} · 设备采样</h2>
      </div></div>
    <div className="pane-title"><div>
      <p className="muted">按接收时间排序；保留手机采样时间。依次勾选基线和对照报告，新旧字段集会影响对比结果。</p></div>
      <div className="actions">{selected.length===2&&<a className="subtle-link" id={'pair-'+row.id}
        onClick={e=>openFromList(e,visited.current,'返回设备采样','samples-'+row.id)} href={'#reports?'+new URLSearchParams({q:'asset:'+row.id,baseline:selected[0],report:selected[1]})}>对比所选两份 →</a>}
        </div></div>
    {error&&<p className="error inset" role="alert">{error}</p>}
    {!loading&&!error&&!entries.length&&<p className="empty">该设备未找到在库采样。</p>}
    <ul className="device-inventory">{entries.map(({id,report,batch,receivedAt})=><li key={id}>
      <label className="build-check">
        <input type="checkbox" aria-label={'选择采样 '+id.slice(0,8)} checked={selected.includes(id)} disabled={selected.length>=2&&!selected.includes(id)}
          onChange={e=>setSelected(old=>e.target.checked?[...old,id]:old.filter(item=>item!==id))}/>
        <span>{selected[0]===id?'基线 · ':selected[1]===id?'对照 · ':''}{report.capturedAtEpochMs?date(report.capturedAtEpochMs):'采样时间未记录'}
          <small>接收 {date(receivedAt)} · {batch}</small></span>
      </label>
      <div>{[report.android&&'Android '+report.android,report.buildId,report.romHint].filter(Boolean).join(' · ')||'构建信息未归档'}
        <small>API {report.androidApi||'—'} · App {report.appVersion} · {report.fieldSetVersion?'字段集 '+report.fieldSetVersion:'旧协议'}</small></div>
      <a className="subtle-link" id={'sample-read-'+id} onClick={e=>openFromList(e,visited.current,'返回设备采样')}
        href={reportWorkspaceLink('reports',{...emptyReportFilters,q:'asset:'+row.id},{report:id})}>查看报告 →</a>
    </li>)}</ul>
    <div className="pages"><span>{loading?'正在读取…':`已载入 ${entries.length} 份`}</span>
      {next&&<button disabled={loading} className="secondary" type="button" onClick={()=>{setError('');setLoading(true);setCursor(next);}}>加载更早采样</button>}</div>
  </section>;
}

function MergeDevice({row,candidates,close,done}:{row:DeviceRow;candidates:DeviceRow[];close:()=>void;done:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [target,setTarget]=useState(''),[error,setError]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{const node=ref.current;node?.showModal();return ()=>node?.close();},[]);
  const ready=confirmed&&/^[0-9a-f-]{36}$/.test(target.trim())&&target.trim()!==row.id;
  return <dialog ref={ref} className="manage-dialog" aria-labelledby="merge-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <form onSubmit={async e=>{
      e.preventDefault();if(!ready||busy)return;
      setBusy(true);setError('');
      try {await request('/api/admin/device-assets/merge',{method:'POST',body:JSON.stringify({source:row.id,target:target.trim(),confirmed})});done();}
      catch(error){setError(errorMessage(error));setBusy(false);}
    }}>
      <h2 id="merge-title">合并设备资产</h2>
      <p className="muted">将 {row.label||row.model}（{row.id.slice(0,8)}）的报告和后续上传归到目标。保留目标别名和所有报告，但来源资产将移除，暂无一键撤销。</p>
      <label>目标设备编号<input list="merge-device-targets" maxLength={36} value={target} onChange={e=>setTarget(e.target.value)} disabled={busy}/>
        <datalist id="merge-device-targets">{candidates.filter(item=>item.id!==row.id).map(item=><option key={item.id} value={item.id}>{item.label||item.model}</option>)}</datalist></label>
      <label className="build-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>我已确认两个资产对应同一部手机</label>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={close} disabled={busy}>取消</button>
        <button disabled={!ready||busy}>{busy?'正在合并…':'确认合并'}</button></div>
    </form>
  </dialog>;
}

export function AssignDevice({rows,close,done}:{rows:Row[];close:()=>void;done:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [mode,setMode]=useState<'new'|'existing'>('new');
  const [label,setLabel]=useState(''),[assetId,setAssetId]=useState('');
  const [candidates,setCandidates]=useState<DeviceRow[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const node=ref.current;node?.showModal();return ()=>node?.close();},[]);
  useEffect(()=>{
    const controller=new AbortController();
    request<Inventory>('/api/admin/device-assets',{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setCandidates(data.items);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const ready=mode==='new'?!!label.trim():/^[0-9a-f-]{36}$/.test(assetId.trim());
  return <dialog className="manage-dialog" ref={ref} aria-labelledby="assign-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <form onSubmit={async e=>{
      e.preventDefault();if(busy||!ready||!confirmed)return;
      setBusy(true);setError('');
      try {
        await request('/api/admin/device-assets/assign',{method:'POST',body:JSON.stringify({
          ids:rows.map(row=>row.id),...(mode==='new'?{label:label.trim()}:{assetId:assetId.trim()}),
        })});done();
      } catch(error){setError(errorMessage(error));setBusy(false);}
    }}>
      <h2 id="assign-title">归入同一设备 · {rows.length} 份</h2>
      <p className="muted">只在确认这些报告来自同一部实体手机时归组。同一型号可能对应多部手机。</p>
      <ul>{rows.map(row=><li key={row.id}>{row.report.model} · {row.batch} · <code>{row.id.slice(0,8)}</code></li>)}</ul>
      <label>目标类型<select aria-label="目标类型" value={mode} disabled={busy} onChange={e=>setMode(e.target.value==='existing'?'existing':'new')}>
        <option value="new">新建设备资产</option><option value="existing">关联到现有设备</option>
      </select></label>
      {mode==='new'?<label>设备别名<input value={label} maxLength={60} disabled={busy} onChange={e=>setLabel(e.target.value)} placeholder="例如：实验室 MI 8 · 01"/></label>:
        <label>设备资产编号<input list="known-device-assets" value={assetId} maxLength={36} disabled={busy} onChange={e=>setAssetId(e.target.value)} placeholder="输入或粘贴设备档案中的完整 UUID"/>
          <datalist id="known-device-assets">{candidates.map(row=><option key={row.id} value={row.id}>{row.label||row.model}</option>)}</datalist></label>}
      <label className="build-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>我已确认这些报告来自同一部手机</label>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={close} disabled={busy}>取消</button>
        <button disabled={busy||!ready||!confirmed}>{busy?'正在归组…':'确认归组'}</button></div>
    </form>
  </dialog>;
}
