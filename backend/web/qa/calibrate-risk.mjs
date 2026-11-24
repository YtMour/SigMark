#!/usr/bin/env node
// Offline evaluator for a human-labelled manifest and exported workbench packets.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const cohorts=['stock_device','custom_rom_device','emulator'];
const expected=['alert','no_alert','unknown'];
const levels=['red','yellow','blue','gray'];
const policies=['standard','registered_experiment'];
const token=/^[A-Za-z0-9_-]{1,80}$/;

function summarize(rows){
  const counts={truePositive:0,falsePositive:0,trueNegative:0,falseNegative:0,insufficient:0,unlabelled:0};
  const cases=rows.map(row=>{
    const alert=row.level==='red'||row.level==='yellow';
    const comparison=row.expected==='unknown'?'unlabelled':row.level==='gray'?'insufficient':
      row.expected==='alert'?(alert?'truePositive':'falseNegative'):(alert?'falsePositive':'trueNegative');
    counts[comparison]++;
    return {reportId:row.report,level:row.level,expected:row.expected,comparison};
  });
  const ratio=(n,d)=>d?n/d:null;
  return {devices:rows.length,counts,coverage:ratio(rows.length-counts.unlabelled-counts.insufficient,rows.length-counts.unlabelled),
    falsePositiveRate:ratio(counts.falsePositive,counts.falsePositive+counts.trueNegative),
    falseNegativeRate:ratio(counts.falseNegative,counts.falseNegative+counts.truePositive),cases};
}

export async function scoreCalibration(manifest, readPacket){
  if(manifest?.schemaVersion!==1||!Array.isArray(manifest.cases)||manifest.cases.length<1||manifest.cases.length>1000)
    throw Error('Expected calibration manifest v1 with 1–1000 labelled cases.');
  const reportIDs=new Map(),assets=new Set(),group=new Map(),strata=new Map();
  for(const c of manifest.cases){
    if(typeof c?.deviceKey!=='string'||!token.test(c.deviceKey)||!cohorts.includes(c.cohort)||!expected.includes(c.expected)||
      typeof c.packet!=='string'||c.packet.length>250||typeof c.labelledAt!=='string'||!Number.isFinite(Date.parse(c.labelledAt)))
      throw Error('Each case needs a device pseudonym, cohort, expected decision, label time and packet filename.');
    const packet=await readPacket(c.packet);
    const current=packet?.source?.current,risk=packet?.risk,report=current?.reportId;
    if(packet?.kind!=='sigmark.verification-package'||packet.schemaVersion!==1||typeof report!=='string'||!token.test(report)||
      report!==risk?.reportId||!levels.includes(risk.level)||!policies.includes(risk.policy?.kind)||
      typeof risk.ruleVersion!=='string'||!/^sigmark-observation-risk\/\d+$/.test(risk.ruleVersion)||
      !Number.isSafeInteger(current.captureAt)||current.captureAt<946684800000)
      throw Error('Only complete workbench report/risk references are accepted.');
    const known=reportIDs.get(report);
    if(known)throw Error('Duplicate report in calibration manifest: '+report);
    reportIDs.set(report,true);assets.add(c.deviceKey);
    const key=[risk.ruleVersion,risk.policy.kind,c.cohort].join('/');
    const id=key+'/'+c.deviceKey;
    const row={report,captureAt:current.captureAt,expected:c.expected,level:risk.level};
    const old=group.get(id);
    if(old&&old.expected!==row.expected)throw Error('Conflicting human expectations for one device and stratum.');
    if(!old||row.captureAt>old.captureAt||row.captureAt===old.captureAt&&row.report>old.report)group.set(id,row);
    if(!strata.has(key))strata.set(key,{cohort:c.cohort,policy:risk.policy.kind,ruleVersion:risk.ruleVersion});
  }
  return {schemaVersion:1,kind:'sigmark.calibration',totalSamples:manifest.cases.length,uniqueDevices:assets.size,
    counting:'latest_same_device_per_cohort_policy_rule_version',
    limitations:['Cohort is human-labelled and is not a risk outcome.',
      'Device counts across strata may overlap. Gray is reported separately and is excluded from graded error denominators.',
      'Local analysis of exported observations; not proof of authenticity or independently verified labels.'],
    strata:[...strata.entries()].map(([key,header])=>({...header,
      ...summarize([...group.entries()].filter(([id])=>id.startsWith(key+'/')).map(([,row])=>row))}))};
}

async function main(){
  const [manifestName,output]=process.argv.slice(2);
  if(!manifestName||!output)throw Error('Usage: node calibrate-risk.mjs manifest.json output.json');
  const manifest=JSON.parse(await readFile(manifestName,'utf8'));
  const parent=dirname(resolve(manifestName));
  const result=await scoreCalibration(manifest,async name=>{
    const path=resolve(parent,name),rel=relative(parent,path);
    if(isAbsolute(name)||isAbsolute(rel)||rel.startsWith('..'))throw Error('Packet must be relative to the manifest folder.');
    return JSON.parse(await readFile(path,'utf8'));
  });
  await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
