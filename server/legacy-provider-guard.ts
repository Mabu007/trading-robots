import type {NextFunction,Request,Response} from 'express';

// Preserve stop/undeploy/pause for old instances, but do not allow new legacy
// execution while the VALR migration is active.
export function legacyProviderGuard(req:Request,res:Response,next:NextFunction){
 if(process.env.ENABLE_LEGACY_CTRADER==='true'||req.method!=='POST')return next();
 const path=req.path;
 const deploy=/^\/api\/marketplace\/bots\/[A-Za-z0-9_-]{1,100}\/deployment$/.test(path);
 const subscribe=/^\/api\/marketplace\/bots\/[A-Za-z0-9_-]{1,100}\/subscribe$/.test(path);
 if(deploy&&!['stop','undeploy'].includes(req.body?.action)||subscribe&&req.body?.action!=='pause')return res.status(409).json({error:'cTrader execution is parked during the VALR migration. Existing positions are not closed.'});
 return next();
}
