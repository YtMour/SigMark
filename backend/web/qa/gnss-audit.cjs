const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin,token=process.env.SIGMARK_QA_TOKEN;
const asset=process.env.SIGMARK_QA_GNSS_ASSET, report=process.env.SIGMARK_QA_GNSS_REPORT;

async function run(){
  assert(asset&&report&&token);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try {
    const page=await browser.newPage({viewport:{width:320,height:740},serviceWorkers:'block'});
    page.setDefaultTimeout(12000);
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      if(response.status()>=300&&response.status()<400)return route.abort();
      return route.fulfill({response});
    });
    await page.goto(base+'/#assets?tab=devices&sampleAsset='+asset);
    await page.getByRole('link',{name:/查看最近一份 GNSS 核对报告/}).click();
    assert(new URL(page.url()).hash.includes('report='+report));
    await page.getByRole('searchbox',{name:'搜索本报告参数'}).fill('gnssHardwareYear');
    const row=page.locator('.field-evidence').filter({hasText:'GNSS 硬件与软件型号年'});
    await row.locator('summary').focus();await page.keyboard.press('Enter');
    await row.getByText(/原值 0 是 Android 定义的/).waitFor();
    await row.getByText('GNSS_CALLBACK_OBSERVED',{exact:true}).waitFor();
    await row.getByText('GNSS_NO_INDEPENDENT_PROOF',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('navigation',{name:'当前报告功能'}).getByRole('link',{name:'验收工作台',exact:true}).click();
    const workbench=page.getByRole('region',{name:'本次验收'});
    await workbench.locator('.experiment-card').filter({hasText:'GNSS 读数核对'})
      .getByText('达到判定条件',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const pending=page.waitForEvent('download');
    await workbench.getByRole('button',{name:'导出验收证据包 JSON'}).click();
    const data=JSON.parse(await readFile(await (await pending).path(),'utf8'));
    assert.equal(data.source.current.reportId,report);
    assert.equal(data.quality.ruleVersion,'sigmark-field-quality/1');
    assert(data.quality.gnss.some(note=>note.code==='GNSS_YEAR_BEFORE_2016'));
    assert.equal(data.experiments.find(item=>item.current.id==='gnss').current.state,'passed');
    console.log('PASS GNSS: same-asset archive shortcut, 320px, keyboard evidence, functional outcome and structured quality export.');
  } finally { await browser.close(); }
}
run().catch(error=>{console.error(error);process.exit(1);});
