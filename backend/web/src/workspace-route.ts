export const scopeKeys=['q','batch','android','api','brand','model','device'] as const;
export type ReportFilters=Record<typeof scopeKeys[number],string>;
type Workspace='reports'|'assets'|'stats'|'security';

export const emptyReportFilters:ReportFilters={q:'',batch:'',android:'',api:'',brand:'',model:'',device:''};

export function hashParams(hash:string){
  const split=hash.indexOf('?');
  return new URLSearchParams(split===-1?'':hash.slice(split+1));
}

export function reportScope(hash:string):ReportFilters {
  const params=hashParams(hash);
  return Object.fromEntries(scopeKeys.map(key=>[key,params.get(key)??''])) as ReportFilters;
}

export type AssetTab='reports'|'devices'|'coverage'|'identity'|'trash';
export function assetTab(hash:string):AssetTab {
  const params=hashParams(hash);
  if(params.get('tab')==='identity'||hash.split('?')[0]==='#identity')return 'identity';
  if(params.get('tab')==='coverage')return 'coverage';
  if(params.get('tab')==='devices'||hash.split('?')[0]==='#stats')return 'devices';
  if(params.get('view')==='trash')return 'trash';
  // Old saved searches are report views; the bare entry is device-first.
  if(params.get('tab')==='reports'||params.get('view')==='archive'||scopeKeys.some(k=>params.has(k)))return 'reports';
  return 'devices';
}

export function reportWorkspaceLink(section:Workspace,filters:ReportFilters=emptyReportFilters,options:{
  report?:string;baseline?:string;saved?:string;expectUnlock?:boolean;retest?:boolean;fieldSet?:string;view?:'archive'|'trash';devices?:boolean;sampleAsset?:string;
}={}):string {
  const params=new URLSearchParams();
  for(const key of scopeKeys){if(filters[key])params.set(key,filters[key]);}
  if(section==='stats'){
    params.set('tab','coverage');
    if(options.fieldSet)params.set('fieldSet',options.fieldSet);
  }
  if(section==='reports'||section==='security'){
    for(const key of ['report','baseline'] as const){if(options[key])params.set(key,options[key]);}
  }
  if(section==='security'){
    if(options.saved)params.set('saved',options.saved);
    if(options.baseline&&options.expectUnlock!==undefined)params.set('expectUnlock',options.expectUnlock?'1':'0');
    if(options.retest)params.set('mode','retest');
  }
  if(section==='assets'&&options.view==='archive')params.set('tab','reports');
  if(section==='assets'&&options.view==='trash')params.set('view','trash');
  if(section==='assets'&&options.devices){
    params.set('tab','devices');
    if(options.sampleAsset)params.set('sampleAsset',options.sampleAsset);
  }
  return '#'+(section==='stats'?'assets':section)+(params.size?'?'+params:'');
}

export function relationToAsset(asset:string|undefined|null,other:string|undefined|null){
  if(!asset||!other)return 'unconfirmed';
  return asset===other?'same':'different';
}
