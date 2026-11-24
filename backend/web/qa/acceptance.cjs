// Run against the disposable QA stack; only reads the two uploaded fixtures.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin;
const token=process.env.SIGMARK_QA_TOKEN;
const baseline=process.env.SIGMARK_QA_ACCEPTANCE_BASELINE;
const current=process.env.SIGMARK_QA_ACCEPTANCE_CURRENT;

async function run(){
  assert(token&&baseline&&current);
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    page.setDefaultTimeout(12000);
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET') return route.abort();
      if(!url.pathname.startsWith('/api/admin/')) return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      if(response.status()>=300&&response.status()<400)return route.abort();
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+current);
    await page.getByRole('button',{name:'采样条件',exact:true}).click();
    const single=page.getByRole('region',{name:'验收证据'});
    await single.getByText('ROM 验收 · 视频首帧未通过').waitFor();
    const summary=single.locator('summary');
    await summary.focus();await page.keyboard.press('Enter');
    await single.getByText('等待首帧',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.goto(base+'/#security?report='+current+'&baseline='+baseline+'&mode=retest');
    const pair=page.getByRole('region',{name:'验收对照'});
    await pair.getByText(/首帧由通过变为未通过/).waitFor();
    await pair.getByText(/采集授权条件有变化/).waitFor();
    await pair.locator('summary').click();
    await pair.getByText(/当前：仅大致/).waitFor();
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出对比 JSON'}).click();
    const doc=JSON.parse(await readFile(await (await downloaded).path(),'utf8'));
    assert.equal(doc.acceptance.media,'regression');
    assert.equal(doc.acceptance.context.location,'changed');
    assert.equal(doc.acceptance.baseline.output.value,'pass');
    assert.equal(doc.acceptance.current.output.value,'fail');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS acceptance browser: archived evidence, keyboard disclosure, same-asset regression, authorization delta, JSON, 390 px.');
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
