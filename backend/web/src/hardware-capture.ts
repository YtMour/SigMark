import {parameterKey,type Parameter} from './compare.ts';

export const architectureFields=['cpu.processBitness','cpu.kernelMachine','system.interfaceCapabilities','runtime.externalInputTypes'];
export const hardwareFields=['system.gnssHardwareYear','system.gnssCapabilities','runtime.declaredInput',
  'sensors.reportingModes','sensors.fifoCount','sensors.directChannelTypes','media.cameraModes'];
export const graphicsFields=['runtime.glesProbeResult','runtime.glesProbeVersion','runtime.glesProbeStage'];
const keys=new Set([...architectureFields,...hardwareFields,...graphicsFields]);

export function captureHardware(fields:Parameter[]){
  const rows=fields.filter(p=>keys.has(parameterKey(p)));
  const counts=(names:string[])=>rows.filter(p=>names.includes(parameterKey(p))).length;
  const plan=fields.find(p=>parameterKey(p)==='environment.capturePlan'&&p.status==='AVAILABLE')?.value;
  return {rows,available:rows.filter(p=>p.status==='AVAILABLE').length,architecture:counts(architectureFields),
    hardware:counts(hardwareFields),graphics:counts(graphicsFields),plan};
}
