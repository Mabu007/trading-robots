/** Identify live-robot environmental questions before optional public-research
 * routing. This is NOT a predefined answer; it only requests owner-scoped tools.
 */
export function wantsRobotEnvironment(question:unknown){
 if(typeof question!=='string'||question.length>10000)return false;
 const q=question.toLowerCase();
 const robot=/\b(?:robot|robots|bot|bots|agent|agents|deployed|deployment|deploying|running strategy)\b/i.test(q);
 const enquiry=/\b(?:just|new|running|deployed|live|active|market|conditions|optimal|suitable|work|working|access|see|visible|why|check|inspect|status|trade|trading|fit|compatible|monitor|doing|environment|settings|strategy)\b/i.test(q);
 return robot&&enquiry;
}
export type RobotContextSelection={
 robotId:string;accountId:string;issuedAt:number;grantId:string;
 runtime:'running'|'paused'|'inactive'|'unverified';
};
export function chooseLiveRobot(candidates:RobotContextSelection[],preferredId?:string){
 const pool=preferredId?candidates.filter(x=>x.robotId===preferredId):candidates;
 if(preferredId&&pool.length!==1)return {kind:'not-found' as const,choice:null};
 const running=pool.filter(x=>x.runtime==='running');
 if(running.length===1)return {kind:'resolved' as const,choice:running[0]};
 if(running.length>1)return {kind:'ambiguous' as const,choice:null};
 const paused=pool.filter(x=>x.runtime==='paused');
 if(paused.length===1)return {kind:'paused' as const,choice:paused[0]};
 if(paused.length>1)return {kind:'ambiguous' as const,choice:null};
 const unverified=pool.filter(x=>x.runtime==='unverified');
 if(unverified.length===1&&pool.length===1)return {kind:'unverified' as const,choice:unverified[0]};
 if(unverified.length)return {kind:'ambiguous' as const,choice:null};
 if(preferredId&&pool.length===1)return {kind:'inactive' as const,choice:pool[0]};
 return {kind:'none' as const,choice:null};
}
