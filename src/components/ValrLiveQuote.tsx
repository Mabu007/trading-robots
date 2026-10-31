import {useEffect,useState} from 'react';
import {subscribeValrQuote,type LiveState} from '../valr-live';
export function ValrLiveQuote({pair}:{pair:string}){
 const [state,setState]=useState<LiveState>({status:'connecting',quote:null}),[now,setNow]=useState(Date.now());
 useEffect(()=>{setState({status:'connecting',quote:null});const stop=subscribeValrQuote(pair,setState);const clock=window.setInterval(()=>setNow(Date.now()),5000);return()=>{stop();window.clearInterval(clock)}},[pair]);
 const quote=state.quote?.pair===pair?state.quote:null,stale=!!quote&&now-quote.receivedAt>60000;
 const label=state.status==='reconnecting'?'Reconnecting':stale?'Price delayed':'Live';
 return <span className="valr-live-quote" title={quote?`VALR bid ${quote.bid} · ask ${quote.ask} · updated ${new Date(quote.receivedAt).toLocaleTimeString()}`:'Connecting to VALR public market data'}>{quote?<>{label} · {quote.last.toLocaleString(undefined,{maximumFractionDigits:12})}</>:'Connecting to VALR…'}</span>;
}
