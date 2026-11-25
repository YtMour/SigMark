import {date,type Report} from './reports';
import {hashParams,reportScope,reportWorkspaceLink} from './workspace-route';
import {followReaderParent,readerAncestor,readerOrigin} from './reader-history';
import {Icon} from './workspace-ui';

type ReportView='report'|'security'|'lab';
const views=[
  {id:'report',label:'参数',icon:'archive'},
  {id:'security',label:'指纹安全',icon:'shield'},
  {id:'lab',label:'验收工作台',icon:'lab'},
] as const;

export function reportLabLink(id:string,options:Record<string,string>={},hash=location.hash){
  const scope=hashParams(reportWorkspaceLink('reports',reportScope(hash)));
  scope.set('report',id);
  for(const [key,value] of Object.entries(options))scope.set(key,value);
  return '#lab?'+scope;
}

export function ReportFlow({report,view,securityHref}:{report:Report;view:ReportView;securityHref?:string}){
  const scope=reportScope(location.hash);
  const origin=readerOrigin();
  const originHref=origin?.hash||reportWorkspaceLink('reports',scope);
  const originLabel=origin?.label??'返回报告列表';
  const links={
    report:reportWorkspaceLink('reports',scope,{report:report.id}),
    security:securityHref??reportWorkspaceLink('security',scope,{report:report.id}),
    lab:readerAncestor(hash=>hash.startsWith('#lab?')&&hashParams(hash).get('report')===report.id)??reportLabLink(report.id),
  };

  return <header className="report-flow" data-report-view={view}>
    <a className="report-return" href={originHref} onClick={followReaderParent}><Icon name="back"/>{originLabel}</a>
    <div className="report-flow-title">
      <div>
        <h1>{view==='report'?report.report.model:views.find(item=>item.id===view)?.label}</h1>
        {report.report.capturedAtEpochMs>0||view!=='report'?<p>
          {view!=='report'&&<strong>{report.report.model}</strong>}
          {report.report.capturedAtEpochMs>0&&<>{view!=='report'?' · ':''}采样 {date(report.report.capturedAtEpochMs)}</>}
        </p>:null}
      </div>
      {/* Version metadata is available in the report's capture details. */}
    </div>
    <nav className="report-flow-views" aria-label="当前报告功能">
      {views.map(item=><a key={item.id} href={view===item.id?location.hash:links[item.id]} onClick={followReaderParent}
        aria-current={view===item.id?'page':undefined}><Icon name={item.icon}/>{item.label}</a>)}
    </nav>
  </header>;
}
