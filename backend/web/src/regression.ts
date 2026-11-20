import type {Report} from './reports';
import type {Baseline} from './baselines';
import type {compareSecurity} from './security-rules';

type Change = ReturnType<typeof compareSecurity>[number];
export function regressionResult(reference:Report,current:Report,changes:Change[],options:{
  sameAsset:boolean;expectUnlock:boolean;baseline?:Pick<Baseline,'id'|'name'>;
}){
  const describe=(row:Report)=>({reportId:row.id,model:row.report.model,batch:row.batch,
    capturedAtEpochMs:row.report.capturedAtEpochMs,collectorVersion:row.report.collectorVersion??null,
    fieldSetVersion:row.report.fieldSetVersion??null});
  const source=(row:Change['baseline'])=>row?{value:row.value,status:row.status,source:row.source,
    reason:row.reason??null,errno:row.errno??null}:null;
  const fields=(row:Report)=>new Map((row.report.parameters??[]).map(p=>[p.group+'.'+p.key,p]));
  const before=fields(reference),after=fields(current);
  const all=new Set([...before.keys(),...after.keys()]);
  const counts={bothArchived:0,baselineOnly:0,currentOnly:0,lostValue:0,gainedValue:0};
  for(const key of all){
    const left=before.get(key),right=after.get(key);
    if(left&&right){
      counts.bothArchived++;
      if(left.status==='AVAILABLE'&&right.status!=='AVAILABLE')counts.lostValue++;
      if(left.status!=='AVAILABLE'&&right.status==='AVAILABLE')counts.gainedValue++;
    }else if(left)counts.baselineOnly++;
    else counts.currentOnly++;
  }
  const verdicts={review:0,expected:0,insufficient:0,changed:0,unchanged:0};
  for(const item of changes)verdicts[item.verdict]++;
  return {schemaVersion:1,kind:'sigmark.regression',baseline:describe(reference),current:describe(current),
    savedBaseline:options.baseline??null,
    context:{sameAsset:options.sameAsset,expectUnlock:options.sameAsset&&options.expectUnlock,
      baselineEarlier:reference.report.capturedAtEpochMs<current.report.capturedAtEpochMs,
      differentFieldSets:(reference.report.fieldSetVersion??null)!==(current.report.fieldSetVersion??null),attestation:'not_verified'},
    counts,verdicts,checks:changes.map(item=>({key:item.key,verdict:item.verdict,explanation:item.note,
      baseline:source(item.baseline),current:source(item.current)}))};
}
