/** A versioned gzip+base64 transport for large backtest JSON. Never discard candles or trades. */
export type CompressedBacktest = { format:'gzip-base64'; version:2; payload:string; uncompressedBytes:number };
export function isCompressedBacktest(value:unknown):value is CompressedBacktest {
 const v=value as Partial<CompressedBacktest>|null;
 return !!v&&v.format==='gzip-base64'&&v.version===2&&typeof v.payload==='string'&&Number.isInteger(v.uncompressedBytes)&&v.uncompressedBytes!>0;
}
function encodeBase64(bytes:Uint8Array):string {
 let binary='';
 for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(binary);
}
function decodeBase64(input:string):Uint8Array {
 const binary=atob(input);
 const bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return bytes;
}
export async function compressBacktest(state:unknown):Promise<CompressedBacktest> {
 if(typeof CompressionStream==='undefined')throw Error('This browser does not support compressed backtest storage.');
 const bytes=new TextEncoder().encode(JSON.stringify(state));
 const compressed=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
 return {format:'gzip-base64',version:2,payload:encodeBase64(new Uint8Array(compressed)),uncompressedBytes:bytes.byteLength};
}
export async function decompressBacktest<T>(value:CompressedBacktest):Promise<T> {
 if(typeof DecompressionStream==='undefined')throw Error('This browser does not support restoring compressed backtests.');
 if(value.uncompressedBytes>60_000_000)throw Error('Saved backtest exceeds the supported restore size.');
 const binary=decodeBase64(value.payload);
 const body=await new Response(new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(body.byteLength!==value.uncompressedBytes)throw Error('Saved backtest is incomplete or corrupt.');
 return JSON.parse(new TextDecoder().decode(body)) as T;
}
