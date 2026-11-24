import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {Archive, ArrowRight, Download, Fingerprint, FlaskConical, LockKeyhole, Menu, Settings2, ShieldCheck, Smartphone, SquareTerminal} from 'lucide-react';

export const workspaces=[
  {id:'reports',label:'报告档案',icon:'archive',group:'collection'},
  {id:'assets',label:'资产管理',icon:'devices',group:'collection'},
  {id:'identity',label:'身份分布',icon:'identity',group:'analysis'},
  {id:'security',label:'指纹安全',icon:'shield',group:'analysis'},
  {id:'lab',label:'验收工作台',icon:'lab',group:'analysis'},
  {id:'builds',label:'构建中心',icon:'build',group:'tools'},
  {id:'downloads',label:'应用下载',icon:'download',group:'tools'},
  {id:'settings',label:'设置',icon:'settings',group:'tools'},
] as const;
export type Section=typeof workspaces[number]['id'];
const navigationGroups={
  collection:'设备仓库',
  tools:'发布与设置',
} as const;
const pageContext:Record<Section,string>={
  reports:'设备采样',assets:'仓库管理',identity:'仓库管理',security:'报告分析',lab:'报告分析',
  builds:'版本发布',downloads:'版本发布',settings:'工作区管理',
};
type IconName=typeof workspaces[number]['icon']|'lock'|'menu'|'arrow';
const icons={archive:Archive,devices:Smartphone,shield:ShieldCheck,identity:Fingerprint,lab:FlaskConical,
  build:SquareTerminal,download:Download,settings:Settings2,lock:LockKeyhole,menu:Menu,arrow:ArrowRight};
export function Icon({name}:{name:IconName}){
  const Glyph=icons[name];
  return <Glyph aria-hidden="true" size={19} strokeWidth={1.8}/>;
}

export function WorkspaceNav({section,active,busy,lock}:{section:Section;active:boolean;busy:boolean;lock:()=>void}){
  const primary=section==='identity'?'assets':section==='security'||section==='lab'?'reports':section;
  const [expanded,expand]=useState(false);
  const navigationId=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const close=()=>expand(false);
    window.addEventListener('hashchange',close);
    return ()=>window.removeEventListener('hashchange',close);
  },[]);
  return <header className="workspace-rail" data-console-design="2026-11" onKeyDown={event=>{
    if(event.key==='Escape'&&expanded){event.preventDefault();expand(false);trigger.current?.focus();}
  }}>
    <a className="rail-brand" href="#reports"><img src="/sigmark-icon.png" alt="" width="36" height="36"/>
      <span><strong>SigMark <span>印迹</span></strong>
        <small className="rail-caption">设备报告工作台</small></span></a>
    <button ref={trigger} className="secondary rail-trigger" type="button" aria-expanded={expanded}
      aria-controls={navigationId} onClick={()=>expand(!expanded)}>
      <Icon name="menu"/><span>工作区</span>
    </button>
    <nav id={navigationId} aria-label="工作区导航" className="rail-nav" data-expanded={expanded}>
      {(Object.keys(navigationGroups) as (keyof typeof navigationGroups)[]).map(group=><div className="rail-group" key={group}>
        <p>{navigationGroups[group]}</p>
        <ul>{workspaces.filter(item=>item.group===group).map(item=><li key={item.id}>
          <a href={'#'+item.id} aria-current={primary===item.id?'page':undefined} onClick={()=>expand(false)}>
            <Icon name={item.icon}/><span>{item.label}</span>
          </a>
        </li>)}</ul>
      </div>)}
      <div className="rail-session"><span className="lan"><i/>局域网</span>
        {active&&<button type="button" className="secondary" onClick={lock} disabled={busy}><Icon name="lock"/>{busy?'正在锁定…':'锁定'}</button>}</div>
    </nav>
  </header>;
}

export function PageHead({section,title,description,children,className=''}:{
  section:Section;title?:string;description:string;children?:ReactNode;className?:string;
}){
  const info=workspaces.find(item=>item.id===section)!;
  return <header className={'workspace-heading '+className}>
    <div className="heading-copy min-w-0">
      <span className="heading-context"><Icon name={info.icon}/>{pageContext[section]}</span>
      <h1>{title??info.label}</h1><p>{description}</p>
    </div>
    {children&&<div className="heading-actions">{children}</div>}
  </header>;
}

export function WorkspaceTabs({label,items}:{label:string;items:{label:string;href:string;active:boolean}[]}){
  return <nav className="workspace-tabs" aria-label={label}>
    {items.map(item=><a key={item.label} href={item.href} aria-current={item.active?'page':undefined}>{item.label}</a>)}
  </nav>;
}

export function EmptyState({title,children,loading=false}:{title:string;children?:ReactNode;loading?:boolean}){
  return <div className="workspace-empty" role={loading?'status':undefined}><strong>{title}</strong>{children&&<div>{children}</div>}</div>;
}

type Metric = {label:string;value:number|undefined;hint?:string} &
  ({href:string;onSelect?:never}|{href?:never;onSelect:()=>void}|{href?:never;onSelect?:never});

export function MetricCards({label,items}:{label:string;items:Metric[]}){
  return <ul className="metric-grid" aria-label={label}>
    {items.map(({label,value,hint,href,onSelect})=>{
      const content=<>
        <span className="metric-label">{label}</span>
        <strong>{value?.toLocaleString('zh-CN')??'—'}</strong>
        {hint&&<span className="metric-hint">{hint}{(href||onSelect)&&<span aria-hidden="true"> {href?'→':'↓'}</span>}</span>}
      </>;
      return <li key={label}>
        {href?<a className="metric-card" href={href}>{content}</a>:
          onSelect?<button className="metric-card" type="button" onClick={onSelect}>{content}</button>:
          <div className="metric-card">{content}</div>}
      </li>;
    })}
  </ul>;
}
