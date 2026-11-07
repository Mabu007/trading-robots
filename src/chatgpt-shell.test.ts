import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('./App.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('./chatgpt-shell.css',import.meta.url),'utf8');

describe('seamless workspace layout',()=>{
 it('uses only the header sidebar toggle and no duplicated sidebar-brand toggle',()=>{
  expect(app).toContain('className="icon-button tv-sidebar-toggle"');
  expect(app).not.toContain('aria-label="Collapse sidebar"');
  expect(app.match(/className="icon-button tv-sidebar-toggle"/g)?.length).toBe(1);
 });
 it('uses one scroll container for Strategy, Apps, and chats',()=>{
  const start=app.indexOf('<div className="tv-sidebar-scroll">');
  const code=app.indexOf('<span>Strategy</span>',start);
  const skills=app.indexOf('<span>Skills</span>',start);
  const apps=app.indexOf('<span>Apps</span>',start);
  const chats=app.indexOf('className="tv-sidebar-chats"',start);
  const close=app.indexOf('</div><footer className="tv-sidebar-profile">',start);
  expect(start).toBeGreaterThan(0);
  expect(code).toBeGreaterThan(start);
  expect(skills).toBeGreaterThan(code);
  expect(apps).toBeGreaterThan(skills);
  expect(chats).toBeGreaterThan(apps);
  expect(app).not.toContain('className="tv-sidebar-strategies"');
  expect(app).not.toContain('<span>Scheduled</span>');
  expect(close).toBeGreaterThan(chats);
  expect(css).toContain('.tv-sidebar-scroll{display:block;flex:1 1 auto;min-height:0;overflow-y:auto');
 });
 it('does not render idle runtime, completed-backtest or default test cards in chat',()=>{
  expect(app).not.toContain('aria-label="Runtime status"');
  expect(app).not.toContain('aria-label="Latest backtest"');
  expect(app).not.toContain('aria-label="Backtest action"');
  expect(app).toContain('aria-label="Trading operation review"');
 });
 it('retains header toggle in the closed-sidebar layout',()=>{
  expect(css).toContain('.tv-sidebar-toggle{visibility:visible;opacity:1');
  expect(css).toContain('.topbar,:root[data-theme="dark"] .studio.tv-chat-first .topbar{border:0');
 });
});
