const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=new URL(process.env.SIGMARK_QA_URL).origin;
const token=process.env.SIGMARK_QA_TOKEN;
const report=process.env.SIGMARK_QA_REPORT;
const localEvidence=process.env.SIGMARK_QA_ADB_FILE;

async function run(){
  assert(token&&report&&localEvidence);
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
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      return route.fulfill({response});
    });
    await page.goto(base+'/#reports?report='+report);
    await page.getByRole('heading',{name:'MI 8',exact:true}).waitFor();
    await page.getByRole('button',{name:'缺项与补充证据'}).click();
    const panel=page.getByRole('region',{name:'证据来源对照'});
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
    assert.equal(await panel.getByRole('alert').count(),0,'v2 observation should parse');
    await page.waitForTimeout(150);
    const row=panel.getByRole('row').filter({hasText:'SELinux 实时模式'});
    const selinuxText=await row.innerText();
    assert(selinuxText.includes('受限 · errno=13'));
    assert(selinuxText.includes('Enforcing'));
    await panel.getByRole('row',{name:/电池温度/}).waitFor();
    await panel.getByRole('row',{name:/电池电压/}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await panel.getByRole('button',{name:'移除观察文件'}).click();
    assert.equal(await panel.getByRole('table').count(),0);
    assert.deepEqual(mutations,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS coverage follow-up at 320px: keyboard, local v2 evidence, denied App reading, validation, removal and GET-only.');
  }finally{await browser.close();}
}

run().catch(error=>{console.error(error);process.exit(1);});
