import {describe,it,expect} from 'vitest';
import {parseToolSelection,toolDefinitions} from './chat-tools';
const call=(name:string,args='{}')=>({tool_calls:[{type:'function',function:{name,arguments:args}}]});
describe('chat capability boundary',()=>{
 it('allows defined capabilities without arbitrary parameters',()=>{for(const t of toolDefinitions)expect(parseToolSelection(call(t.function.name))).toBe(t.function.name)});
 it('does not interpret prose as execution',()=>expect(parseToolSelection({content:'I placed a trade'})).toBe(null));
 it.each(['execute_order','fetch','delete_account'])('rejects unknown tool %s',name=>expect(()=>parseToolSelection(call(name))).toThrow());
 it.each(['null','[]','{"uid":"victim"}','{"risk":100}','invalid'])('rejects supplied arguments %s',args=>expect(()=>parseToolSelection(call('deploy',args))).toThrow());
 it('rejects multiple calls',()=>expect(()=>parseToolSelection({tool_calls:[...call('stop').tool_calls,...call('deploy').tool_calls]})).toThrow());
});
