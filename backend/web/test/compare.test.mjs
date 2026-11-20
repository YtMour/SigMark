import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diffParameters} from '../src/compare.ts';

const param = {group:'system',key:'mode',label:'Mode',value:null,status:'RESTRICTED',source:'/sys/example',errno:13};
test('ignores localized labels and transient notes',()=>{
  assert.equal(diffParameters([param],[{...param,label:'New label',note:'age 1 s'}])[0].changed,false);
});
test('flags changes to value, status, reason, errno and source',()=>{
  for(const change of [{value:'a'},{status:'ERROR'},{source:'new'},{errno:2},{reason:'NODE_MISSING'}]){
    assert.equal(diffParameters([param],[{...param,...change}])[0].changed,true);
  }
});
test('does not equate an uncollected field with a restricted one',()=>{
  const [added] = diffParameters([],[param]);
  assert.equal(added.before,undefined);
  assert.equal(added.changed,true);
});
