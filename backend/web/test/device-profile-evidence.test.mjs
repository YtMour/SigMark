import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

// The panel renders whatever evidence rows the backend returns, so the ten-row shape is a
// wire contract shared by three artifacts: the Go evidence list, the browser fixture and the
// card that draws them. Keep them in step without duplicating the list a fourth time.
const go=readFileSync(new URL('../../cmd/sigmark/hardware_facts.go',import.meta.url),'utf8');
const qa=readFileSync(new URL('../qa/device-profile.cjs',import.meta.url),'utf8');
const panel=readFileSync(new URL('../src/device-profile.tsx',import.meta.url),'utf8');

const goKeys=[.../var hardwareKeys = \[\]string\{([^}]*)\}/.exec(go)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const fixtureStart=qa.indexOf("code:'hardware_declaration_conflict'");
const fixtureKeys=[...qa.slice(fixtureStart,qa.indexOf('historyHits',fixtureStart)).matchAll(/key:'([^']+)'/g)].map(m=>m[1]);

test('hardware evidence has ten rows, kernel channels last, and the browser fixture mirrors them',()=>{
  assert.equal(goKeys.length,10);
  assert.deepEqual(goKeys.slice(-2),['cpu.cpuCapacity','memory.cmaTotal']);
  assert(fixtureStart>0,'browser fixture has no hardware_declaration_conflict label');
  assert.deepEqual(fixtureKeys,goKeys);
});

test('the profile card draws every evidence row it receives instead of a fixed list',()=>{
  assert(panel.includes("hardware_declaration_conflict:['实测硬件与声明核对'"));
  assert(panel.includes("hardware_declaration_conflict:'先核对"));
  // One row per element, keyed by the archived field key: no index access, no fixed count.
  assert(/l\.evidence\.map\(e=>/.test(panel));
  assert(!/evidence\[\d+\]/.test(panel));
  assert(!/evidence\.length\s*===?\s*\d/.test(panel));
});
