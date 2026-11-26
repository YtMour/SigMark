const {chromium}=require('playwright'),assert=require('node:assert/strict'),{readFile}=require('node:fs/promises');
const origin=new URL(process.env.SIGMARK_QA_URL).origin;
const archive=process.argv[2], id=archive||'11111111-1111-4111-8111-111111111111';
const expectedExternalDiffs=process.argv[3];
const prior='22222222-2222-4222-8222-222222222222',saved='33333333-3333-4333-8333-333333333333';
const at=Date.parse('2026-11-23T10:00:00Z');
const e=(group,key,value)=>({group,key,label:key,status:'AVAILABLE',source:'fixture',value});
const externalReview={reportId:id,capturedAtEpochMs:at,observedAtEpochMs:at+2000,compared:6,different:6,
  pairs:['model','device','initialSdk','boardPlatform','bootHardware','hardwareSku'].map(key=>({
    key:'system.'+key,app:'App fixture '+key,shell:'external fixture '+key,state:'different',
  }))};
async function main(){
  if(archive)assert(process.env.SIGMARK_QA_TOKEN);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
    page.setDefaultTimeout(10000);
    page.on('pageerror',v=>errors.push(v.message));
    let boot='green',locked='1',restricted=false,architecture=false,identityMismatch=false;
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.origin!==origin||req.method()!=='GET')return route.abort();
      if(!u.pathname.startsWith('/api/'))return route.continue();
      if(archive){
        const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+process.env.SIGMARK_QA_TOKEN},maxRedirects:0});
        return response.status()>=300&&response.status()<400?route.abort():route.fulfill({response});
      }
      const fields=[e('environment','verifiedBoot',boot),e('environment','flashLock',locked),
        restricted?{...e('system','selinux',null),status:'RESTRICTED',reason:'ACCESS_DENIED',errno:13}:e('system','selinux','Enforcing（强制模式）'),
        e('environment','keyguardSecure','是'),e('environment','storageEncryption','已启用'),e('system','patch','2026-11-01'),
        e('system','model','fixture'),e('system','board','board'),e('system','boardPlatform','platform'),
        ...(identityMismatch?[e('system','propertyModel','another model')]:[]),
        ...(architecture?[e('cpu','processBitness','64'),e('cpu','kernelMachine','i686'),e('cpu','abis','x86_64')]:[])];
      let data={ok:true};
      if([id,prior].some(rid=>u.pathname.endsWith('/reports/'+rid))){
        const rid=u.pathname.split('/').at(-1);
        data={id:rid,assetId:'asset',batch:'synthetic',receivedAt:new Date(at).toISOString(),identityReview:externalReview,report:{
          schemaVersion:4,fieldSetVersion:10,appVersion:'1.1.0',androidApi:34,model:'fixture',metrics:[],parameters:fields,
          capturedAtEpochMs:rid===prior?at-3600000:at}};
      }else if(u.pathname.endsWith('/regression-baselines')){
        data={items:[{id:saved,name:'登记实验 ROM',reportId:prior,expectUnlock:true,state:'ready',model:'fixture',assetId:'asset'}]};
      }
      await route.fulfill({json:data});
    });
    const visit=()=>page.goto(origin+'/#security?report='+id);
    const risk=page.locator('.risk-panel'),h=risk.getByRole('heading',{level:2});
    const external=page.locator('[data-section="external-observations"]');
    const savedReview=external.locator('[data-section="saved-external-identity-review"]');
    const level=value=>risk.locator('[data-level='+value+']').waitFor();
    async function openReadings(code){
      const rule=risk.locator(`[data-risk-rule="${code}"]`);
      const additional=risk.locator('.risk-all-checks').filter({has:rule});
      if(await additional.count()&&await additional.getAttribute('open')===null)await additional.locator(':scope > summary').click();
      await rule.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      const evidence=rule.locator('.risk-rule-evidence');
      assert.equal(await evidence.getAttribute('open'),null);
      await evidence.locator('summary').click();
      return evidence;
    }
    await visit();
    if(archive){
      await h.waitFor();
      assert(['red','yellow','gray','blue'].includes(await h.getAttribute('data-level')));
      assert.equal(await risk.getByText(/项身份声明不一致/).count(),0);
      assert.equal(await external.getAttribute('open'),null);
      if(expectedExternalDiffs!==undefined)assert.equal(await savedReview.count(),1);
      if(await savedReview.count()){
        assert.equal(await savedReview.isVisible(),false);
        await external.locator(':scope > summary').click();
        if(expectedExternalDiffs!==undefined)
          await savedReview.getByText(expectedExternalDiffs+' 项身份声明不一致',{exact:true}).waitFor();
        await savedReview.locator(':scope > summary').click();
        await savedReview.getByText(/不计入 App 安全结果/).waitFor();
      }
      await (await openReadings('SELINUX_MODE')).getByText('system.selinux',{exact:true}).waitFor();
    }else{
      await level('blue');
      await h.getByText('App 观测未触发警示',{exact:true}).waitFor();
      await risk.getByText('设备身份未验证',{exact:true}).waitFor();
      const auxiliary=external.locator(':scope > summary');
      assert.equal(await risk.getByText(/6 项身份声明不一致/).count(),0);
      assert.equal(await savedReview.isVisible(),false);
      assert.equal(await page.getByLabel('打开 ADB 观察 JSON').isVisible(),false);
      await auxiliary.focus();
      await page.keyboard.press('Enter');
      await savedReview.getByText('6 项身份声明不一致',{exact:true}).waitFor();
      assert.equal(await savedReview.getByText(/external fixture model/).isVisible(),false);
      await savedReview.locator(':scope > summary').click();
      await savedReview.getByText(/App：App fixture model · ADB：external fixture model/).waitFor();
      await level('blue');
      await page.getByRole('region',{name:'证据来源对照'}).getByRole('status').getByText(/尚未导入 ADB/).waitFor();
      await page.goto(origin+'/#security?report='+prior);
      await level('blue');
      assert.equal(await savedReview.isVisible(),false);
      await external.locator(':scope > summary').click();
      await savedReview.getByText('同资产历史记录',{exact:true}).waitFor();
      await savedReview.locator(':scope > summary').click();
      assert.equal(await savedReview.getByRole('link',{name:'查看原对照报告'}).getAttribute('href'),'#security?report='+id);
      await visit();
      identityMismatch=true;await page.reload();await level('yellow');
      await (await openReadings('APP_IDENTITY_CONSISTENCY')).getByText('system.propertyModel',{exact:true}).waitFor();
      identityMismatch=false;
      architecture=true;await page.reload();await level('yellow');
      await (await openReadings('RUNTIME_ARCHITECTURE')).getByText('cpu.kernelMachine',{exact:true}).waitFor();
      architecture=false;
      restricted=true;await page.reload();await level('gray');
      await (await openReadings('SELINUX_MODE')).getByText(/errno=13/).waitFor();
      await risk.locator('summary').filter({hasText:'其他检查与导出'}).click();
      const download=page.waitForEvent('download');
      await risk.getByRole('button',{name:'导出风险依据 JSON'}).click();
      const doc=JSON.parse(await readFile(await (await download).path(),'utf8'));
      assert.equal(doc.level,'gray');assert.equal(doc.ruleVersion,'sigmark-observation-risk/5');
      assert.equal(doc.attestation,'not_verified');assert.deepEqual(doc.triggered,['SELINUX_MODE']);
      assert.equal(Object.hasOwn(doc,'identityReview'),false);
      assert.equal(JSON.stringify(doc).includes('external fixture'),false);
      restricted=false;boot='orange';locked='0';await page.reload();await level('yellow');
      await page.goto(origin+'/#security?report='+id+'&baseline='+prior+'&expectUnlock=1');
      await level('yellow');
      const bootRule=risk.locator('[data-risk-rule="BOOT_STATE"]');
      assert.equal(await bootRule.getByText(/系统报告解锁线索/).isVisible(),false);
      await bootRule.locator(':scope > summary').click();
      await bootRule.getByText(/系统报告解锁线索/).waitFor();
      await page.goto(origin+'/#security?report='+id+'&baseline='+prior+'&saved='+saved);
      await level('blue');await risk.getByText(/同资产实验基线：登记实验 ROM/).waitFor();
      boot='red';await page.reload();await level('red');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log(archive?'PASS live archived report: '+(await h.textContent())+', evidence disclosure and 390px.':
      'PASS synthetic risk: isolated external evidence, four levels, policy denial, JSON, registered ROM context, red precedence and 390 px.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
