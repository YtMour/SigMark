import {useEffect,useRef} from 'react';
import type {MouseEvent} from 'react';

// Navigation state belongs to one browser-history entry, not to a report or global storage.
type Mark={hash:string;pages:string[];target:string;top:number;label:string;fallback?:string};
export function listMark():Mark|undefined{
  const m=history.state?.sigmarkList as Mark|undefined;
  return m?.hash===location.hash?m:undefined;
}
export function listPages(){return listMark()?.pages??[''];}
function route(hash:string,state:object){
  const oldURL=location.href;
  history.pushState(state,'',hash);
  window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL,newURL:location.href}));
}
export function openFromList(e:MouseEvent<HTMLAnchorElement>,pages:string[],label:string,fallback?:string){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  const link=e.currentTarget;
  const m:Mark={hash:location.hash,pages:[...pages],target:link.id,top:link.getBoundingClientRect().top,label,fallback};
  e.preventDefault();
  history.replaceState({...history.state,sigmarkList:m},'');
  route(link.hash,{sigmarkOrigin:m,readerDepth:1,sigmarkAncestors:[location.hash]});
}
export function navigateReader(hash:string){
  if(location.hash===hash)return;
  const {sigmarkOrigin,readerDepth,sigmarkAncestors}=history.state??{};
  const state={sigmarkAncestors:[...(sigmarkAncestors??[]),location.hash]};
  route(hash,sigmarkOrigin?{...state,sigmarkOrigin,readerDepth:readerDepth+1}:state);
}
export function followReadLink(e:MouseEvent<HTMLAnchorElement>){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  e.preventDefault();
  navigateReader(e.currentTarget.hash);
}
export function followReaderParent(e:MouseEvent<HTMLAnchorElement>){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  const target=e.currentTarget.hash;
  const ancestors:string[]=history.state?.sigmarkAncestors??[];
  const index=ancestors.lastIndexOf(target);
  e.preventDefault();
  if(index>=0)history.go(index-ancestors.length);
  else navigateReader(target);
}
export function readerOrigin(){
  return history.state?.sigmarkOrigin as Mark|undefined;
}
export function returnFromReader(fallback:string){
  if(history.state?.sigmarkOrigin&&history.state.readerDepth>0){history.go(-history.state.readerDepth);return;}
  location.hash=fallback;
}
export const returnLabel=()=>history.state?.sigmarkOrigin?.label??'返回报告列表';
export function useRestoreList(ready:boolean){
  const restored=useRef(false);
  useEffect(()=>{
    const mark=listMark();
    if(!ready||!mark||restored.current)return;
    const frame=requestAnimationFrame(()=>{
      if(listMark()?.target!==mark.target)return;
      const trigger=document.getElementById(mark.target)??(mark.fallback?document.getElementById(mark.fallback):null);
      if(trigger){
        trigger.focus({preventScroll:true});
        window.scrollBy(0,trigger.getBoundingClientRect().top-mark.top);
      }
      // On another Back/Forward visit the list mounts again, but live updates must not steal focus.
      restored.current=true;
    });
    return ()=>cancelAnimationFrame(frame);
  },[ready]);
}
