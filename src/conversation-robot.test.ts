import {expect,it} from 'vitest';
import {conversationRobot,semanticChatTitle} from './conversation-robot';
import type {CloudBot} from './firebase';
const bots=[{id:'a',name:'ai 2',venue:'propdao',asset:'GOLDUSDC'},{id:'gold',name:'Gold Digger',venue:'propdao',asset:'GOLDUSDC'}] as CloudBot[];
it('follows the last explicitly named robot in user history, not the open ai 2 editor',()=>{
 const history=[{role:'user',content:'hey'},{role:'assistant',content:'We are editing ai 2'},{role:'user',content:'What do you think about Gold Digger robot?'},{role:'assistant',content:'Gold Digger is a sweep robot'}];
 expect(conversationRobot('make a better version papi',history,bots)?.id).toBe('gold');
 expect(conversationRobot('Edit ai 2 instead',history,bots)?.id).toBe('a');
 expect(semanticChatTitle(history,bots)).toBe('Gold Digger · Robot research');
});
it('does not select one of two robots explicitly named in an ambiguous request',()=>{
 expect(conversationRobot('Update Gold Digger and ai 2',[],bots)).toBeNull();
});
it('refuses to guess a saved bot from AI speech alone',()=>{
 expect(conversationRobot('make a better version',[{role:'assistant',content:'Gold Digger would be good'}],bots)).toBeNull();
});
