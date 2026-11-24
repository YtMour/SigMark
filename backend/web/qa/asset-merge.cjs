const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const env=process.env,url=new URL(env.SIGMARK_QA_URL).origin,source=env.SIGMARK_QA_MERGE_SOURCE,target=env.SIGMARK_QA_MERGE_TARGET;
async function run(){
  assert(source&&target&&env.SIGMARK_QA_TOKEN==='fixture');
  const browser=await chromium.launch({headless:true,...(env.SIGMARK_QA_BROWSER?{channel:env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),p=new URL(req.url());
      if(p.origin!==url)return route.abort();
      if(req.method()!=='GET'&&!['/api/admin/device-assets/merge'].includes(p.pathname)&&
        !/^\/api\/admin\/device-assets\/merges\/[0-9a-f-]+\/undo$/.test(p.pathname))return route.abort();
      if(!p.pathname.startsWith('/api/admin/'))return route.continue();
      return route.fulfill({response:await route.fetch({headers:{...req.headers(),authorization:'Bearer fixture'},maxRedirects:0})});
    });
    await page.goto(url+'/#assets?tab=devices');
    const open=page.locator('.device-inventory > li').filter({has:page.locator('code',{hasText:source})}).getByRole('button',{name:'合并到另一设备'});
    await open.click();
    const modal=page.getByRole('dialog',{name:'合并设备资产'});
    await modal.getByLabel('目标设备编号').fill(target);
    await modal.getByRole('button',{name:'预览影响'}).click();
    await modal.getByText(/迁移 3 份在库报告/).waitFor();
    await modal.getByRole('checkbox').check();
    await modal.getByRole('button',{name:'确认合并'}).click();
    const audit=page.getByRole('region',{name:'设备合并记录'});
    await audit.getByRole('button',{name:'撤销这次合并'}).click();
    const undo=page.getByRole('dialog',{name:'撤销设备合并'});
    await undo.waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement.textContent),'取消');
    await undo.getByRole('button',{name:'确认撤销'}).click();
    await audit.getByText('已恢复来源资产及其报告归属。',{exact:true}).waitFor();
    await open.waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS browser: merge preview, explicit checkbox, audit, safe initial focus and verified undo at 390px.');
  }finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
