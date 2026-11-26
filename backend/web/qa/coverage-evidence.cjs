const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin;
const token=process.env.SIGMARK_QA_TOKEN;
const appEvidence=process.env.SIGMARK_QA_APP_FILE;
const report=process.env.SIGMARK_QA_REPORT??'11111111-1111-4111-8111-111111111111';
const localEvidence=process.env.SIGMARK_QA_ADB_FILE;

async function run(){
  assert(localEvidence&&(appEvidence||(token&&process.env.SIGMARK_QA_REPORT)));
  const appSample=appEvidence?JSON.parse(await readFile(appEvidence,'utf8')):null;
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:320,height:780},serviceWorkers:'block'});
    const mutations=[], errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(req.method()!=='GET'){mutations.push(req.method());return route.abort();}
      if(url.origin!==base)return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      if(appSample){
        if(url.pathname==='/api/admin/reports/'+report){
          return route.fulfill({json:{id:report,batch:'qa-local',report:appSample,
            receivedAt:new Date(appSample.capturedAtEpochMs).toISOString()}});
        }
        return route.fulfill({json:{ok:true,items:[]}});
      }
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+report);
    await page.getByRole('heading',{name:appSample?.model??'MI 8',exact:true}).waitFor();
    await page.getByRole('button',{name:'缺项与补充证据'}).click();
    const panel=page.getByRole('region',{name:'证据来源对照'});
    const identity=panel.locator('[data-identity-state]');
    assert.equal(await identity.getAttribute('data-identity-state'),'not_loaded');
    await panel.getByLabel('打开 ADB 观察 JSON').waitFor();
    await panel.getByText('system.selinuxPolicy',{exact:true}).waitFor();
    const trigger=panel.locator('summary');
    await trigger.focus();await page.keyboard.press('Enter');
    assert.equal(await trigger.locator('..').getAttribute('open'),null);
    const input=panel.getByLabel('打开 ADB 观察 JSON');
    await input.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{')});
    await panel.getByRole('alert').waitFor();
    await input.setInputFiles(localEvidence);
    await panel.getByRole('table').waitFor();
    assert.equal(await panel.getByRole('alert').count(),0,'ADB observation should parse');
    const confirmation=panel.getByRole('checkbox',{name:'已核对，这是同一台设备'});
    const verdict=panel.getByRole('columnheader',{name:'对照结果'});
    assert.equal(await confirmation.isChecked(),false);
    assert.equal(await verdict.count(),0);
    await panel.locator('[data-identity-state="unpaired"]').waitFor();
    const row=panel.getByRole('row').filter({hasText:'SELinux 实时模式'});
    const selinuxText=await row.innerText();
    assert(selinuxText.includes('受限 · errno=13'));
    assert(selinuxText.includes('Enforcing'));
    await confirmation.focus();
    await page.keyboard.press('Space');
    await row.getByRole('cell',{name:'缺少一方读数'}).waitFor();
    if(appSample){
      const adbSample=JSON.parse(await readFile(localEvidence,'utf8'));
      const labels={
        'system.boardPlatform':'平台代号声明',
        'system.bootHardware':'启动硬件声明',
        'system.hardwareSku':'启动硬件 SKU',
        'system.device':'设备代号',
        'system.initialSdk':'设备初始 API 级别',
      };
      for(const [key,label] of Object.entries(labels)){
        const lookup=appSample.parameters.find(p=>p.group+'.'+p.key===key);
        const value=adbSample.readings[key];
        if(lookup?.status!=='AVAILABLE'||!value)continue;
        const identityRow=panel.getByRole('row').filter({has:page.getByRole('rowheader',{name:label,exact:true})});
        const expected=lookup.value.toLowerCase()===value.toLowerCase()?'读数一致':/身份字段不一致/;
        await identityRow.getByRole('cell',{name:expected}).waitFor();
      }
      if(appSample.model!==adbSample.model){
        await panel.locator('[data-identity-state="different"]').waitFor();
      }
      if(process.env.SIGMARK_QA_IDENTITY_SUMMARY){
        assert((await identity.innerText()).includes(process.env.SIGMARK_QA_IDENTITY_SUMMARY));
      }
      await confirmation.focus();
      await page.keyboard.press('Space');
      await verdict.waitFor({state:'detached'});
      await confirmation.check();
      await verdict.waitFor();
      const sameModel={...adbSample,model:appSample.model};
      await input.setInputFiles({name:'same-model.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sameModel))});
      await panel.getByText(/两份记录的型号相同/).waitFor();
      assert.equal(await confirmation.isChecked(),false);
      assert.equal(await verdict.count(),0);
      const stale={...adbSample,observedAtEpochMs:appSample.capturedAtEpochMs+300001};
      await input.setInputFiles({name:'stale.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(stale))});
      await panel.locator('[data-identity-state="unpaired"]').waitFor();
      await confirmation.check();
      await panel.locator('[data-identity-state="stale"]').waitFor();
    }
    await panel.getByRole('row',{name:/电池温度/}).waitFor();
    await panel.getByRole('row',{name:/电池电压/}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await panel.getByRole('button',{name:'移除观察文件'}).click();
    assert.equal(await panel.getByRole('table').count(),0);
    if(appSample){
      await page.goto(base+'/#security?report='+report);
      const risk=page.locator('.risk-panel');
      await risk.getByText('设备身份未验证',{exact:true}).waitFor();
      const appLevel=await risk.locator('[data-level]').getAttribute('data-level');
      await page.locator('[data-section="external-observations"] > summary').click();
      await input.setInputFiles(localEvidence);
      await confirmation.check();
      await panel.locator('[data-identity-state="different"],[data-identity-state="matching"]').waitFor();
      assert.equal(await risk.locator('[data-level]').getAttribute('data-level'),appLevel);
      await risk.getByText('设备身份未验证',{exact:true}).waitFor();
    }
    assert.deepEqual(mutations,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS coverage follow-up at 320px: same-device confirmation, local evidence, restricted App reading, validation, removal and GET-only.');
  }finally{await browser.close();}
}

run().catch(error=>{console.error(error);process.exit(1);});
