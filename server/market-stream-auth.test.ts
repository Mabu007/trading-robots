import {describe,it,expect} from 'vitest';
import {mintMarketStreamProtocol} from './market-stream-auth.ts';
import {verifyStreamProtocol} from '../workers/market-data-stream-auth.ts';
describe('short-lived per-user read-only Hyperliquid stream grants',()=>{
 const secret='a-unique-isolated-test-secret-at-least-32-characters';
 it('verifies only signed, unexpired public market subscriptions',async()=>{
  const token=mintMarketStreamProtocol('firebase-test-user',secret,100000);
  expect(await verifyStreamProtocol('tv-market-v1, '+token,secret,100100)).toBe(true);
  expect(await verifyStreamProtocol(token,secret,160000)).toBe(false);
  expect(await verifyStreamProtocol(token,secret,99999)).toBe(false);
  expect(await verifyStreamProtocol(token.replace('auth.','auth.X'),secret,100100)).toBe(false);
  expect(await verifyStreamProtocol(token,secret+'other',100100)).toBe(false);
 });
 it('refuses short shared credentials and missing uid',()=>{
  expect(()=>mintMarketStreamProtocol('',secret)).toThrow();
  expect(()=>mintMarketStreamProtocol('x','bad-secret')).toThrow();
 });
});

