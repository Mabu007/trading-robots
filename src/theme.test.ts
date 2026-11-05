import {describe,expect,it} from 'vitest';
import {normalizeTheme,readThemePreference,saveThemePreference} from './theme';

describe('appearance preference',()=>{
 it('defaults to light mode and ignores unknown stored values',()=>{
  expect(normalizeTheme(null)).toBe('light');
  expect(readThemePreference({getItem:()=>null})).toBe('light');
  expect(readThemePreference({getItem:()=> 'system'})).toBe('light');
 });
 it('restores dark mode when selected and persists the next choice',()=>{
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value)}};
  values.set('trading-vibes:theme','dark');
  expect(readThemePreference(storage)).toBe('dark');
  saveThemePreference('light',storage);
  expect(readThemePreference(storage)).toBe('light');
 });
 it('falls back safely when browser storage is unavailable',()=>{
  expect(readThemePreference({getItem:()=>{throw Error('blocked')}})).toBe('light');
  expect(()=>saveThemePreference('dark',{setItem:()=>{throw Error('blocked')}})).not.toThrow();
 });
});
