import { useEffect, useState } from 'react';

export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(({
      admin_auth_required: '管理会话已过期或令牌有误。',
      build_already_queued: '已有任务在排队或运行。',
      version_not_approved: '该版本已从可构建列表移除。',
      artifact_checksum_mismatch: '文件校验失败，请重新构建。',
      invalid_settings: '请输入有效的批次名称。',
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

type Artifact = { version: string; origin: string; sha256: string; size: number };
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
        <dl className="release-data"><dt>报告接收地址</dt><dd><code>{value.origin}</code></dd><dt>SHA-256</dt><dd><code>{value.sha256}</code></dd></dl>
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
  useEffect(() => {
    const controller = new AbortController();
    request<Settings>('/api/admin/settings', {signal: controller.signal}).then(response => {
      setValue(response); setSaved(response);
    }).catch(error => { if (!controller.signal.aborted) setNotice(errorMessage(error)); });
    return () => controller.abort();
  }, []);
  const dirty = value && (value.batch !== saved?.batch || value.uploadsEnabled !== saved?.uploadsEnabled);
  return <main className="workspace"><h1>设置</h1>
    <section className="panel console-panel">
      <h2>报告接收</h2>
      <p className="muted">批次用于归类后续报告。暂停期间，手机仍可导出本地 JSON。</p>
      {value && <form className="console-form" onSubmit={async event => {
        event.preventDefault();
        setSaving(true); setNotice('');
        try {
          const result = await request<Settings>('/api/admin/settings', {method:'PUT',body:JSON.stringify(value)});
          setValue(result); setSaved(result); setNotice('设置已保存。');
        } catch (error) { setNotice(errorMessage(error)); }
        finally { setSaving(false); }
      }}>
        <label>新报告批次<input required maxLength={32} pattern={String.raw`[a-z0-9][a-z0-9\x2d]{0,31}`} value={value.batch}
          onChange={event => setValue({...value, batch:event.target.value})}/></label>
        <label className="inline-check"><input type="checkbox" checked={value.uploadsEnabled}
          onChange={event => setValue({...value, uploadsEnabled:event.target.checked})}/> 接收手机报告</label>
        <button disabled={!dirty || saving}>{saving ? '正在保存…' : '保存设置'}</button>
      </form>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="panel console-panel"><h2>工作区</h2><dl className="release-data">
      <dt>当前服务</dt><dd><code>{location.origin}</code></dd>
      <dt>报告保存</dt><dd>PostgreSQL 长期归档</dd>
      <dt>登录会话</dt><dd>有效期 7 天，可从导航栏锁定</dd>
    </dl></section>
  </main>;
}

type Version = {name:string; commit:string};
type Job = Version & {id:string; state:string; createdAt:string; message?:string; version?:string; sha256?:string; origin?:string};
type Builds = {versions:Version[]; jobs:Job[]; workerOnline:boolean; publishedId?:string};
const buildStates: Record<string,string> = {queued:'排队中', running:'编译中', succeeded:'可发布', failed:'失败'};
export function BuildPage() {
  const [data, setData] = useState<Builds>();
  const [commit, setCommit] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState(false);
  const [revision, refresh] = useState(0);
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
      refresh(value => value + 1);
    } catch (error) { setError(errorMessage(error)); }
    finally { setAction(false); }
  }
  const pending = data?.jobs.some(job => job.state === 'queued' || job.state === 'running');
  return <main className="workspace">
    <div className="page-heading"><div><h1>构建中心</h1><p className="muted">选择已登记的源码快照，编译通过后可发布到内网下载页。</p></div>
      <button className="secondary" onClick={() => refresh(value => value + 1)}>刷新任务</button></div>
    <section className="panel console-panel">
      {data && <span className={data.workerOnline ? 'state available' : 'state'}>
        {data.workerOnline ? '构建主机在线' : '构建主机离线，任务将等待连接'}
      </span>}
      <form className="console-form" onSubmit={event => {event.preventDefault(); void submit('/api/admin/builds',{commit});}}>
        <label>源码版本<select value={commit} onChange={event => setCommit(event.target.value)}>
          {!data?.versions.length && <option value="">暂无登记版本</option>}
          {data?.versions.map((version,index) => <option key={version.commit} value={version.commit}>{index===0?'最新登记 · ':''}{version.name} · {version.commit.slice(0,8)}</option>)}
        </select></label>
        <button disabled={!commit || action || pending}>开始编译</button>
      </form>
      {pending && <p className="muted" role="status">等待构建主机处理，页面会更新任务状态。</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <section className="panel console-panel"><h2>构建记录</h2>
      <div className="build-items">{data?.jobs.length ? data.jobs.map(job => <article key={job.id} className="build-item">
        <div><strong>{job.name}</strong><p className="muted">{new Date(job.createdAt).toLocaleString('zh-CN')} · {buildStates[job.state] ?? job.state}
          {job.version && ' · App ' + job.version}{job.commit && ' · ' + job.commit.slice(0,8)}</p>
          {job.origin && <p><code>{job.origin}</code></p>}{job.message && <p>{job.message}</p>}
        </div>
        {job.id === data.publishedId ? <span className="state available">当前下载版本</span> :
          job.state === 'succeeded' && <button className="secondary" disabled={action} onClick={() => void submit('/api/admin/builds/'+job.id+'/publish')}>发布到下载页</button>}
      </article>) : <p className="muted">{data ? '暂无构建记录。' : '正在读取记录…'}</p>}</div>
    </section>
  </main>;
}
