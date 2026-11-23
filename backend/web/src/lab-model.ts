import type {Parameter} from './compare';
import type {Report} from './reports';
import {acceptanceComparison} from './acceptance.ts';

export type LabSheet = {schemaVersion:1;current:Report;history:Report[];historyLimit:number;hasEarlier:boolean};
export type Delta = 'lost'|'restored'|'changed'|'unchanged'|'provenance'|'not_comparable';
const keyOf=(p:Parameter)=>p.group+'.'+p.key;
const dynamic=new Set(['system.uptime','memory.availableRam','memory.ramUseEstimate','memory.internalAvailable',
  'runtime.heapAllocated','runtime.heapFree','battery.level','battery.temperature','battery.voltage','battery.current',
  'battery.currentAverage','battery.chargeCounter','battery.energyCounter','media.avcElapsed']);
export function evidenceDelta(before:Parameter|undefined,after:Parameter|undefined):Delta {
  if(!before||!after) return 'not_comparable';
  const had=before.status==='AVAILABLE'&&before.value!=null;
  const has=after.status==='AVAILABLE'&&after.value!=null;
  if(had&&!has)return 'lost';
  if(!had&&has)return 'restored';
  if(had&&has&&before.value!==after.value)return 'changed';
  if(before.status!==after.status||before.source!==after.source||before.reason!==after.reason||before.errno!==after.errno)return 'provenance';
  return 'unchanged';
}
export function buildLab(sheet:LabSheet,baseline:Report|undefined) {
  const current=sheet.current;
  // Never compare against arbitrary report IDs supplied by URL or browser state.
  const reference=baseline&&sheet.history.find(row=>row.id===baseline.id);
  const collect=(row:Report|undefined)=>new Map((row?.report.parameters??[]).map(p=>[keyOf(p),p]));
  const a=collect(reference),b=collect(current);
  const rows=[...new Set([...b.keys(),...a.keys()])].map(key=>{
    const before=a.get(key),after=b.get(key),p=after??before!;
    return {key,group:p.group,label:p.label,before,after,delta:evidenceDelta(before,after),dynamic:dynamic.has(key)||
      ['network','cellular'].includes(p.group)};
  });
  const counts={lost:0,restored:0,changed:0,unchanged:0,provenance:0,not_comparable:0};
  if(reference) for(const row of rows) counts[row.delta]++;
  const blocked=rows.filter(row=>row.after?.status==='RESTRICTED');
  const lookup=(key:string)=>{const field=b.get(key);return field?.status==='AVAILABLE'?field.value:null;};
  const hasTransition=['checkStartTransport','checkEndTransport'].some(key=>b.has('network.'+key));
  const transition={before:lookup('network.checkStartTransport'),after:lookup('network.checkEndTransport'),
    beforeValidated:lookup('network.checkStartValidated'),afterValidated:lookup('network.checkEndValidated'),
    elapsed:lookup('network.checkElapsed')};
  return {schemaVersion:1,kind:'sigmark.lab-sheet',reportId:current.id,
    baselineId:reference?.id??null,counts,restricted:{permission:blocked.filter(row=>row.after?.reason==='PERMISSION_REQUIRED').length,
      location:blocked.filter(row=>row.after?.reason==='LOCATION_DISABLED').length,
      policy:blocked.filter(row=>row.after?.reason==='ACCESS_DENIED').length,
      other:blocked.filter(row=>!['PERMISSION_REQUIRED','LOCATION_DISABLED','ACCESS_DENIED'].includes(row.after?.reason??'')).length},
    acceptance:reference?acceptanceComparison(reference,current,true):null,hasTransition,transition,rows};
}

export function suggestedBaseline(sheet:LabSheet){
  const fields=sheet.current.report.parameters??[];
  const fixture=fields.find(p=>keyOf(p)==='media.avcFixture'&&p.status==='AVAILABLE')?.value;
  if(fixture){
    const prior=sheet.history.find(row=>(row.report.parameters??[]).some(p=>keyOf(p)==='media.avcFixture'&&p.status==='AVAILABLE'&&p.value===fixture));
    if(prior)return prior;
  }
  return sheet.history[0];
}
