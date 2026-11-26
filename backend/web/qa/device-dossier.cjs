const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const base=new URL(process.env.SIGMARK_QA_URL).origin, token=process.env.SIGMARK_QA_TOKEN;
const current=process.env.SIGMARK_QA_ACCEPTANCE_CURRENT, asset=process.env.SIGMARK_QA_DOSSIER_ASSET;
const baseline=process.env.SIGMARK_QA_ACCEPTANCE_BASELINE;

async function run(){
  assert(token&&asset&&current&&baseline);
  // The dossier UI is checked against whatever is archived, so the probe values have to
  // come from the payload instead of a hard-coded fixture: an available value that the
  // "仅看缺项" filter must hide, and a restricted row that must show its errno.
  const dossierJson=await (await fetch(base+'/api/admin/device-assets/'+encodeURIComponent(asset)+'/dossier',
    {headers:{authorization:'Bearer '+token}})).json();
  const systemGroup=dossierJson.categories.find(c=>c.group==='system');
  const probe=systemGroup.fields.find(f=>f.key==='buildId'&&f.status==='AVAILABLE'&&f.value)
    ??systemGroup.fields.find(f=>f.status==='AVAILABLE'&&f.value&&f.value.length>=4);
  assert(probe,'system group has no available value to check the gap filter with');
  const restricted=systemGroup.fields.find(f=>f.status==='RESTRICTED'&&f.errno!=null);
  const cellularGroup=dossierJson.categories.find(c=>c.group==='cellular');
  const permissionGap=[...dossierJson.categories.flatMap(c=>c.fields),...dossierJson.categories.flatMap(c=>c.gaps)]
    .find(f=>f.reason==='PRECISE_LOCATION_NOT_GRANTED');
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:320,height:844},serviceWorkers:'block'});
    const errors=[];
    page.setDefaultTimeout(12000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==base||req.method()!=='GET')return route.abort();
      if(!url.pathname.startsWith('/api/admin/'))return route.continue();
      const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
      if(response.status()>=300&&response.status()<400)return route.abort();
      return route.fulfill({response});
    });
    await page.goto(base+'/#assets?tab=devices');
    await page.locator('#history-'+asset).click();
    const dossier=page.getByRole('region',{name:'最近一次采样'});
    const categories=dossier.getByRole('region',{name:'12 类设备参数'});
    await categories.getByText('系统与固件',{exact:true}).waitFor();
    assert.equal(await categories.locator('details.dossier-group').count(),12);
    const system=categories.locator('details').filter({hasText:'系统与固件'});
    await system.locator('summary').focus();
    await page.keyboard.press('Space');
    // A real capture can hold several restricted rows, so the first match is enough here.
    if(restricted)await system.getByText(new RegExp('errno='+restricted.errno)).first().waitFor();
    await system.getByText(probe.value,{exact:true}).waitFor();
    const mobile=categories.locator('details').filter({hasText:'移动网络'});
    await mobile.locator('summary').click();
    if(permissionGap)await mobile.getByText(/未授予精确位置/).first().waitFor();
    else await mobile.getByText(new RegExp('已归档 '+cellularGroup.checklistSaved+'/'+cellularGroup.checklistScope+' 项')).waitFor();
    await dossier.getByRole('checkbox',{name:'仅看缺项'}).check();
    assert.equal(await system.getByText(probe.value,{exact:true}).count(),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), '320px should not overflow');
    const download=page.waitForEvent('download');
    await dossier.getByRole('button',{name:'导出诊断 JSON'}).click();
    const data=JSON.parse(await readFile(await (await download).path(),'utf8'));
    assert.equal(data.reportId,current);
    assert.equal(data.ruleVersion,'sigmark-dossier/6');
    assert(!('feedback' in data));
    assert.equal(data.categories.find(c=>c.group==='system').fields.find(f=>f.key==='selinux').errno,13);
    assert.equal(data.categories.find(c=>c.group==='runtime').fields.find(f=>f.key==='externalInputTypes').kind,'snapshot');
    // Field set 25: the multi-path overlay string is long and cryptic, so the dossier has to
    // say what it is and why a rewritten sku degrades into a comma-separated list.
    const overlay=data.categories.find(c=>c.group==='environment')?.fields.find(f=>f.key==='overlayEvidence');
    if(overlay?.status==='AVAILABLE'&&overlay.value){
      await dossier.getByRole('checkbox',{name:'仅看缺项'}).uncheck();
      const env=categories.locator('details').filter({hasText:'安全与环境线索'});
      await env.locator('summary').click();
      await env.getByText(overlay.value,{exact:true}).waitFor();
      await env.getByText(/channel:payload/).waitFor();
      await env.getByText(/sku: 只是旁证/).waitFor();
      if(overlay.value.includes('conflict:'))await env.getByText(/conflict:）?.*更强的信号/).waitFor();
      else assert.equal(await env.getByText(/更强的信号/).count(),0,'no conflict channel, no warning');
      await dossier.getByRole('checkbox',{name:'仅看缺项'}).check();
    }
    await dossier.getByRole('link',{name:'查看这一份原报告'}).click();
    await page.waitForURL(url=>url.hash.includes('report='+current));
    await page.getByRole('link',{name:'返回设备档案'}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='dossier-report');
    await dossier.getByRole('link',{name:/到验收工作台/}).click();
    await page.getByLabel('同一资产的基线').waitFor();
    assert.equal(await page.getByLabel('同一资产的基线').inputValue(),baseline);
    await page.getByRole('link',{name:'返回设备档案'}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='dossier-lab');
    await page.setViewportSize({width:1366,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'desktop should not overflow');
    assert.deepEqual(errors,[]);
    console.log('PASS dossier browser: inventory entry, 12 sections, keyboard disclosure, 320px and desktop, gap filter, export, original report, comparison and focus return.');
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
