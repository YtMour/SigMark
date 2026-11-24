import type { Parameter } from './compare';

export type Observation = {
  observer: 'ADB_SHELL' | 'ROOT';
  observedAtEpochMs: number;
  model: string;
  readings: Record<string, string | null>;
};
export const fields: readonly (readonly [string, string, string])[];
export const observationFields: typeof fields;
export const shellObservationFields: typeof fields;
export const identityObservationFields: typeof fields;
export const rootObservationFields: typeof fields;
export function followupFor(row:Parameter, archive:Map<string,Parameter>):string;
export const maxObservationBytes: number;
export function parseObservation(text: string): Observation;
export function compareObservation(key: string, app: Parameter | undefined, adb: string | null, comparableTime?:boolean): string;
