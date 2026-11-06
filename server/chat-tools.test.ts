import {describe,it,expect} from 'vitest';
import {parseToolSelection,parsePlannedAction,toolDefinitions} from './chat-tools';
const call=(name:string,args='{}')=>({tool_calls:[{type:'function',function:{name,arguments:args}}]});
describe('chat capability boundary',()=>{
 it('allows read and execution-review capabilities without arbitrary parameters',()=>{for(const t of toolDefinitions.filter(t=>!['manage_skill','edit_personality','rename_code','delete_code','manage_broker'].includes(t.function.name)))expect(parseToolSelection(call(t.function.name))).toBe(t.function.name)});
 it('accepts bounded proposed changes and rejects cross-account or incomplete arguments',()=>{
  const skill={action:'create',name:'Risk notes',instructions:'Explain position risk.'};
  expect(parsePlannedAction(call('manage_skill',JSON.stringify(skill)))).toEqual({tool:'manage_skill',args:skill});
  expect(()=>parsePlannedAction(call('manage_skill',JSON.stringify({...skill,uid:'another-user'})))).toThrow();
  expect(()=>parsePlannedAction(call('manage_skill',JSON.stringify({action:'create',name:'Empty'})))).toThrow();
  expect(()=>parsePlannedAction(call('edit_personality',JSON.stringify({instructions:'x'.repeat(4001)})))).toThrow();
 });
 it('does not interpret prose as execution',()=>expect(parseToolSelection({content:'I placed a trade'})).toBe(null));
 it.each(['execute_order','fetch','delete_account'])('rejects unknown tool %s',name=>expect(()=>parseToolSelection(call(name))).toThrow());
 it.each(['null','[]','{"uid":"victim"}','{"risk":100}','invalid'])('rejects supplied arguments %s',args=>expect(()=>parseToolSelection(call('deploy',args))).toThrow());
 it('rejects multiple calls',()=>expect(()=>parseToolSelection({tool_calls:[...call('stop').tool_calls,...call('deploy').tool_calls]})).toThrow());
});
