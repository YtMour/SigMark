const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin,token=process.env.SIGMARK_QA_TOKEN;
const asset=process.env.SIGMARK_QA_CONFIG_ASSET,previous=process.env.SIGMARK_QA_CONFIG_PREVIOUS;

async function run(){
  assert(asset&&previous&&token);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try {
    const page=await browser.newPage({viewport:{width:320,height:740},serviceWorkers:'block'});
    page.setDefaultTimeout(12000);
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#assets?tab=devices&sampleAsset='+asset);
    const code=page.locator('.configuration-evidence details').filter({hasText:'设备配置机器码'});
    const trigger=code.locator('summary');
    await trigger.click();
    await code.getByText(/^P2-[0-9a-f]{32}$/).waitFor();
    await code.getByText(/^R2-[0-9a-f]{32}$/).waitFor();
    await code.getByText('值变化',{exact:true}).first().waitFor();
    assert((await code.getByRole('link',{name:'查看上一次同资产采样'}).getAttribute('href')).includes(previous));
    const sys=page.locator('.configuration-evidence details').filter({hasText:'固定 /sys'});
    await sys.locator('summary').click();
    await sys.getByText('在线编号是可能编号的子集。',{exact:true}).waitFor();
    await sys.getByText('两路电池温度在 2 °C 内。',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出诊断 JSON'}).click();
    const evidence=JSON.parse(await readFile(await (await pending).path(),'utf8'));
    assert.equal(evidence.configurationCode.previousReportId,previous);
    assert.equal(evidence.categories.find(row=>row.group==='cpu').fields.find(row=>row.key==='sysCpuOnline').source,'/sys/devices/system/cpu/online');
    console.log('PASS 320px asset configuration disclosure, ROM input delta, sysfs/API comparison, predecessor and dossier export.');
  } finally { await browser.close(); }
}
run().catch(error=>{console.error(error);process.exit(1);});
