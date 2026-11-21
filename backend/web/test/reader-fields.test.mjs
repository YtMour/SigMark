import {test} from 'node:test';
import assert from 'node:assert/strict';
import {briefReason,groupReadings} from '../src/reader-fields.ts';

const rows=[
  {group:'network',key:'wifi',label:'频率',value:'2462 MHz',source:'WifiInfo',status:'AVAILABLE'},
  {group:'system',key:'selinux',label:'SELinux',value:null,source:'/sys/fs/selinux/enforce',status:'RESTRICTED',errno:13,reason:'ACCESS_DENIED'},
  {group:'future',key:'opt',label:'可选',value:null,source:'future',status:'UNAVAILABLE',note:'厂商未设置。附加信息。'}
];
test('reader keeps all archived rows and future groups, without inventing missing rows',()=>{
  const view=groupReadings(rows,'','');
  assert.deepEqual(view.sections.map(g=>g.key),['system','network','future']);
  assert.equal(view.visible,3);assert.equal(view.matched,3);
  assert.equal(view.sections[0].rows[0].value,null);
});
test('reader finds hidden evidence, full field IDs, captions and group names',()=>{
  for(const query of ['errno=13','SYSTEM.SELINUX','权限不存在','系统拒绝访问','/sys/fs/selinux',' 受限 ']){
    const view=groupReadings(rows,query,'');
    assert.equal(view.visible,query==='权限不存在'?0:1);
  }
  assert.equal(groupReadings(rows,'Wi-Fi 与网络','').visible,1);
  assert.equal(groupReadings(rows,'MHz','AVAILABLE').visible,1);
});
test('status intersects with search; counts remain the counts for that query',()=>{
  const view=groupReadings(rows,'wifi','RESTRICTED');
  assert.equal(view.visible,0);assert.equal(view.matched,1);assert.equal(view.counts.get('AVAILABLE'),1);
  assert.equal(view.sections.length,0);
});
test('inline reasons distinguish a denied read, an optional value and a missing explanation',()=>{
  assert.equal(briefReason(rows[0]),'');assert.equal(briefReason(rows[1]),'系统拒绝访问');
  assert.equal(briefReason(rows[2]),'厂商未设置');assert.equal(briefReason({...rows[2],note:''}),'报告未附具体原因');
});
