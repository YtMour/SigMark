const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin, token=process.env.SIGMARK_QA_TOKEN;
const baseline=process.env.SIGMARK_QA_ACCEPTANCE_BASELINE,current=process.env.SIGMARK_QA_ACCEPTANCE_CURRENT;
async function run(){
  assert(token&&baseline&&current);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    page.setDefaultTimeout(12000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      if(response.status()>=300&&response.status()<400)return route.abort();
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+current);
    await page.getByRole('link',{name:'打开验收工作台',exact:true}).click();
    await page.getByRole('heading',{name:'验收工作台',exact:true}).waitFor();
    assert.equal(await page.getByLabel('同一资产的基线').inputValue(),baseline);
    await page.getByRole('region',{name:'网络切换实验'}).getByText(/Wi-Fi → 移动网络/).waitFor();
    await page.getByLabel('显示').selectOption('blocked');
    await page.getByRole('button',{name:'应用筛选'}).click();
    await page.getByRole('table').getByText('系统拒绝访问',{exact:false}).waitFor();
    assert.equal(await page.getByRole('table').locator('tbody tr').count(),1);
    const scroll=page.getByRole('region',{name:/复测证据，可横向滚动/});
    await scroll.focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('.lab-table').scrollLeft>0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出证据单 JSON'}).click();
    const doc=JSON.parse(await readFile(await (await download).path(),'utf8'));
    assert.equal(doc.baselineId,baseline);
    assert.equal(doc.acceptance.media,'regression');
    assert.equal(doc.transition.after,'cellular');
    assert.equal(doc.restricted.policy,1);
    assert(!('feedback' in doc));
    await page.getByLabel('同一资产的基线').selectOption('');
    await page.getByRole('button',{name:'应用基线'}).click();
    await page.getByRole('region',{name:'当前受限原因'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS lab browser: report link, automatic same-asset baseline, route check, denial filter, keyboard scroll, export and 390 px.');
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
