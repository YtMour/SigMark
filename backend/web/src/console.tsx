import { useEffect, useRef, useState } from 'react';
import { refreshSeconds, saveRefreshSeconds } from './live';
import {EmptyState,Icon,PageHead} from './workspace-ui';

export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(({
      admin_auth_required: '管理会话已过期或令牌有误。',
      build_already_queued: '已有任务在排队或运行。',
      version_not_approved: '该版本已从可构建列表移除。',
      artifact_checksum_mismatch: '文件校验失败，请重新构建。',
      invalid_settings: '请输入有效的批次名称。',
      invalid_build_profile: '版本名、内部版本号或构建参数无效。旧源码只支持默认版本。',
      publish_version_not_newer: '发布版本的内部版本号须高于当前发布版。可单独下载此构建。',
      publish_signer_changed: '产物签名和当前发布版不一致或未登记。请在原签名构建机重新构建。',
      report_selection_changed: '所选报告状态已变化。请关闭此窗口，刷新列表后重新选择。',
      report_not_found: '没有找到这份报告，请从在库列表重新选择。',
      report_export_limit: '导出范围超过 250 份或 32 MiB，请缩小筛选范围后重试。',
      report_export_empty: '当前范围没有报告可导出。',
      export_busy: '导出任务繁忙，请稍候重试。',
      rate_limited: '请求较多，请稍候重试。',
      invalid_device_assignment: '请检查设备别名或资产编号。',
      device_assignment_changed: '部分报告已归组、移入回收站或已移除，请刷新后重试。',
      device_asset_not_found: '未找到该设备资产，请核对完整编号。',
      baseline_name_exists: '该基线名称已存在，请换一个名称。',
      baseline_limit: '已保存 100 条基线，请移除不再使用的基线。',
      baseline_report_not_available: '此报告已不在档案库，请换一份在库报告。',
      baseline_not_found: '此基线已移除，刷新后再试。',
      invalid_baseline: '请输入有效的基线名称并选择一份在库报告。',
    } as Record<string, string>)[code] ?? '请求失败 · HTTP ' + status);
  }
}

export async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-SigMark-Admin', '1');
  }
  const send = () => fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  let response = await send();
  if ((!init.method || init.method === 'GET') && response.status === 429 && !init.signal?.aborted) {
    const waitSeconds = Math.min(3, Math.max(1, Number(response.headers.get('Retry-After')) || 2));
    await new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort',finish);
        resolve();
      };
      const timer = setTimeout(finish,waitSeconds*1000);
      init.signal?.addEventListener('abort',finish,{once:true});
    });
    if (!init.signal?.aborted) response = await send();
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login' && path !== '/api/admin/session') {
      window.dispatchEvent(new Event('sigmark:session-expired'));
    }
    const body = await response.json().catch(() => ({}));
    throw new RequestError(response.status, typeof body?.error === 'string' ? body.error : '');
  }
  return response;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await requestResponse(path,init)).json() as Promise<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : '连接中断，请检查内网服务后重试。';
}

type Artifact = { version: string; versionCode: number; origin: string; sha256: string; size: number; signerSha256?: string };
export function Downloads() {
  const [value, setValue] = useState<Artifact>();
  const [state, setState] = useState('正在查询已发布版本…');
  useEffect(() => {
    const controller = new AbortController();
    request<Artifact>('/api/downloads/current', {signal: controller.signal}).then(setValue).catch(error => {
      if (!controller.signal.aborted) setState(error instanceof RequestError && error.status === 404 ?
        '暂无发布包。' : errorMessage(error));
    });
    return () => controller.abort();
  }, []);
  return <main className="workspace">
    <PageHead section="downloads" description="在连接同一局域网的 Android 手机上打开本页。"/>
    <section className="panel release-panel">
      {value ? <>
        <div className="release-front"><img src="/sigmark-icon.png" alt="" width="64" height="64"/>
          <div><span className="workspace-badge">当前内网测试版</span><h2>SigMark 印迹 {value.version}</h2>
            <p className="muted">Android 8.0 及以上 · {(value.size / 1048576).toFixed(1)} MiB</p></div>
          <a className="button-link primary" href="/downloads/sigmark.apk" download><Icon name="download"/>下载 APK</a>
        </div>
        <details className="release-verify"><summary>查看版本与签名校验</summary>
        <dl className="release-data"><dt>报告接收地址</dt><dd><code>{value.origin}</code></dd>
          <dt>内部版本号</dt><dd>{value.versionCode??'—'}</dd>
          <dt>APK 校验值</dt><dd><code>{value.sha256}</code></dd>
          {value.signerSha256&&<><dt>签名证书 SHA-256</dt><dd><code>{value.signerSha256}</code></dd></>}</dl>
        </details>
      </> : <EmptyState title={state} loading={state.startsWith('正在')}/>}
    </section>
    <section className="panel console-panel install-guide"><h2>安装后如何提交报告</h2>
      <ol><li><strong>打开印迹</strong><small>检查手机显示的设备和网络信息。</small></li>
        <li><strong>预览报告</strong><small>点「上传报告」，可核对将发送的内容。</small></li>
        <li><strong>确认上传</strong><small>看到回执后，可在后台报告档案中查看。</small></li></ol>
    </section>
  </main>;
}

