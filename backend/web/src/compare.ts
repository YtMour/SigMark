export type Parameter = {group:string;key:string;label:string;value:string|null;source:string;status:string;reason?:string;errno?:number;note?:string};
export const parameterKey = (p: Parameter) => p.group + '.' + p.key;
export function diffParameters(before: Parameter[], after: Parameter[]) {
  const a = new Map(before.map(p=>[parameterKey(p),p]));
  const b = new Map(after.map(p=>[parameterKey(p),p]));
  return [...new Set([...a.keys(),...b.keys()])].map(id=>{
    const left=a.get(id), right=b.get(id);
    const ref=right??left!;
    // Ignore descriptive copy (including sample age), not value or diagnostic provenance.
    const identity=(p:Parameter|undefined)=>p?[p.value,p.status,p.reason,p.errno,p.source]:null;
    return {id,group:ref.group,label:ref.label,before:left,after:right,presence:left&&right?'both':left?'baseline':'current',
      changed:JSON.stringify(identity(left))!==JSON.stringify(identity(right))};
  });
}
