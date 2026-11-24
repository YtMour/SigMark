import {date,type Report} from './reports';
import {hashParams,reportScope,reportWorkspaceLink} from './workspace-route';
import {followReadLink,followReaderParent,readerOrigin} from './reader-history';
import {Icon} from './workspace-ui';

type ReportView='report'|'security'|'lab';
const titles={report:'报告详情',security:'指纹安全',lab:'验收工作台'};

export function reportLabLink(id:string,options:Record<string,string>={},hash=location.hash){
  const scope=hashParams(reportWorkspaceLink('reports',reportScope(hash)));
  scope.set('report',id);
  for(const [key,value] of Object.entries(options))scope.set(key,value);
  return '#lab?'+scope;
}

export function ReportFlow({report,view}:{report:Report;view:ReportView}){
  const scope=reportScope(location.hash);
  const origin=readerOrigin();
  const originHref=origin?.hash||reportWorkspaceLink('reports',scope);
  const originLabel=origin?.label??'返回报告列表';
  const reportHref=reportWorkspaceLink('reports',scope,{report:report.id});
  const securityHref=reportWorkspaceLink('security',scope,{report:report.id});
  const labHref=reportLabLink(report.id);

  return <header className="report-flow" data-report-view={view}>
    <nav className="report-breadcrumb" aria-label="报告路径">
      <ol>
        <li><a href={originHref} onClick={followReaderParent}>{originLabel}</a></li>
        {view!=='report'&&<li><a href={reportHref} onClick={followReaderParent}>返回报告详情</a></li>}
        <li><a href={location.hash} aria-current="page">{titles[view]}</a></li>
      </ol>
    </nav>
    <div className="report-flow-title">
      <div>
        <h1>{view==='report'?report.report.model:titles[view]}</h1>
        <p>{view!=='report'&&<strong>{report.report.model} · </strong>}
          {report.report.capturedAtEpochMs>0?`采样 ${date(report.report.capturedAtEpochMs)}`:'采样时间未记录'}
        </p>
      </div>
      <dl className="report-stamps" aria-label="采样版本">
        <div><dt>Android API</dt><dd>{report.report.androidApi||'—'}</dd></div>
        <div><dt>采集版本</dt><dd>{report.report.appVersion||'—'}</dd></div>
        <div><dt>字段集</dt><dd>{report.report.fieldSetVersion?`v${report.report.fieldSetVersion}`:'—'}</dd></div>
      </dl>
    </div>
    <nav className="report-flow-views" aria-label="当前报告功能">
      <a href={reportHref} onClick={followReaderParent} aria-current={view==='report'?'page':undefined}><Icon name="archive"/>查看参数</a>
      <a href={view==='security'?location.hash:securityHref} onClick={followReadLink}
        aria-current={view==='security'?'page':undefined}><Icon name="shield"/>单份安全分析</a>
      <a href={view==='lab'?location.hash:labHref} onClick={followReadLink}
        aria-current={view==='lab'?'page':undefined}><Icon name="lab"/>打开验收工作台</a>
    </nav>
  </header>;
}