type Settings = { batch: string; uploadsEnabled: boolean };
export function SettingsPage() {
  const [value, setValue] = useState<Settings>();
  const [saved, setSaved] = useState<Settings>();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [interval,setIntervalChoice]=useState(refreshSeconds);
  const [prefNotice,setPrefNotice]=useState('');
  useEffect(() => {
    const controller = new AbortController();
    request<Settings>('/api/admin/settings', {signal: controller.signal}).then(response => {
      setValue(response); setSaved(response);
    }).catch(error => { if (!controller.signal.aborted) setNotice(errorMessage(error)); });
    return () => controller.abort();
  }, []);
  const dirty = value && (value.batch !== saved?.batch || value.uploadsEnabled !== saved?.uploadsEnabled);
  return <main className="workspace">
    <PageHead section="settings" description="服务器的接收规则和当前浏览器的显示偏好分开保存。"/>
    <div className="console-grid settings-grid">
    <section className="panel console-panel">
      <h2>报告接收 <span className="tag">服务器设置</span></h2>
      <p className="muted">新报告会自动打上标签，方便在档案中按测试阶段筛选。修改只影响之后上传的报告。</p>
      {!value&&!notice&&<p role="status">正在读取服务器设置…</p>}
      {value && <form className="console-form" onSubmit={async event => {
        event.preventDefault();
        setSaving(true); setNotice('');
        try {
          const result = await request<Settings>('/api/admin/settings', {method:'PUT',body:JSON.stringify(value)});
          setValue(result); setSaved(result); setNotice('设置已保存。');
        } catch (error) { setNotice(errorMessage(error)); }
        finally { setSaving(false); }
      }}>
        <label>新报告标签（批次）<input required disabled={saving} maxLength={32} pattern={String.raw`[a-z0-9][a-z0-9\x2d]{0,31}`} value={value.batch}
          onChange={event => setValue({...value, batch:event.target.value})}/></label>
        <label className="inline-check"><input type="checkbox" disabled={saving} checked={value.uploadsEnabled}
          onChange={event => setValue({...value, uploadsEnabled:event.target.checked})}/> 接收手机报告</label>
        <div className="actions form-action-row">
          <button disabled={!dirty || saving}>{saving ? '正在保存…' : '保存接收设置'}</button>
          {dirty&&<button type="button" className="secondary" disabled={saving} onClick={()=>{setValue(saved);setNotice('已放弃未保存的修改。');}}>放弃修改</button>}
        </div>
      </form>}
      <details className="setting-help"><summary>什么时候需要修改报告标签？</summary>
        <p>日常可保留 <code>lan-direct</code>。刷机前后可分别用 <code>mi8-before</code> 和 <code>mi8-after</code>，再按标签筛选样本。</p>
      </details>
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="panel console-panel"><h2>浏览与刷新 <span className="tag">本浏览器</span></h2>
      <label>自动刷新频率<select value={interval} onChange={event=>{
        const choice=Number(event.target.value);
        try{saveRefreshSeconds(choice);setIntervalChoice(choice);setPrefNotice('已保存到当前浏览器。');}
        catch{setPrefNotice('浏览器存储不可用，请检查隐私设置。');}
      }}><option value={0}>关闭</option><option value={5}>每 5 秒</option><option value={10}>每 10 秒</option><option value={30}>每 30 秒</option></select></label>
      <p className="muted">仅在页面可见时同步列表首页。查看历史页或勾选资产时暂停，保留操作位置。</p>
      {prefNotice&&<p role="status">{prefNotice}</p>}
    </section>
    </div>
    <section className="panel console-panel"><h2>服务信息</h2><dl className="release-data">
      <dt>当前服务</dt><dd><code>{location.origin}</code></dd>
      <dt>报告保存</dt><dd>PostgreSQL 长期归档</dd>
      <dt>登录会话</dt><dd>有效期 7 天，可从导航栏锁定</dd>
    </dl></section>
  </main>;
}

