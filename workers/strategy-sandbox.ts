import { STRATEGY_RUNTIME_SOURCE } from '../src/strategy-runtime';

// QuickJS runs user strategy code inside a WebAssembly VM with no host APIs,
// credentials, bindings or network. Inputs and outputs cross as JSON only.
// The interpreter's instruction interrupt is count-based because Cloudflare's
// wall clock does not advance reliably during synchronous computation.
type Vm = { evalCode:(code:string,options:{memoryLimitBytes:number;shouldInterrupt:()=>boolean})=>unknown };
export function evaluateStrategyInSandbox(vm:Vm,code:string,datasets:Record<string,unknown[]>,config:Record<string,unknown>){
 if(typeof code!=='string'||!code.trim()||code.length>180_000)throw Error('Invalid strategy source');
 const source=code.replace(/export\s+const\s+config\s*=/,'const config =').replace(/export\s+function\s+onCandle\s*\(/,'function onCandle(');
 const runtime=STRATEGY_RUNTIME_SOURCE.replace('export async function evaluate','function evaluate').replace('const strategy = await loadStrategy(', 'const strategy = loadStrategy(');
 const data=JSON.stringify({code,datasets,config});
 if(data.length>12_000_000)throw Error('Strategy history exceeds sandbox limit');
 const program=`${runtime}\n(()=>{const input=${data};const loadStrategy=(Date,Math,performance)=>{\n${source}\n;return {config,onCandle};};return JSON.stringify(evaluate(loadStrategy,input.code,input.datasets,input.config));})()`;
 let interrupts=0;
 let result:unknown;
 try { result=vm.evalCode(program,{memoryLimitBytes:32*1024*1024,shouldInterrupt:()=>++interrupts>1000}); }
 catch { throw Error('Strategy failed or exceeded its sandbox limits'); }
 if(typeof result!=='string')throw Error('Strategy returned an invalid result');
 let decisions:unknown;
 try{decisions=JSON.parse(result)}catch{throw Error('Strategy returned invalid JSON')}
 if(!Array.isArray(decisions))throw Error('Strategy returned invalid decisions');
 return decisions;
}
