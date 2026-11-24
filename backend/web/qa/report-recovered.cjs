const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=new URL(process.env.SIGMARK_QA_URL).origin;
const token=process.env.SIGMARK_QA_TOKEN;
const old=process.env.SIGMARK_QA_OLD_REPORT;
const current=process.env.SIGMARK_QA_CURRENT_REPORT;

async function run(){
  assert(token&&old&&current);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:320,height:780},serviceWorkers:'block'});
    page.setDefaultTimeout(9000);
    const mutations=[];
    page.on('pageerror',error=>mutations.push(error.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(req.method()!=='GET'){mutations.push(req.method());return route.abort();}
      if(url.origin!==base)return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+old);
    const summary=page.locator('.report-recovered summary');
    await page.getByText(/此报告由 App 1.4.1 \(31\) 采样/).waitFor();
    assert.match(await summary.innerText(),/20\.48 Wh/);
    await page.goto(base+'/#reports?report='+current);
    await summary.getByText(/20\.42 Wh/).waitFor();
    assert.equal(await page.getByText(/此报告由 App 1.4.1 \(31\) 采样/).count(),0);
    await summary.focus();
    await page.keyboard.press('Enter');
    const panel=page.locator('.report-recovered');
    await panel.getByText('BATTERY_ENERGY_ESTIMATE/1',{exact:true}).waitFor();
    assert.match(await panel.innerText(),/4658\.0 mAh/);
    assert.match(await panel.innerText(),/4383 mV/);
    assert.match(await panel.innerText(),/硬件能量计.*\n暂无数据 · 接口不提供/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'缺项与补充证据'}).click();
    await page.getByText(/推不出单小区带宽/).waitFor();
    assert.deepEqual(mutations,[]);
    console.log('PASS 320px: older signed report recapture notice, recent report estimate with untouched counter, LTE context, GET-only.');
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exit(1);});
