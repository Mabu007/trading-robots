export type ChangeLine={kind:'context'|'removed'|'added'|'skip';text:string;oldLine?:number;newLine?:number};
export function strategyDiff(original:string,proposed:string):ChangeLine[]{
 const before=original.split('\n'),after=proposed.split('\n');
 let prefix=0;
 while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
 let suffix=0;
 while(suffix<Math.min(before.length-prefix,after.length-prefix)&&before[before.length-suffix-1]===after[after.length-suffix-1])suffix++;
 const lines:ChangeLine[]=[];
 const add=(kind:ChangeLine['kind'],text:string,oldLine?:number,newLine?:number)=>lines.push({kind,text,oldLine,newLine});
 if(prefix>5)add('skip',`… ${prefix-4} unchanged lines …`);
 for(let i=Math.max(0,prefix-4);i<prefix;i++)add('context',before[i],i+1,i+1);
 for(let i=prefix;i<before.length-suffix;i++)add('removed',before[i],i+1,undefined);
 for(let i=prefix;i<after.length-suffix;i++)add('added',after[i],undefined,i+1);
 for(let i=before.length-suffix;i<Math.min(before.length,before.length-suffix+4);i++)add('context',before[i],i+1,after.length-suffix+(i-(before.length-suffix))+1);
 if(suffix>4)add('skip',`… ${suffix-4} unchanged lines …`);
 return lines;
}
