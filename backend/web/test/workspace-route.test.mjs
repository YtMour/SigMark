import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assetTab,emptyReportFilters,hashParams,relationToAsset,reportScope,reportWorkspaceLink} from '../src/workspace-route.ts';

test('scope carryover is explicit and does not include route state',()=>{
  const scope=reportScope('#assets?brand=Xiaomi&q=测试+机&view=trash&tab=coverage&fieldSet=6&report=stale');
  assert.deepEqual(scope,{...emptyReportFilters,brand:'Xiaomi',q:'测试 机'});
  const coverage=hashParams(reportWorkspaceLink('stats',scope));
  assert.equal(coverage.get('q'),'测试 机');
  assert.equal(coverage.get('tab'),'coverage');
  for(const key of ['view','report','fieldSet'])assert(!coverage.has(key));
  assert.equal(reportWorkspaceLink('assets'),'#assets');
});

test('retest links carry current report without selecting a baseline',()=>{
  const link=hashParams(reportWorkspaceLink('security',{...emptyReportFilters,batch:'qa'},{report:'current',retest:true}));
  assert.equal(link.get('report'),'current');
  assert.equal(link.get('mode'),'retest');
  assert.equal(link.get('batch'),'qa');
  assert(!link.has('baseline'));
});

test('different and missing device relations remain distinct',()=>{
  assert.equal(relationToAsset('a','a'),'same');
  assert.equal(relationToAsset('a','b'),'different');
  assert.equal(relationToAsset('a',null),'unconfirmed');
  assert.equal(relationToAsset(undefined,undefined),'unconfirmed');
});

test('asset tab deep links are stable and do not pollute report scope',()=>{
  const scope={...emptyReportFilters,brand:'Xiaomi'};
  assert.equal(assetTab('#assets'),'devices');
  for(const hash of ['#assets?tab=reports','#assets?view=archive','#assets?batch=old','#assets?q=asset%3Aunassigned',reportWorkspaceLink('assets',undefined,{view:'archive'})])assert.equal(assetTab(hash),'reports',hash);
  assert.equal(assetTab(reportWorkspaceLink('assets',scope,{view:'trash'})),'trash');
  assert.equal(assetTab(reportWorkspaceLink('stats',scope)),'coverage');
  assert.equal(assetTab(reportWorkspaceLink('assets',undefined,{devices:true})),'devices');
  assert.equal(assetTab('#stats'),'devices');
  assert.equal(assetTab('#identity'),'identity');
  assert.equal(assetTab('#assets?tab=identity'),'identity');
  assert.deepEqual(reportScope(reportWorkspaceLink('assets',scope,{devices:true})),scope);
  const sample=reportWorkspaceLink('assets',undefined,{devices:true,sampleAsset:'device-1'});
  assert.equal(assetTab(sample),'devices');
  assert.equal(hashParams(sample).get('sampleAsset'),'device-1');
  assert.deepEqual(reportScope(sample),emptyReportFilters);
});
