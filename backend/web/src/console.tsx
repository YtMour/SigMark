import { useEffect, useState } from 'react';
import { refreshSeconds, saveRefreshSeconds } from './live';

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
    } as Record<string, string>)[code] ?? '请求失败 · HTTP ' + status);
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-SigMark-Admin', '1');
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login' && path !== '/api/admin/session') {
      window.dispatchEvent(new Event('sigmark:session-expired'));
    }
    const body = await response.json().catch(() => ({}));
    throw new RequestError(response.status, typeof body?.error === 'string' ? body.error : '');
  }
  return response.json() as Promise<T>;
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
    <div className="page-heading"><div><h1>应用下载</h1><p className="muted">在同一局域网的 Android 手机上打开此页。</p></div></div>
    <section className="panel console-panel">
      <img src="/sigmark-icon.png" alt="" width="56" height="56"/>
      <h2>SigMark 印迹 {value?.version}</h2>
      {value ? <>
        <p className="muted">Debug 测试版 · Android 8.0 起 · {(value.size / 1048576).toFixed(1)} MiB</p>
        <a className="download" href="/downloads/sigmark.apk" download>下载 APK</a>
        <dl className="release-data"><dt>报告接收地址</dt><dd><code>{value.origin}</code></dd>
          <dt>APK 校验值</dt><dd><code>{value.sha256}</code></dd>
          {value.signerSha256&&<><dt>签名证书 SHA-256</dt><dd><code>{value.signerSha256}</code></dd></>}</dl>
        <p>安装后打开印迹，检查采集项，再点「上传报告」。小区参数可在 App 内按需授权。</p>
      </> : <p aria-live="polite">{state}</p>}
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
    <header className="page-heading collection-heading"><div><p className="eyebrow">工作区配置</p><h1>设置</h1><p className="muted">管理报告接收规则与当前浏览器的显示偏好。</p></div></header>
    <div className="console-grid">
    <section className="panel console-panel">
      <h2>报告接收 <span className="tag">服务器设置</span></h2>
      <p className="muted">测试批次是给新报告自动加的标签。例如比较刷机前后，可分别用 <code>mi8-before</code> 和 <code>mi8-after</code>，再按批次筛选。一般使用保留 <code>lan-direct</code> 即可。更改标签只影响之后上传的报告。</p>
      {value && <form className="console-form" onSubmit={async event => {
        event.preventDefault();
        setSaving(true); setNotice('');
        try {
          const result = await request<Settings>('/api/admin/settings', {method:'PUT',body:JSON.stringify(value)});
          setValue(result); setSaved(result); setNotice('设置已保存。');
        } catch (error) { setNotice(errorMessage(error)); }
        finally { setSaving(false); }
      }}>
        <label>新报告标签（批次）<input required maxLength={32} pattern={String.raw`[a-z0-9][a-z0-9\x2d]{0,31}`} value={value.batch}
          onChange={event => setValue({...value, batch:event.target.value})}/></label>
        <label className="inline-check"><input type="checkbox" checked={value.uploadsEnabled}
          onChange={event => setValue({...value, uploadsEnabled:event.target.checked})}/> 接收手机报告</label>
        <button disabled={!dirty || saving}>{saving ? '正在保存…' : '保存接收设置'}</button>
      </form>}
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
const buildStates: Record<string,string> = {queued:'排队中', running:'编译中', succeeded:'可发布', failed:'失败'};
export function BuildPage() {
  const [data, setData] = useState<Builds>();
  const [commit, setCommit] = useState('');
  const [error, setError] = useState('');
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
        if (!controller.signal.aborted) timer = setTimeout(load,2500);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  async function submit(path: string, body?: object) {
    setAction(true); setNotice('');
    try {
      await request(path, {method:'POST', body:body ? JSON.stringify(body) : undefined});
      setNotice(body ? '构建已排队。' : '下载页已切换到此构建。');
      setPublish(undefined);
      refresh(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setAction(false); }
  }
  const pending = data?.jobs.some(job => job.state === 'queued' || job.state === 'running');
  const selected=data?.versions.find(row=>row.commit===commit);
  const current=data?.jobs.find(job=>job.id===data.publishedId);
  const jobs=data?.jobs.filter(job=>filter==='all'||job.state===filter);
  return <main className="workspace">
    <header className="page-heading collection-heading"><div><p className="eyebrow">Android / 构建与分发</p><h1>构建中心</h1><p className="muted">从已登记源码生成测试包。构建完成后可单独下载，再决定是否发布。</p></div>
      <span className={data?.workerOnline?'state available':'state'}>{!data?'连接中…':data.workerOnline?'构建主机在线':'构建主机离线 · 任务可排队'}</span></header>
    <div className="console-grid build-grid">
    <section className="panel console-panel">
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
        <div><button disabled={!commit || action || pending}>加入构建队列</button></div>
      </form>
      {pending && <p className="muted" role="status">已有任务在排队或构建中。</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="panel console-panel"><h2>当前内网发布</h2>
      {current?<><p><strong>SigMark {current.version}</strong> · 内部版本号 {current.versionCode??'—'}</p>
        <p className="muted">App 内更新使用内部版本号判断新旧。同一安装需使用兼容签名，新产物可先下载测试。</p>
        <a className="subtle-link" href="#downloads">打开下载页 →</a></>:<p className="muted">暂无发布记录。</p>}
      {publish&&<div className="publish-review"><strong>发布 {publish.version} 到内网下载页？</strong>
        <p className="muted">此操作会替换当前下载包。先确认它已在目标手机上测试。</p>
        <div className="actions"><button disabled={action} onClick={()=>void submit('/api/admin/builds/'+publish.id+'/publish')}>确认发布</button>
          <button className="secondary" onClick={()=>setPublish(undefined)}>取消</button></div>
      </div>}
    </section>
    </div>
    <section className="panel console-panel">
      <div className="build-history-head"><h2>构建记录</h2><label>状态<select value={filter} onChange={e=>setFilter(e.target.value)}>
        <option value="all">全部状态</option>{Object.entries(buildStates).map(([value,text])=><option key={value} value={value}>{text}</option>)}
      </select></label><button className="secondary" onClick={() => refresh(value => value + 1)}>刷新任务</button></div>
      <div className="build-items">{jobs?.length ? jobs.map(job => <article key={job.id} className="build-item">
        <div><strong>{job.profile?.label||job.name}</strong><p className="muted">{new Date(job.createdAt).toLocaleString('zh-CN')} · {buildStates[job.state] ?? job.state}
          {(job.version||job.profile?.version) && ' · App ' + (job.version||job.profile?.version)}
          {(job.versionCode||job.profile?.versionCode) ? ' / '+(job.versionCode||job.profile?.versionCode) : ''}
          {job.commit && ' · ' + job.commit.slice(0,8)}{job.profile?.checks&&' · 单测 / Lint'}</p>
          {job.origin && <p><code>{job.origin}</code></p>}{job.message && <p>{job.message}</p>}
        </div>
        <div className="actions">{job.state==='succeeded'&&<a className="subtle-link" href={'/api/admin/builds/'+job.id+'/apk'} download>下载测试包</a>}
          {job.id===data?.publishedId?<span className="state available">已发布</span>:
            job.state==='succeeded'&&<button className="secondary" disabled={action||!!(current?.versionCode&&(!job.versionCode||job.versionCode<=current.versionCode))}
              onClick={()=>setPublish(job)}>准备发布</button>}</div>
      </article>) : <p className="muted">{data ? '暂无构建记录。' : '正在读取记录…'}</p>}</div>
    </section>
  </main>;
}
