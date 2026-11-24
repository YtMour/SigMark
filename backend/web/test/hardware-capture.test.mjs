import assert from 'node:assert/strict';
import {test} from 'node:test';
import {architectureFields,captureHardware,graphicsFields,hardwareFields} from '../src/hardware-capture.ts';
const f=(id,status='AVAILABLE',value='some')=>{
  const [group,key]=id.split('.');
  return {group,key,status,value};
};
test('version highlights use group and key and keep unsupported records separate from values',()=>{
  const earlier=architectureFields.map(id=>f(id));
  assert.equal(captureHardware(earlier).architecture,4);
  assert.equal(captureHardware(earlier).hardware,0);
  const statusOnly=f(hardwareFields[0],'UNAVAILABLE',null);
  const standard=captureHardware([...earlier,statusOnly,...hardwareFields.slice(1).map(id=>f(id)),f('app.gnssHardwareYear')]);
  assert.equal(standard.hardware,7);
  assert.equal(standard.graphics,0);
  assert.equal(standard.rows.length,11);
  assert.equal(standard.available,10);
  assert.equal(captureHardware([...standard.rows,...graphicsFields.map(id=>f(id)),f('environment.capturePlan','AVAILABLE','rom')]).plan,'rom');
});
