import type { Parameter } from './compare';

export type Observation = {
  observer: 'ADB_SHELL' | 'ROOT';
  observedAtEpochMs: number;
  model: string | null;
  readings: Record<string, string | null>;
};
export const fields: readonly (readonly [string, string, string])[];
export const observationFields: typeof fields;
export const shellObservationFields: typeof fields;
export const identityObservationFields: typeof fields;
export const extendedObservationFields: typeof fields;
export const rootObservationFields: typeof fields;
export function followupFor(row:Parameter, archive:Map<string,Parameter>):string;
export const maxObservationBytes: number;
export function parseObservation(text: string): Observation;
export type AppIdentitySample = {capturedAtEpochMs:number;model:string;collectorVersion:string;parameters:Parameter[]};
export function parseAppIdentity(text:string):AppIdentitySample;
export const appIdentityKeys:ReadonlySet<string>;
export type ObservationIdentity = {
  state: 'not_loaded' | 'unpaired' | 'stale' | 'insufficient' | 'matching' | 'different';
  compared: number;
  different: number;
  total: number;
};
export function summarizeObservationIdentity(appModel:string, archive:Map<string,Parameter>, observation:Observation|undefined,
  confirmed:boolean, comparableTime:boolean):ObservationIdentity;
export function compareObservation(key: string, app: Parameter | undefined, adb: string | null, comparableTime?:boolean, selinuxBasis?:string|null): string;
