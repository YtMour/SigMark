import { useEffect, useRef } from 'react';

const key = 'sigmark.report-refresh';
export function refreshSeconds():number {
  try {
    const stored=Number(localStorage.getItem(key)??10);
    return [0,5,10,30].includes(stored)?stored:10;
  } catch { return 10; }
}
export function saveRefreshSeconds(value:number) {
  localStorage.setItem(key,String(value));
}
export function useVisiblePoll(enabled:boolean, fetchLatest:(signal:AbortSignal)=>Promise<void>, scope='') {
  const task=useRef(fetchLatest);
  useEffect(()=>{task.current=fetchLatest;},[fetchLatest]);
  const seconds=refreshSeconds();
  useEffect(()=>{
    if(!enabled||!seconds)return;
    const controller=new AbortController();
    let running=false;
    async function tick(){
      if(running||document.hidden||controller.signal.aborted)return;
      running=true;
      try {await task.current(AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]));}
      catch { /* keep the last good page */ }
      finally {running=false;}
    }
    const timer=setInterval(tick,seconds*1000);
    document.addEventListener('visibilitychange',tick);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);controller.abort();};
  },[enabled,seconds,scope]);
}
