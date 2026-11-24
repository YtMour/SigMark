const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=new URL(process.env.SIGMARK_QA_URL).origin,token=process.env.SIGMARK_QA_TOKEN;
async function run(){
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      return route.fulfill({response:await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0})});
    });
    await page.goto(base+'/#lab?report='+process.argv[2]+'&objective=usb');
    const experiments=page.getByRole('region',{name:'实验步骤与归档结果'});
    await experiments.getByText('USB 插拔实验',{exact:true}).waitFor();
    const summary=experiments.locator('summary');
    const expected={no_change:'未达到判定条件',incomplete:'证据未齐',increase:'达到判定条件',decrease:'达到判定条件'};
    assert.equal(await summary.locator('.experiment-status').innerText(),expected[process.argv[3]]);
    await summary.click();
    await experiments.getByText(/设备墙钟：/).waitFor();
    console.log('PASS USB workbench replay: actual captured endpoints and correct outcome ('+process.argv[3]+').');
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
