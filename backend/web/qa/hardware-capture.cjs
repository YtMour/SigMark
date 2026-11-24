const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=new URL(process.env.SIGMARK_QA_URL).origin, token=process.env.SIGMARK_QA_TOKEN;
const report=process.argv[2],version=Number(process.argv[3]);

async function run(){
  assert(token&&report&&[11,12,13].includes(version));
  const now=version>=12;
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:320,height:844},serviceWorkers:'block'});
    page.setDefaultTimeout(9000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.origin!==base||req.method()!=='GET')return route.abort();
      if(!u.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+report);
    const block=page.getByRole('region',{name:'扩展采集',exact:true});
    await block.getByText(new RegExp('字段集 v'+version+' · 已归档 '+(now?'14':'4')+' 项')).waitFor();
    await block.locator('summary').focus();
    await page.keyboard.press('Enter');
    await block.getByText(/v11 架构与接口：4\/4/).waitFor();
    await block.getByText(new RegExp('v12 GNSS、输入、传感器、Camera2：'+(now?7:0)+'/7')).waitFor();
    await block.getByRole('button',{name:'只看扩展采集',exact:true}).click();
    assert.equal(await page.locator('.field-evidence').count(),now?14:4);
    await page.getByLabel('搜索本报告参数').fill(now?'runtime.glesProbeResult':'cpu.kernelMachine');
    assert.equal(await page.locator('.field-evidence').count(),1);
    await page.locator('.field-evidence summary').click();
    await page.locator('.field-evidence').getByText('来源',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await block.getByRole('button',{name:'返回全部参数',exact:true}).click();
    assert((await page.locator('.field-evidence').count())>(now?14:4));
    assert.deepEqual(errors,[]);
    console.log('PASS report v'+version+': capture highlight, counts, exact field lookup, evidence source, 320px.');
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
