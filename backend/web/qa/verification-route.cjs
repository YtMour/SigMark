const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=new URL(process.env.SIGMARK_QA_URL).origin, token=process.env.SIGMARK_QA_TOKEN;
async function run(){
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#lab?report='+process.argv[2]+'&objective=network');
    const experiments=page.getByRole('region',{name:'实验步骤与归档结果'});
    await experiments.locator('summary').getByText(/Wi-Fi → 蜂窝/).waitFor();
    const text=await experiments.locator('.experiment-status').innerText();
    if(process.argv[3]==='yes')assert.equal(text,'达到判定条件');
    else assert.match(text,/未达到判定条件|证据未齐/);
    await page.getByRole('region',{name:'网络切换实验',exact:true}).getByText(/Wi-Fi → 移动网络/).waitFor();
    console.log('PASS real app Wi-Fi -> cellular archive in workbench; endpoint validation='+process.argv[3]);
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
