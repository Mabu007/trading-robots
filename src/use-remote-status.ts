import {useCallback,useEffect,useRef,useState} from 'react';
import type {CloudClient} from './firebase';
import {sharingRequest} from './components/BotSharing';
// A newer refresh owns the screen. Old requests cannot restore stale account
// state after a mode/bot change, or after a deployment action finishes.
export function useRemoteStatus<T>(client:CloudClient,path:string){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState('');
 const sequence=useRef(0),mounted=useRef(false),request=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  if(!mounted.current)return;
  const revision=++sequence.current;request.current?.abort();const controller=new AbortController();request.current=controller;
  try{const result=await sharingRequest<T>(client,path,'GET',undefined,{signal:controller.signal});if(mounted.current&&sequence.current===revision){setData(result);setError('')}}
  catch(e){if(mounted.current&&sequence.current===revision&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Status unavailable. Please retry.')}
 },[client,path]);
 useEffect(()=>{mounted.current=true;setData(null);setError('');let timer:ReturnType<typeof setTimeout>;let active=true;const poll=async()=>{await refresh();if(active)timer=setTimeout(()=>void poll(),15000)};void poll();return()=>{active=false;mounted.current=false;sequence.current++;request.current?.abort();clearTimeout(timer)}},[refresh]);
 return {data,error,refresh};
}
