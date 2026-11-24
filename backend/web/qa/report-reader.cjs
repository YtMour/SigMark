// Run against a built console. Playwright intercepts all API traffic; no login or database writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const base=process.env.SIGMARK_QA_URL;
if(!base)throw Error('Set SIGMARK_QA_URL to the console origin.');
const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const asset=id(9999),when='2026-11-21T05:00:00Z';
const groups=['system','cpu','memory','display','battery','sensors','network','cellular','runtime','media','environment','app'];
const params=Array.from({length:126},(_,i)=>({
  group:groups[i%groups.length],key:'field'+i,label:'归档字段 '+i,source:'QA.source.'+i,status:'AVAILABLE',value:i===25?'长读数'.repeat(60):String(i)
}));
for(let i=0;i<10;i++)Object.assign(params[i],{status:i<2?'RESTRICTED':'UNAVAILABLE',value:null,
  reason:i<2?'ACCESS_DENIED':'NOT_REPORTED',...(i<2?{errno:13,note:'测试依据；不推断系统实时状态'}:{})});
Object.assign(params[0],{key:'selinux',label:'SELinux 模式'});
Object.assign(params[12],{key:'release',label:'Android 版本',value:'10',source:'Build.VERSION.RELEASE'});
const rows=Array.from({length:65},(_,i)=>({id:id(i+1),batch:'qa-reader',receivedAt:when,assetId:asset,report:{
  model:'QA 设备 '+(i+1),schemaVersion:4,androidApi:29,appVersion:'0.17.0',network:'wifi',assetId:asset,
  fieldSetVersion:6,collectorVersion:'0.17.0',capturedAtEpochMs:Date.parse(when)
}}));
const query='?batch=qa-reader';
const coverage=groups.map(group=>{
  const g=params.filter(p=>p.group===group);
  return {group,available:g.filter(p=>p.status==='AVAILABLE').length+1,restricted:g.filter(p=>p.status==='RESTRICTED').length,
    unavailable:g.filter(p=>p.status==='UNAVAILABLE').length,errors:0};
});
async function run(){
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:891,height:1003}});page.setDefaultTimeout(8000);
    const issues=[],calls=[],widths={},returnOffsets=[];
    page.on('pageerror',e=>issues.push(e.message));
    await page.route('**/api/**',async route=>{
      const u=new URL(route.request().url()),p=u.pathname.split('/').pop(),q=u.searchParams;
      calls.push(u.pathname);
      if(route.request().method()!=='GET'){issues.push('unexpected write: '+u.pathname);return route.abort();}
      if(p===id(80))return route.fulfill({status:404,json:{error:'report_not_found'}});
      const set=q.get('batch')==='two'?rows.slice(0,2):rows;
      const r=rows.find(x=>x.id===p);
      const start=Number(q.get('before')||0);
      const totals={devices:1,reports:set.length,unassigned:0,trash:0};
      const data=p==='dossier'?{schemaVersion:1,ruleVersion:'sigmark-dossier/1',assetId:asset,reportId:id(1),batch:'qa-reader',
        receivedAt:when,capturedAtEpochMs:Date.parse(when),reportSchemaVersion:4,fieldSetVersion:6,appVersion:'0.17.0',androidApi:29,context:{},
        categories:groups.map(group=>({group,counts:{available:0,restricted:0,unavailable:0,errors:0},checklistSaved:0,checklistScope:0,fields:[],gaps:[]}))}:
        r?{...r,...(p===id(65)?{trashedAt:when}:{}),report:{...r.report,metrics:[],parameters:params,coverage,
        ...(p===id(64)?{schemaVersion:1,parameters:undefined,coverage:undefined,metrics:[{key:'system.selinux',status:'RESTRICTED'}]}:{})}}:
        p==='device-assets'?(q.has('summary')?{generatedAt:when,totals,distributions:{}}:{items:[{id:asset,label:'设备样本',model:'QA',reports:65,firstSeen:when,lastSeen:when}],totals}):
        p==='report-count'?{total:set.length}:p==='reports'?{items:set.slice(start,start+30),nextCursor:start+30<set.length?String(start+30):''}: {items:[]};
      return route.fulfill({json:data});
    });
    const go=hash=>page.goto(new URL('/'+hash,base).href);
    const snap=async name=>{
      if(!process.env.SIGMARK_QA_OUTPUT)return;
      await fs.mkdir(process.env.SIGMARK_QA_OUTPUT,{recursive:true});
      await page.screenshot({path:path.join(process.env.SIGMARK_QA_OUTPUT,name+'.png')});
    };
    const screenOK=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
    await go('#assets?batch=two');
    await page.getByText('QA 设备 2',{exact:true}).waitFor();
    const gap=await page.evaluate(()=>document.querySelector('.workspace-content').getBoundingClientRect().top-
      document.querySelector('.workspace-rail').getBoundingClientRect().bottom);
    assert(Math.abs(gap)<1,'gap='+gap);await snap('assets-891');

    await go('#reports'+query);
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await page.getByText('第 2 页 · 每页 30 份',{exact:true}).waitFor();
    async function openAndCheck(origin,returnName,via){
      await origin.waitFor();await origin.evaluate(el=>el.scrollIntoView({block:'center'}));
      const before=await origin.evaluate(el=>el.getBoundingClientRect().top);
      const hash=new URL(page.url()).hash;
      await origin.click();
      await page.getByLabel('搜索本报告参数').waitFor();
      assert.equal(await page.getByRole('region',{name:'报告列表'}).count(),0);
      if(via==='security'){
        await page.getByRole('link',{name:'单份安全分析'}).click();
        await page.getByRole('link',{name:'返回报告详情'}).click();
      }
      if(via==='browser')await page.goBack();
      else await page.getByRole('button',{name:returnName,exact:true}).click();
      await page.waitForURL(u=>u.hash===hash);
      await origin.waitFor();
      await page.waitForFunction(id=>document.activeElement?.id===id,await origin.getAttribute('id'));
      const after=await origin.evaluate(el=>el.getBoundingClientRect().top);
      returnOffsets.push(Math.abs(before-after));
      assert(Math.abs(before-after)<=2,'scroll restoration '+before+' vs '+after);
    }
    await openAndCheck(page.locator('#archive-read-'+id(48)),'返回报告列表','browser');
    await go('#assets'+query);
    await page.getByRole('button',{name:'下一页',exact:true}).click();
    await openAndCheck(page.locator('#asset-read-'+id(48)),'返回资产管理','security');
    await go('#assets');
    await page.getByText('65 份采样',{exact:true}).waitFor();
    assert.equal(await page.locator('.device-inventory > li').count(),1);
    await page.getByRole('link',{name:'看全部报告'}).click();
    await page.getByRole('heading',{name:'在库报告',exact:true}).waitFor();
    await page.getByRole('link',{name:'设备档案',exact:true}).click();
    await page.getByRole('link',{name:'打开档案',exact:true}).click();
    await page.getByRole('button',{name:'加载更早采样'}).click();
    await openAndCheck(page.locator('#sample-read-'+id(48)),'返回设备采样','button');
    const picks=page.getByRole('checkbox',{name:/选择采样/});
    await picks.nth(0).check();await picks.nth(1).check();
    await page.getByRole('link',{name:/对比所选两份/}).click();
    await page.getByRole('heading',{name:'报告对比'}).waitFor();
    await page.getByRole('button',{name:'返回设备采样'}).click();
    await page.waitForFunction(id=>document.activeElement?.id===id,'samples-'+asset);

    calls.length=0;
    await go('#reports?report='+id(1));
    const search=page.getByLabel('搜索本报告参数');
    await search.waitFor();
    assert(!calls.includes('/api/admin/report-count')&&!calls.includes('/api/admin/reports'),'deep link fetched the list');
    assert.equal(await page.locator('.parameter-group').count(),12);
    assert.equal(await page.locator('.field-evidence').count(),126);
    assert.equal(await page.locator('.field-evidence[open]').count(),0);
    const denied=page.locator('.field-evidence').filter({has:page.locator('.field-label',{hasText:'SELinux 模式'})});
    assert.match(await denied.locator('summary').innerText(),/系统拒绝访问/);
    await search.fill('errno=13');await page.getByText('显示 2 / 已归档 126 项',{exact:true}).waitFor();
    assert.equal(await page.locator('.field-evidence').count(),2);
    await denied.locator('summary').focus();await page.keyboard.press('Enter');
    assert(await denied.getByText('errno=13',{exact:true}).isVisible());
    await page.getByRole('button',{name:'手机快照覆盖'}).click();
    await page.getByText(/手机快照 138 项 · 归档明细 126 项/).waitFor();
    await page.getByRole('button',{name:'归档参数 · 126 项'}).click();
    assert.equal(await search.inputValue(),'errno=13');
    await page.getByRole('button',{name:'可用 0',exact:true}).click();
    await page.getByText('没有匹配参数',{exact:true}).waitFor();
    await page.getByRole('button',{name:'清除参数筛选'}).click();
    await page.getByLabel('定位分类').selectOption('cellular');
    assert.match(await page.evaluate(()=>document.activeElement.textContent),/移动网络/);
    await page.getByRole('button',{name:'返回分类导航 ↑'}).nth(7).click();
    assert(await page.getByLabel('定位分类').evaluate(el=>document.activeElement===el));
    for(const [w,h] of [[320,640],[390,844],[760,900],[891,1003],[944,900],[945,900],[1024,720],[1440,900],[1920,1068]]){
      await page.setViewportSize({width:w,height:h});
      await page.evaluate(()=>window.scrollTo(0,0));
      assert(await screenOK(),'horizontal overflow at '+w);
      const layout=await page.locator('.field-evidence').first().evaluate(el=>{
        let innerScroll=false;
        for(let n=el;n&&n!==document.body;n=n.parentElement){
          if(/auto|scroll/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+1)innerScroll=true;
        }
        return {innerScroll,width:el.getBoundingClientRect().width};
      });
      assert(!layout.innerScroll,'inner scrolling at '+w);
      widths[w]=Math.round(layout.width);
      if(w===1024)assert(layout.width>760,'reader squeezed: '+layout.width);
      if([390,1024,1920].includes(w))await snap('reader-'+w);
    }
    await page.getByRole('button',{name:'返回报告列表'}).click();
    await page.getByRole('region',{name:'报告列表'}).waitFor();
    await go('#reports?report=invalid');
    await page.getByRole('alert').filter({hasText:'报告编号无效'}).waitFor();
    await go('#reports?report='+id(65));await page.getByRole('alert').filter({hasText:'报告在回收站'}).waitFor();
    await go('#reports?report='+id(80));await page.getByRole('alert').filter({hasText:'没有找到这份报告'}).waitFor();
    await go('#reports?report='+id(64));await page.getByText(/旧报告只保存了采集状态/).waitFor();
    assert.equal(await page.locator('.field-evidence').count(),0);
    assert.deepEqual(issues,[]);
    console.log('PASS independent reader; 9 viewports; 126 fields; search/status/evidence/coverage; cursor, focus and scroll restore from archive/assets/device samples; comparison, legacy and error states.');
    console.log(JSON.stringify({gapPx:gap,fieldWidthPxAtViewport:widths,returnOffsetErrorPx:returnOffsets}));
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
