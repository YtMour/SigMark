import type {Parameter} from './compare';
import {caption,groups} from './reports.ts';

export const readStates=['AVAILABLE','RESTRICTED','UNAVAILABLE','ERROR'] as const;
export function briefReason(p:Parameter){
  if(p.status==='AVAILABLE')return '';
  if(p.reason)return caption(p.reason);
  if(p.note?.trim())return p.note.trim().split(/[。；\n]/u)[0] || p.note.trim();
  return '报告未附具体原因';
}
export function groupReadings(fields:Parameter[],query:string,status:string){
  const term=query.trim().toLowerCase(),counts=new Map<string,number>(),buckets=new Map<string,Parameter[]>();
  let matched=0,visible=0;
  for(const p of fields){
    if(term&&![p.label,p.group+'.'+p.key,groups[p.group],p.value,p.source,p.status,caption(p.status),
      p.reason,p.reason&&caption(p.reason),p.note,p.errno!=null&&'errno='+p.errno].some(
        v=>typeof v==='string'&&v.toLowerCase().includes(term)))continue;
    matched++;counts.set(p.status,(counts.get(p.status)??0)+1);
    if(status&&p.status!==status)continue;
    visible++;
    const bucket=buckets.get(p.group);
    if(bucket)bucket.push(p);else buckets.set(p.group,[p]);
  }
  // Keep the public category order, then show unknown future groups in archive order.
  const keys=new Set([...Object.keys(groups),...buckets.keys()]);
  return {counts,matched,visible,sections:[...keys].filter(key=>buckets.has(key))
    .map(key=>({key,label:groups[key]??key,rows:buckets.get(key)!}))};
}
