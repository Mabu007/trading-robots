export async function gatewayRequest(action:string,body:any){
  if(!process.env.CTRADER_GATEWAY_URL||!process.env.TRADING_INTERNAL_SECRET)throw Error('The persistent cTrader gateway is not configured.');
  const response=await fetch(new URL(`/rpc/${action}`,process.env.CTRADER_GATEWAY_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.TRADING_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const data=await response.json() as any;if(!response.ok)throw Error(data.error||'Broker gateway is unavailable.');return data;
}
export async function gatewayHealth(){
  if(!process.env.CTRADER_GATEWAY_URL||!process.env.TRADING_INTERNAL_SECRET)throw Error('Broker gateway is not configured.');
  const response=await fetch(new URL('/health',process.env.CTRADER_GATEWAY_URL),{headers:{Authorization:`Bearer ${process.env.TRADING_INTERNAL_SECRET}`},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Broker gateway health is unavailable.');
  const data=await response.json() as any;
  return { demoConnected:data.demo?.connected===true, demoLastMessageAt:Number(data.demo?.lastMessageAt)||null, demoExecutionEnabled:data.demoExecutionEnabled===true, realMoneyEnabled:data.realMoneyEnabled===true };
}
