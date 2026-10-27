import type {Request,Response,NextFunction} from 'express';
// Per-instance application guard; cTrader's global gateway throttles are separate.
// Enforce distributed ingress limits at the production edge as well.
const windows=new Map<string,{until:number;count:number}>();
export function requestLimit(req:Request,res:Response,next:NextFunction){
 const now=Date.now(),key=(req.header('authorization')||req.ip||'anonymous').slice(0,3000);
 // Store a hash instead of bearer credentials in process memory.
 const fingerprint=hash(key);let state=windows.get(fingerprint);if(!state||now>=state.until){state={until:now+60000,count:0};windows.set(fingerprint,state)}
 if(windows.size>10000){for(const [k,v]of windows)if(v.until<=now)windows.delete(k);if(windows.size>20000)windows.clear()}
 if(++state.count>90){res.setHeader('Retry-After',Math.max(1,Math.ceil((state.until-now)/1000)));return res.status(429).json({error:'Too many requests. Please wait a minute and retry.'})}next();
}
import {createHash} from 'node:crypto';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
