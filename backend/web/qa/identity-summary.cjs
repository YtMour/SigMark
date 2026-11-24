// Fixture-only browser QA for the identity workspace and the reader warning.
// Playwright intercepts every API call; nothing is written and no token is needed.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.SIGMARK_QA_URL;
if(!base)throw Error('Set SIGMARK_QA_URL to the console origin.');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const when='2026-11-24T07:00:00Z';
const at=Date.parse(when);
const identity={model:'23078PND5G',device:'corot',board:'mt6985',boardPlatform:'mt6985',bootHardware:'mtk',hardwareSku:'23078PND5G'};
const drifted={...identity,boardPlatform:'gs101',hardwareSku:'GR1YH'};
const summary={schemaVersion:1,ruleVersion:'sigmark-identity/1',generatedAtEpochMs:at,reports:3,assets:2,
  multiIdentityAssets:[{assetId:id(900),identities:[
    {...identity,reports:1,lastCapturedAtEpochMs:at,lastReportId:id(1)},
    {...drifted,reports:1,lastCapturedAtEpochMs:at-1000,lastReportId:id(2)}],reports:2,lastCapturedAtEpochMs:at}],
  sharedIdentities:[{...identity,assetCount:2,reports:2,lastCapturedAtEpochMs:at,lastReportId:id(3)}],
  conflictReports:1,
  conflictSamples:[{reportId:id(2),assetId:id(900),capturedAtEpochMs:at-1000,pairs:[
    {leftKey:'system.board',rightKey:'system.boardPlatform',left:'mt6985',right:'gs101'}]}],
  truncated:false};
const conflicting=Array.from({length:20},(_,i)=>({group:['system','cpu'][i%2],key:'field'+i,label:'字段 '+i,
  source:'QA',status:'AVAILABLE',value:String(i)}));
Object.assign(conflicting[0],{group:'system',key:'board',label:'主板代号',value:'mt6985'});
Object.assign(conflicting[1],{group:'system',key:'boardPlatform',label:'平台代号声明',value:'gs101'});
Object.assign(conflicting[2],{group:'system',key:'bootHardware',label:'启动硬件声明',value:'mtk'});
Object.assign(conflicting[3],{group:'cpu',key:'hardware',label:'硬件代号',value:'mtk'});
const consistent=conflicting.map(row=>row.key==='boardPlatform'?{...row,value:'mt6985'}:row);
const reportRow=(n,parameters)=>({id:id(n),batch:'qa-identity',receivedAt:when,assetId:id(900),report:{
  model:'23078PND5G',schemaVersion:4,androidApi:34,appVersion:'1.10.0',network:'wifi',fieldSetVersion:19,
  collectorVersion:'1.10.0',capturedAtEpochMs:at,assetId:id(900),parameters,coverage:[],metrics:[]}});
const rows={[id(1)]:reportRow(1,consistent),[id(2)]:reportRow(2,conflicting)};

async function run(){
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1003},serviceWorkers:'block'});
    page.setDefaultTimeout(10000);
    const issues=[];
    page.on('pageerror',e=>issues.push(e.message));
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(req.method()!=='GET'){issues.push('unexpected write '+url.pathname);return route.abort();}
      const last=url.pathname.split('/').filter(Boolean).pop();
      const send=json=>route.fulfill({status:200,json});
      if(url.pathname.endsWith('/session'))return send({ok:true});
      if(url.pathname.endsWith('/identity-summary'))return send(summary);
      if(url.pathname.endsWith('/report-count'))return send({total:2});
      if(last==='reports')return send({items:Object.values(rows),nextCursor:''});
      if(rows[last])return send(rows[last]);
      return send({items:[]});
    });
    const snap=async name=>{
      if(!process.env.SIGMARK_QA_OUTPUT)return;
      await fs.mkdir(process.env.SIGMARK_QA_OUTPUT,{recursive:true});
      await page.screenshot({path:path.join(process.env.SIGMARK_QA_OUTPUT,name+'.png')});
    };
    const screenOK=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

    await page.goto(new URL('/#identity',base).href);
    await page.getByRole('heading',{name:'身份分布',exact:true}).waitFor();
    await page.getByRole('region',{name:'身份分布概览'}).waitFor();
    const assets=page.getByRole('navigation',{name:'资产工作区'});
    assert.equal(await assets.getByRole('link',{name:'身份分布',exact:true}).getAttribute('aria-current'),'page');
    for (const label of ['在库报告','已归组设备','多身份资产','跨资产同身份','内部冲突报告'])
      assert.equal(await page.getByText(label,{exact:true}).count()>0,true,label);
    await page.getByRole('heading',{name:'多身份资产'}).waitFor();
    await page.getByText(/主板 mt6985 \/ gs101/).first().waitFor();
    await page.getByText(/gs101/).first().waitFor();
    await page.getByRole('heading',{name:'跨资产同身份'}).waitFor();
    await page.getByRole('heading',{name:'内部冲突报告'}).waitFor();
    await page.getByText('system.board').first().waitFor();
    await page.setViewportSize({width:390,height:1003});
    assert(await screenOK());
    await snap('identity-390');
    await page.getByRole('button',{name:/内部冲突报告.*查看冲突/}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='identity-conflicts');
    assert.equal(new URL(page.url()).hash,'#identity');
    assert.equal(await page.locator('.identity-table tbody tr').first().evaluate(el=>getComputedStyle(el).display),'grid');

    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出身份分布 JSON'}).click();
    const file=await pending;
    const exported=JSON.parse(await fs.readFile(await file.path(),'utf8'));
    assert.equal(exported.ruleVersion,'sigmark-identity/1');
    assert.equal(exported.multiIdentityAssets[0].identities.length,2);
    assert.equal(exported.conflictSamples[0].pairs[0].right,'gs101');
    await page.getByRole('link',{name:'打开报告',exact:true}).click();
    await page.getByRole('link',{name:'返回身份分布',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.id.startsWith('identity-conflict-'));

    await page.goto(new URL('/#reports?report='+id(2),base).href);
    await page.getByRole('heading',{name:'身份声明不一致'}).waitFor();
    await page.getByText(/system.board/).first().waitFor();
    await page.getByText(/mt6985/).first().waitFor();
    assert(await screenOK());
    await snap('reader-identity-390');

    await page.goto(new URL('/#reports?report='+id(1),base).href);
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('heading',{name:'身份声明不一致'}).count(),0,'consistent report must not warn');

    await page.setViewportSize({width:320,height:740});
    await page.goto(new URL('/#identity',base).href);
    await page.getByRole('heading',{name:'身份分布',exact:true}).waitFor();
    assert(await screenOK());
    await snap('identity-320');
    assert.deepEqual(issues,[]);
    console.log('PASS identity summary page, export, 320/390px and reader identity warning.');
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exit(1);});
