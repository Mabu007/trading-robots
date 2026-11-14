import {describe,it,expect,afterEach,vi} from 'vitest';
import {saveLocalWorkspace,getLocalWorkspace,listLocalWorkspaces,renameLocalWorkspace,clearLocalWorkspaces,formatPracticeDuration} from './replay-sessions';
import type {StoredReplayWorkspace} from './replay-sessions';
const fake=()=>{
 const rows=new Map<string,string>();
 return {getItem:(key:string)=>rows.get(key)||null,setItem:(key:string,value:string)=>{rows.set(key,value)},removeItem:(key:string)=>{rows.delete(key)},rows};
};
const make=(id:string,day='2026-11-13'):StoredReplayWorkspace=>({
 version:5,id,day,asset:'XAUUSD',name:'Gold practice '+id,firstTimestamp:100,lastTimestamp:500,
 firstIndex:1,session:{index:4,trades:[],balance:10000} as any,notes:'',costs:{currency:'ZAR'} as any,
 annotations:{},startedAt:'2026-11-13T10:00:00Z',elapsedSeconds:3750,lastActiveAt:'2026-11-13T11:02:30Z'
});
afterEach(()=>vi.unstubAllGlobals());
describe('persistent replay workspaces',()=>{
 it('keeps independently named sessions on the same historical day',()=>{
  vi.stubGlobal('localStorage',fake());
  saveLocalWorkspace('uid',make('first'));saveLocalWorkspace('uid',make('second'));
  expect(listLocalWorkspaces('uid')).toHaveLength(2);
  expect(getLocalWorkspace('uid','first')?.session.index).toBe(4);
  expect(getLocalWorkspace('uid','second')?.name).toContain('second');
  expect(renameLocalWorkspace('uid','first','   My London session   ')).toBe(true);
  expect(getLocalWorkspace('uid','first')?.name).toBe('My London session');
  expect(getLocalWorkspace('someone-else','first')).toBeNull();
  clearLocalWorkspaces('uid');
  expect(listLocalWorkspaces('uid')).toEqual([]);
  expect(getLocalWorkspace('uid','first')).toBeNull();
 });
 it('formats elapsed practice time without imposing a session limit',()=>{
  expect(formatPracticeDuration(0)).toBe('0m');
  expect(formatPracticeDuration(3661)).toBe('1h 01m');
  expect(formatPracticeDuration(800*3600)).toBe('800h 00m');
 });
});
