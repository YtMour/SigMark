// Opt-in, read-only check of specific archived reports. Does not save or print field values.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
async function run(){
  const ids=process.argv.slice(2),origin=new URL(process.env.SIGMARK_QA_URL).origin,token=process.env.SIGMARK_QA_TOKEN;
  if(!token||!ids.length||!ids.every(id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))
    throw Error('Set SIGMARK_QA_URL, SIGMARK_QA_TOKEN and pass the report UUIDs to check.');
  const browser=await chromium.launch({headless:true,...(process.env.SIGMARK_QA_BROWSER?{channel:process.env.SIGMARK_QA_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin||req.method()!=='GET')return route.abort();
      if(url.pathname.startsWith('/api/admin/')){
        const response=await route.fetch({headers:{...req.headers(),authorization:'Bearer '+token},maxRedirects:0});
        if(response.status()>=300&&response.status()<400)return route.abort();
        return route.fulfill({response});
      }
      return route.continue();
    });
    for(const [index,id] of ids.entries()){
      const path='/api/admin/reports/'+id;
      const pending=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.ok());
      await page.goto(origin+'/#reports?report='+id);
      const {report}=await (await pending).json(),fields=report.parameters??[];
      await page.getByRole('button',{name:'归档参数 · '+fields.length+' 项',exact:true}).waitFor();
      const actual=await page.locator('.field-evidence').evaluateAll(nodes=>nodes.map(node=>{
        const evidence=Array.from(node.querySelectorAll('dl dd'));
        const reading=node.querySelector('.field-reading');
        return {id:evidence[0].textContent,source:evidence[1].textContent,status:node.querySelector('.state').classList[1],
          value:reading.classList.contains('no-value')?null:reading.textContent};
      }));
      const byKey=new Map(actual.map(p=>[p.id,p]));
      assert(actual.length===fields.length&&byKey.size===fields.length,'row count or unique key mismatch');
      for(const field of fields){
        const key=field.group+'.'+field.key,row=byKey.get(key);
        assert(row&&row.status===field.status.toLowerCase()&&row.value===field.value&&row.source===(field.source||'报告未记录'),
          'archive/reader mismatch at '+key);
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
      console.log('PASS sample '+(index+1)+': '+fields.length+' fields, '+new Set(fields.map(p=>p.group)).size+' groups; keys, values, source, status match.');
    }
  }finally{await browser.close();}
}
run().catch(err=>{console.error(err.message);process.exitCode=1;});
