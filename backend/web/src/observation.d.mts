import type { Parameter } from './compare';

export type Observation = {
  observedAtEpochMs: number;
  model: string;
  readings: Record<string, string | null>;
};
export const fields: readonly (readonly [string, string, string])[];
export const maxObservationBytes: number;
export function parseObservation(text: string): Observation;
export function compareObservation(key: string, app: Parameter | undefined, adb: string | null): string;
