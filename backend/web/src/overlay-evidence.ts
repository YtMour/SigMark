import type {Parameter} from './compare.ts';

// Field set 25 archives overlay evidence as one string: `channel:payload` chunks joined by
// " / ". Only the channel names are read here; every payload is shown exactly as archived.
export const overlayEvidenceKey='environment.overlayEvidence';
export const overlayCodenameKey='environment.overlayDeviceCodename';

export function overlayChannels(raw:string|null|undefined):string[]{
  if(!raw)return [];
  return raw.split(' / ').map(part=>{
    const chunk=part.trim(),cut=chunk.indexOf(':');
    return cut>0?chunk.slice(0,cut).trim():chunk;
  }).filter(Boolean);
}

export function overlayHasConflict(raw:string|null|undefined):boolean{
  return overlayChannels(raw).includes('conflict');
}

export type OverlayNote={text:string;conflict:string};

const notes:Record<string,string>={
  // Taken from directory and file names inside the image, so it bypasses property reads.
  [overlayCodenameKey]:'取自镜像内 overlay 目录与文件名，不经过系统属性读取；改写 ro.* 属性一般动不了它。',
  [overlayEvidenceKey]:'多路径 overlay 证据串：channel:payload 用「 / 」连接。sku: 只是旁证——ro.boot.hardware.sku 也可能被按进程改写，改写后同一串会退化成逗号并列的多个值。单位栏的 overlay_evidence 是格式标记，不是计量单位。',
};

// A conflict channel means the image's own paths disagree, which is stronger than one
// codename. It is still a reason to re-check the sample, not a verdict about the device.
const conflictNote='镜像内多条路径给出的代号不一致（conflict:），比单个代号更强的信号；先核对 overlay 目录来源与采样条件，不据此判定设备真伪。';

export function overlayNote(key:string,value:string|null|undefined):OverlayNote|undefined{
  const text=notes[key];
  if(!text)return undefined;
  const conflict=key===overlayEvidenceKey&&overlayHasConflict(value)?conflictNote:'';
  return {text,conflict};
}

export const overlayNoteFor=(field:Parameter)=>overlayNote(field.group+'.'+field.key,field.value);
