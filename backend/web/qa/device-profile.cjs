// Synthetic browser regressions, or read-only verification of one archived report via --archive UUID.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const origin=new URL(process.env.SIGMARK_QA_URL).origin;
const archive=process.argv[2]==='--archive';
const id=archive?process.argv[3]:'11111111-1111-4111-8111-111111111111',historical='22222222-2222-4222-8222-222222222222';
const path='/api/admin/reports/'+id+'/device-profile';
const labels=[
  {code:'virtual_build_markers',state:'insufficient',evidence:[{key:'system.product',status:'NOT_ARCHIVED'}],historyHits:0,historyEvaluable:0},
  {code:'selinux_permissive',state:'insufficient',evidence:[{key:'system.selinux',status:'RESTRICTED',source:'/sys/fs/selinux/enforce',errno:13}],historyHits:0,historyEvaluable:0},
  {code:'debugger_attached',state:'not_observed',evidence:[{key:'app.debuggerConnected',value:'否',source:'Debug.isDebuggerConnected',status:'AVAILABLE'}],historyHits:1,historyEvaluable:2,lastHistoricalHit:{id:historical,capturedAtEpochMs:3000}},
];
const fixture={reportId:id,ruleVersion:'sigmark-profile/1',linked:true,capturedAtEpochMs:5000,historyDays:30,historyLimit:50,historySamples:3,historyLimited:false,labels};
const states={hit:'本次观察到',not_observed:'本次未见',insufficient:'本次证据不足'};
async function main(){
  if(archive&&(!process.env.SIGMARK_QA_TOKEN||!id))throw Error('Set QA URL/token and provide an archived report UUID');
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failOnce=true,profile=fixture;
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.origin!==origin||req.method()!=='GET')return route.abort();
      if(!u.pathname.startsWith('/api/'))return route.continue();
      if(archive){
        const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+process.env.SIGMARK_QA_TOKEN},maxRedirects:0});
        return response.status()>=300&&response.status()<400?route.abort():route.fulfill({response});
      }
      if(u.pathname===path){
        if(failOnce){failOnce=false;return route.fulfill({status:503,json:{error:'storage_unavailable'}});}
        return route.fulfill({json:profile});
      }
      if([id,historical].some(r=>u.pathname==='/api/admin/reports/'+r)){
        const rid=u.pathname.split('/').at(-1);
        return route.fulfill({json:{id:rid,batch:'qa-profile',receivedAt:'2026-01-01T12:00:00Z',report:{schemaVersion:4,fieldSetVersion:7,appVersion:'0.19.0',model:'Fixture',androidApi:29,parameters:[],metrics:[],capturedAtEpochMs:rid===id?5000:3000}}});
      }
      return route.fulfill({json:{ok:true,items:[]}});
    });
    const panel=page.getByRole('region',{name:'设备风险画像'});
    const ready=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.ok());
    await page.goto(origin+'/#security?report='+id);
    if(!archive){await panel.getByRole('alert').waitFor();await panel.getByRole('button',{name:'重试读取画像'}).click();}
    const actual=await (await ready).json();
    assert.equal(actual.reportId,id);assert.equal(actual.labels.length,3);
    for(const l of actual.labels){
      const d=panel.locator('[data-profile="'+l.code+'"]');
      await d.locator('summary').getByText(states[l.state],{exact:true}).waitFor();
      await d.locator('summary').focus();await page.keyboard.press('Enter');
      assert.equal(await d.getAttribute('open'),'');
      for(const e of l.evidence){await d.getByText(e.key,{exact:true}).waitFor();}
    }
    assert.equal(await panel.locator('details[open]').count(),3);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
    if(process.env.SIGMARK_QA_ADB_FILE){
      const comparison=page.getByRole('region',{name:'证据来源对照'});
      const input=comparison.getByLabel('打开 ADB 观察 JSON');
      let mutationRequests=0;
      page.on('request',req=>{if(req.method()!=='GET')mutationRequests++;});
      await input.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')});
      await comparison.getByRole('alert').getByText('文件内容不是有效的 JSON。').waitFor();
      await input.setInputFiles(process.env.SIGMARK_QA_ADB_FILE);
      const selinux=comparison.getByRole('row').filter({hasText:'SELinux 实时模式'});
      await selinux.getByRole('cell',{name:/^Enforcing/}).waitFor();
      await selinux.getByRole('cell').getByText(/受限 · errno=13/).waitFor();
      await selinux.getByRole('cell',{name:'缺少一方读数'}).waitFor();
      const scroller=comparison.getByRole('region',{name:/可横向滚动/});
      await scroller.focus();await page.keyboard.press('ArrowRight');
      await page.waitForFunction(()=>document.querySelector('.observation-scroll').scrollLeft>0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'observation overflow');
      await comparison.getByRole('button',{name:'移除观察文件'}).click();
      assert.equal(await comparison.getByRole('table').count(),0);
      assert.equal(mutationRequests,0);
      console.log('PASS observation: actual ADB file, restricted App field, validation, keyboard overflow, removal, GET-only.');
    }
    if(!archive){
      await panel.getByText('系统限制读取（errno=13）',{exact:false}).waitFor();
      await panel.getByText('这份报告未保存该字段').waitFor();
      await panel.getByText('历史观察到 1 / 2 份可判断报告').waitFor();
      await panel.getByText('另有 1 份证据不足，未计入分母。').waitFor();
      const download=page.waitForEvent('download');await panel.getByRole('button',{name:'导出画像 JSON'}).click();
      const file=await download;assert.equal(file.suggestedFilename(),'SigMark-profile-'+id+'.json');
      assert.deepEqual(JSON.parse(await readFile(await file.path(),'utf8')),fixture);
      const detail=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/reports/'+historical&&r.ok());
      await panel.getByRole('link',{name:'查看当时的报告'}).click();await detail;
      assert.equal(new URL(page.url()).hash,'#reports?report='+historical);
      await page.goBack();await panel.getByText('历史观察到 1 / 2 份可判断报告').waitFor();
      profile={...fixture,linked:false,historySamples:0,labels:labels.map(l=>({...l,historyHits:0,historyEvaluable:0,lastHistoricalHit:undefined}))};
      await page.reload();await panel.getByText(/仅分析本次/).waitFor();
      assert.equal(await panel.getByText('未作历史关联').count(),3);
    }
    assert.deepEqual(errors,[]);
    console.log(archive?'PASS archive (GET only): '+actual.labels.length+' labels match API, '+actual.historySamples+' prior sample(s), linked='+actual.linked+', keyboard disclosure and 390px layout.':'PASS browser: retry, 390px, keyboard, evidence, denominator, JSON contents, history link/back, unassigned.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
