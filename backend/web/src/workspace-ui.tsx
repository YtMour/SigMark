import {useEffect,useId,useRef,useState,type ReactNode} from 'react';

export const workspaces=[
  {id:'reports',label:'报告档案',icon:'archive',group:'collection'},
  {id:'assets',label:'资产管理',icon:'devices',group:'collection'},
  {id:'security',label:'指纹安全',icon:'shield',group:'collection'},
  {id:'builds',label:'构建中心',icon:'build',group:'tools'},
  {id:'downloads',label:'应用下载',icon:'download',group:'tools'},
  {id:'settings',label:'设置',icon:'settings',group:'tools'},
] as const;
export type Section=typeof workspaces[number]['id'];
type IconName=typeof workspaces[number]['icon']|'lock'|'menu'|'arrow';
const iconPaths:Record<IconName,string>={
  archive:'M4 4h16v4H4z M5 8v12h14V8 M9 12h6',
  devices:'M3 4h12v16H3z M6 7h6 M7 17h4 M17 8h4v12h-4',
  shield:'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4',
  build:'M8 8l-4 4 4 4 M16 8l4 4-4 4 M14 5l-4 14',
  download:'M12 3v12 M8 11l4 4 4-4 M4 16v4h16v-4',
  settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M15 9v6 M10 15v6',
  lock:'M5 10h14v11H5z M8 10V7a4 4 0 018 0v3 M12 14v3',
  menu:'M4 6h16 M4 12h16 M4 18h16',
  arrow:'M5 12h14 M13 6l6 6-6 6',
};
export function Icon({name}:{name:IconName}){
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]}/></svg>;
}

export function WorkspaceNav({section,active,busy,lock}:{section:Section;active:boolean;busy:boolean;lock:()=>void}){
  const [expanded,expand]=useState(false);
  const navigationId=useId();
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const close=()=>expand(false);
    window.addEventListener('hashchange',close);
    return ()=>window.removeEventListener('hashchange',close);
  },[]);
  return <header className="workspace-rail" onKeyDown={event=>{
    if(event.key==='Escape'&&expanded){event.preventDefault();expand(false);trigger.current?.focus();}
  }}>
    <a className="rail-brand" href="#reports"><img src="/sigmark-icon.png" alt="" width="36" height="36"/>
      <span><strong>SigMark <span>印迹</span></strong><small>设备报告工作台</small></span></a>
    <button ref={trigger} className="secondary rail-trigger" type="button" aria-expanded={expanded}
      aria-controls={navigationId} onClick={()=>expand(!expanded)}><Icon name="menu"/>工作区</button>
    <nav id={navigationId} aria-label="工作区导航" className="rail-nav" data-expanded={expanded}>
      {(['collection','tools'] as const).map(group=><div className="rail-group" key={group}>
        <p>{group==='collection'?'报告与设备':'发布与设置'}</p>
        <ul>{workspaces.filter(item=>item.group===group).map(item=><li key={item.id}>
          <a href={'#'+item.id} aria-current={section===item.id?'page':undefined} onClick={()=>expand(false)}>
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
    <div className="heading-mark"><Icon name={info.icon}/></div>
    <div className="heading-copy"><h1>{title??info.label}</h1><p>{description}</p></div>
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
