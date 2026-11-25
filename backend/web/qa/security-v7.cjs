// Read-only browser fixture. No token, real sample, publication or upload is used.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const origin=new URL(process.env.SIGMARK_QA_URL).origin;
const id='11111111-1111-4111-8111-111111111111',sha='a'.repeat(64);
const p=(group,key,value)=>({group,key,value,source:'fixture',label:key,status:'AVAILABLE'});
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let cert=sha,registered=true,ver=7;
    await page.route('**/api/**',async route=>{
      const u=new URL(route.request().url());
      assert.equal(u.origin,origin);assert.equal(route.request().method(),'GET');
      const fields=[p('environment','verifiedBoot','green'),p('environment','flashLock','0')];
      if(ver===7)fields.push(...Object.entries({package:'com.sigmark.app',channel:'lan-debug',version:'0.18.0 (20)',certSha256:cert}).map(([k,v])=>p('app',k,v)),
        p('system','partitionCount','1'),p('system','partition_vendor','vendor-build'),p('environment','keyProtection','TEE'));
      let data={ok:true};
      if(u.pathname.endsWith('/'+id))data={id,batch:'synthetic',receivedAt:new Date().toISOString(),report:{schemaVersion:4,fieldSetVersion:ver,
        appVersion:'0.18.0',androidApi:29,model:'fixture',parameters:fields,metrics:[],capturedAtEpochMs:Date.now()}};
      if(u.pathname.endsWith('/release-signer')){
        assert.equal(u.searchParams.get('version'),'0.18.0');assert.equal(u.searchParams.get('code'),'20');
        data=registered?{state:'registered',signerSha256:sha}:{state:'unregistered'};
      }
      await route.fulfill({json:data});
    });
    await page.goto(origin+'/#security?report='+id);
    const signer=page.locator('[data-card=signer]');
    const more=page.locator('[data-section=security-evidence] > summary');
    await more.click();
    await signer.getByText('匹配对应渠道与版本的发布证书。').waitFor();
    await signer.locator('summary').focus();await page.keyboard.press('Enter');
    await signer.getByText(/对应发布证书 SHA-256/).waitFor();
    await page.locator('[data-card=boot]').getByText(/来源互相矛盾/).waitFor();
    await page.locator('[data-card=partitions] summary').click();
    await page.getByText('vendor-build',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    cert='b'.repeat(64);await page.reload();await more.click();await signer.getByText(/发布证书不匹配/).waitFor();
    registered=false;await page.reload();await more.click();await signer.getByText(/无已知发布记录/).waitFor();
    ver=6;await page.reload();await more.click();await page.locator('[data-card=boot]').waitFor();assert.equal(await signer.count(),0);
    assert.deepEqual(errors,[]);console.log('PASS: v7 signer match/mismatch/unregistered, v6 archive, boot conflict, partition disclosure and narrow layout.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