type Version = {name:string; commit:string; profiles?:boolean; version?:string; snapshotSha256?:string};
type Profile = {label:string; version:string; versionCode:number; checks:boolean};
type Job = Version & {id:string; state:string; createdAt:string; message?:string; version?:string; versionCode?:number; sha256?:string; origin?:string; signerSha256?:string; profile?:Profile};
type Builds = {versions:Version[]; jobs:Job[]; workerOnline:boolean; publishedId?:string};
const buildStates: Record<string,string> = {queued:'排队中', running:'编译中', succeeded:'构建成功', failed:'失败'};
export function BuildPage() {
  const [data, setData] = useState<Builds>();
  const [commit, setCommit] = useState('');
  const [error, setError] = useState('');
  const [actionError,setActionError]=useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState(false);
  const [revision, refresh] = useState(0);
  const [label,setLabel]=useState('');
  const [custom,setCustom]=useState(false);
  const [name,setName]=useState('');
  const [code,setCode]=useState('');
  const [checks,setChecks]=useState(true);
  const [filter,setFilter]=useState('all');
  const [publish,setPublish]=useState<Job>();
  const [create,setCreate]=useState(false);
  const publishDialog=useRef<HTMLDialogElement>(null);
  const publishId=publish?.id;
  useEffect(()=>{
    if(!publishId)return;
    const node=publishDialog.current;node?.showModal();
    return ()=>node?.close();
  },[publishId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const result = await request<Builds>('/api/admin/builds', {signal: controller.signal});
        if (controller.signal.aborted) return;
        setData(result); setError('');
        setCommit(current => result.versions.some(version => version.commit === current) ?
          current : result.versions[0]?.commit ?? '');
      } catch (error) { if (!controller.signal.aborted) setError(errorMessage(error)); }
      finally {
        schedule();
      }
    }
    function schedule(){if(!controller.signal.aborted)timer=setTimeout(()=>{if(document.hidden)schedule();else void load();},2500);}
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  async function submit(path: string, body?: object) {
    setAction(true); setNotice('');setActionError('');
    try {
      await request(path, {method:'POST', body:body ? JSON.stringify(body) : undefined});
      setNotice(body ? '构建已排队。' : '下载页已切换到此构建。');
      if(!body)publishDialog.current?.close();
      setPublish(undefined);
      if(body)setCreate(false);
      refresh(value => value + 1);
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setAction(false); }
  }
  const pending = data?.jobs.some(job => job.state === 'queued' || job.state === 'running');
  const selected=data?.versions.find(row=>row.commit===commit);
  const current=data?.jobs.find(job=>job.id===data.publishedId);
  const jobs=data?.jobs.filter(job=>filter==='all'||job.state===filter);
  return <main className="workspace">
    <PageHead section="builds" description="选择已登记的源码构建测试包。下载测试与正式发布是两个步骤。">
      <button type="button" className={create?'secondary':undefined} disabled={action} aria-expanded={create} onClick={()=>{setCreate(!create);setActionError('');}}>
        {create?'收起构建表单':'新建构建'}</button>
    </PageHead>
    <div className="panel build-status-strip">
      <div><small>当前内网发布</small><strong>{current?`SigMark ${current.version} · 内部版本号 ${current.versionCode??'—'}`:data?'暂无发布记录':'正在读取…'}</strong></div>
      <div><small>构建主机</small><strong className={data?.workerOnline?'text-available':''}>{!data?'正在连接…':data.workerOnline?'在线':'离线 · 任务仍可排队'}</strong></div>
      <a className="button-link secondary" href="#downloads">打开下载页 →</a>
    </div>
    {error&&<p className="panel inset error" role="alert">{error}</p>}
    {notice&&<p className="panel inset text-available" role="status">{notice}</p>}
    {create&&<section className="panel console-panel">
      <h2>新建构建任务</h2>
      <form className="build-form" onSubmit={event => {
        event.preventDefault();
        const override=!!selected?.profiles&&custom;
        void submit('/api/admin/builds',{commit,profile:{label:label.trim(),checks,version:override?name:'',versionCode:override?Number(code):0}});
      }}>
        <label>源码版本<select value={commit} onChange={event => setCommit(event.target.value)}>
          {!data?.versions.length && <option value="">暂无登记版本</option>}
          {data?.versions.map(version => <option key={version.commit} value={version.commit}>{version.name} · {version.snapshotSha256?'工作区快照':'Git 提交'} · {version.commit.slice(0,8)}</option>)}
        </select></label>
        <label>任务名称<input value={label} maxLength={60} placeholder="例：MI 8 回归测试" onChange={e=>setLabel(e.target.value)}/></label>
        <label>版本策略<select value={custom&&selected?.profiles?'custom':'default'} onChange={event=>setCustom(event.target.value==='custom')}>
          <option value="default">沿用源码中的版本</option><option value="custom" disabled={!selected?.profiles}>自定义测试版本</option>
        </select></label>
        {custom&&selected?.profiles?<div className="version-inputs">
          <label>版本名<input required pattern="[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}" placeholder="0.12.1" value={name} onChange={e=>setName(e.target.value)}/></label>
          <label>内部版本号<input required type="number" min={1} max={2100000000} placeholder={current?.versionCode?String(current.versionCode+1):'正整数'} value={code} onChange={e=>setCode(e.target.value)}/></label>
        </div>:null}
        {selected&&<small>{selected.snapshotSha256?'冻结的本地源码，不会随工作区改动。':'固定的 Git 提交。'}{selected.version&&' 默认版本 '+selected.version+'。'}
          {!selected.profiles&&' 此版本只支持默认构建；可切换到支持版本参数的源码。'}</small>}
        <label className="build-check"><input type="checkbox" checked={checks} onChange={e=>setChecks(e.target.checked)}/> 同时跑单测和 Lint</label>
        <div className="actions form-action-row"><button disabled={!commit || action || pending}>{action?'正在提交…':'加入构建队列'}</button>
          <button type="button" className="secondary" disabled={action} onClick={()=>setCreate(false)}>收起表单</button></div>
      </form>
      {pending && <p className="muted" role="status">已有任务在排队或构建中。</p>}
      {!publish&&actionError&&<p className="error" role="alert">{actionError}</p>}
    </section>}
    {publish&&<dialog ref={publishDialog} className="manage-dialog" aria-labelledby="publish-title"
      onCancel={event=>{if(action)event.preventDefault();}} onClose={event=>{
        if(!event.currentTarget.open){setPublish(undefined);setActionError('');}
      }}>
      <div className="publish-dialog-body"><h2 id="publish-title">发布 {publish.version} 到内网下载页？</h2>
        <p className="muted">此操作会替换当前下载与在线升级包。请先确认测试包已在目标手机上验证。</p>
        {actionError&&<p className="error" role="alert">{actionError}</p>}
        <div className="actions"><button type="button" autoFocus className="secondary" disabled={action}
          onClick={()=>publishDialog.current?.close()}>取消</button>
          <button type="button" disabled={action} onClick={()=>void submit('/api/admin/builds/'+publish.id+'/publish')}>{action?'正在发布…':'确认发布'}</button></div>
      </div>
    </dialog>}
    <section className="panel console-panel">
      <div className="build-history-head"><h2>构建记录</h2><label>状态<select value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="all">全部状态</option>{Object.entries(buildStates).map(([value,text])=><option key={value} value={value}>{text}</option>)}
      </select></label><button className="secondary" onClick={() => refresh(value => value + 1)}>刷新任务</button></div>
      <div className="build-items">{jobs?.length ? jobs.map(job => <article key={job.id} className="build-item">
        <div><strong>{job.profile?.label||job.name}</strong> <span className={'state '+(job.state==='succeeded'?'available':job.state==='failed'?'error':'')}>{buildStates[job.state]??job.state}</span>
          <p className="muted">{new Date(job.createdAt).toLocaleString('zh-CN')}
          {(job.version||job.profile?.version) && ' · App ' + (job.version||job.profile?.version)}
          {(job.versionCode||job.profile?.versionCode) ? ' / '+(job.versionCode||job.profile?.versionCode) : ''}
          {job.commit && ' · ' + job.commit.slice(0,8)}{job.profile?.checks&&' · 单测 / Lint'}</p>
          {job.origin && <p><code>{job.origin}</code></p>}{job.message && <p>{job.message}</p>}
        </div>
        <div className="actions">{job.state==='succeeded'&&<a className="subtle-link" href={'/api/admin/builds/'+job.id+'/apk'} download>下载测试包</a>}
          {job.id===data?.publishedId?<span className="state available">已发布</span>:
            job.state==='succeeded'&&<button className="secondary" disabled={action||!!(current?.versionCode&&(!job.versionCode||job.versionCode<=current.versionCode))}
              onClick={()=>{setActionError('');setPublish(job);}}>准备发布</button>}</div>
      </article>) : <p className="muted">{data ? filter==='all'?'暂无构建记录。':'没有匹配此状态的任务。' : '正在读取记录…'}</p>}</div>
    </section>
  </main>;
}
