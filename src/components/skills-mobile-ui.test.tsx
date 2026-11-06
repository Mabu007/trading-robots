import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {SkillsLibrary} from './SkillsLibrary';
import {ChatModelSelector} from './ChatModelSelector';
import {ChatConversationDialog} from './ChatConversationDialog';
import type {UserSkill} from '../skills';

const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
const firebase=readFileSync(new URL('../firebase.ts',import.meta.url),'utf8');
const mobile=readFileSync(new URL('../mobile-shell-polish.css',import.meta.url),'utf8');
const skills:UserSkill[]=[{id:'skill-abcdef123',name:'Risk research',description:'Verify evidence',instructions:'Do not invent trades.',triggers:['market research'],enabled:true,alwaysOn:false}];
describe('Skills, chat model and mobile shell',()=>{
 it('renders reusable account skills with edit, enable, search and delete',()=>{
  const html=renderToStaticMarkup(<SkillsLibrary skills={skills} busy={false} onSave={async()=>undefined} onDelete={async()=>undefined}/>);
  expect(html).toContain('Risk research');expect(html).toContain('Search skills');expect(html).toContain('View / edit');expect(html).toContain('Delete Risk research');expect(html).toContain('market research');
 });
 it('renders a conversation-specific AI picker and current chosen model',()=>{
  const html=renderToStaticMarkup(<ChatModelSelector client={null} selected="openai/gpt-4o" onSelect={async()=>undefined} onSettings={()=>undefined} disabled={false}/>);
  expect(html).toContain('gpt-4o');expect(html).toContain('Choose a model for this chat');expect(html).toContain('AI model: openai/gpt-4o');
 });
 it('uses confirmation for destructive chat deletion',()=>{
  const html=renderToStaticMarkup(<ChatConversationDialog action={{id:'chat-1',type:'delete',title:'Gold research'}} onClose={()=>undefined} onSubmit={async()=>undefined}/>);
  expect(html).toContain('alertdialog');expect(html).toContain('Gold research');expect(html).toContain('Delete chat');
 });
 it('keeps the selected model when switching chats and forwards it to streaming AI',()=>{
  expect(app).toContain('setConversationModel(record?.model||null)');
  expect(app).toContain('await cloudClient.selectConversationModel(conversationId,model)');
  expect(app).toContain('modelOverride?{model:modelOverride}');
  expect(firebase).toContain('loadConversationRecord:');
  expect(firebase).toContain('selectConversationModel:');
 });
 it('preserves custom titles across auto-saves and tombstones deleted chats per user',()=>{
  expect(firebase).toContain('{messages:payload,updatedAt:storeSdk.serverTimestamp()},{merge:true}');
  expect(firebase).toContain('uid+\':\'+id');
  expect(firebase).toContain("titleEdited:true");
 });
 it('places the actual desktop chat scroller on the outer edge',()=>{
  expect(mobile).toContain('.chat-messages{width:100%!important;max-width:none!important');
  expect(mobile).toContain('scrollbar-gutter:stable');
 });
 it('keeps the mobile header compact and shows Skills/Apps titles without a duplicate logo',()=>{
  expect(mobile).toContain('grid-template-columns:42px minmax(0,1fr) 42px!important');
  expect(mobile).toContain('.tv-mobile-page-label');
  expect(mobile).toContain(".tv-area-you .top-left>.brand-logo");
  expect(app).toContain("primaryArea==='skills'?'Skills'");
 });
});
