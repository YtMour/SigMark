// Runs the browser QA scripts against an already deployed console.
// The scripts themselves only need SIGMARK_QA_URL plus a browser channel; this runner
// picks a channel that exists on the machine so nobody has to download Playwright's
// bundled Chromium just to check the UI.
const {spawn}=require('node:child_process');
const {join}=require('node:path');
const {chromium}=require('playwright');

// System browsers first: the bundled build is only a fallback when the package happens
// to have it. Probing once here keeps the child scripts free of retry logic.
async function pickChannel(){
  if(process.env.SIGMARK_QA_BROWSER!==undefined)return process.env.SIGMARK_QA_BROWSER||undefined;
  for(const channel of ['chrome','msedge']){
    try{const browser=await chromium.launch({headless:true,channel});await browser.close();return channel;}catch{}
  }
  return undefined;
}

function preflight(archive){
  const missing=[];
  if(!process.env.SIGMARK_QA_URL)missing.push('SIGMARK_QA_URL');
  if(archive&&!process.env.SIGMARK_QA_TOKEN)missing.push('SIGMARK_QA_TOKEN');
  return missing;
}

function run(script,args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(__dirname,script),...args],{env,stdio:'inherit'});
    child.on('error',reject);
    child.on('exit',code=>code===0?resolve():reject(new Error(script+' exited with code '+code)));
  });
}

async function main(){
  const archive=process.argv[2]==='--archive';
  const archiveArgs=archive?process.argv.slice(2):[];
  const missing=preflight(archive);
  if(missing.length){
    console.error('缺少环境变量：'+missing.join('、')+'\n见 backend/web/qa/README.md 的「浏览器回归」一节。');
    process.exitCode=1;
    return;
  }
  const channel=await pickChannel();
  const env={...process.env,...(channel?{SIGMARK_QA_BROWSER:channel}:{})};
  console.log('浏览器通道：'+(channel||'Playwright 自带构建')+'，目标：'+process.env.SIGMARK_QA_URL);
  await run('device-profile.cjs',archiveArgs,env);
  // The dossier check needs one archived asset plus two of its reports. Without them it
  // is skipped instead of failing, so the profile check stays usable on its own.
  const dossierKeys=['SIGMARK_QA_TOKEN','SIGMARK_QA_DOSSIER_ASSET','SIGMARK_QA_ACCEPTANCE_CURRENT','SIGMARK_QA_ACCEPTANCE_BASELINE'];
  const absent=dossierKeys.filter(key=>!process.env[key]);
  if(absent.length){
    console.log('跳过 device-dossier.cjs：未设置 '+absent.join('、')+'。');
    return;
  }
  await run('device-dossier.cjs',[],env);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
