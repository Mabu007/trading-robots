/** Provider and candle API responses are untrusted: Cloudflare and upstream
 * proxies sometimes return plain text ("error code: 520") instead of JSON.
 * A failure BEFORE an order submission must not permanently halt a bot.
 * An error AFTER an order request remains ambiguous and is never auto-cleared.
 */
export class TemporaryReadError extends Error {
 readonly retryNextCandle=true;
 constructor(message:string){super(message);this.name='TemporaryReadError'}
}
export function retryableReadError(error:unknown):boolean {
 return error instanceof TemporaryReadError;
}
const temporaryStatus=(s:number)=>s===408||s===425||s===429||s>=500;
const clean=(v:unknown)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').slice(0,200):'';

export async function parseUpstreamJson(
 response:Response,
 label:string,
 {mayHaveSubmittedOrder=false}:{mayHaveSubmittedOrder?:boolean}={},
):Promise<any>{
 const status=response.status,temporary=temporaryStatus(status);
 // A failed gateway can return a body like "error code: 520" or HTML.
 // Never include an arbitrary upstream body in logs or exceptions.
 if(!response.ok&&temporary) {
  const message=label+' temporarily unavailable (HTTP '+status+').';
  if(!mayHaveSubmittedOrder)throw new TemporaryReadError(message);
  throw Error(message+' Order submission outcome is unknown; reconcile first.');
 }
 const raw=await response.text();
 let body:any;
 try{body=JSON.parse(raw)}
 catch{
  const message=label+' returned a non-JSON response (HTTP '+status+').';
  if(!mayHaveSubmittedOrder&&(response.ok||temporary))throw new TemporaryReadError(message);
  throw Error(mayHaveSubmittedOrder?message+' Order submission outcome is unknown; reconcile first.':message);
 }
 if(!response.ok){
  // A trusted structured preflight response may explicitly certify that no
  // provider POST occurred. Keep this detail for existing order-lock cleanup.
  const message=clean(body?.error)||label+' rejected the request (HTTP '+status+').';
  const error=Error(message) as Error&{notSubmitted?:boolean};
  if(body?.notSubmitted===true)error.notSubmitted=true;
  throw error;
 }
 return body;
}
