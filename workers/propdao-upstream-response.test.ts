import {describe,it,expect} from 'vitest';
import {parseUpstreamJson,retryableReadError,TemporaryReadError} from './propdao-upstream-response';

const plain=(text:string,status:number)=>new Response(text,{status,headers:{'content-type':'text/plain'}});
describe('PropDAO live upstream response classification',()=>{
 it('continues after a Cloudflare 520 plain-text account snapshot instead of exposing a JSON syntax error',async()=>{
  const error=await parseUpstreamJson(plain('error code: 520 ',520),'Control API').catch(e=>e);
  expect(error).toBeInstanceOf(TemporaryReadError);
  expect(retryableReadError(error)).toBe(true);
  expect(error.message).toContain('HTTP 520');
  expect(error.message).not.toContain('Unexpected token');
 });
 it('accepts a valid JSON read and retains its data',async()=>{
  const snapshot=await parseUpstreamJson(Response.json({account:{status:'active'},positions:[],orders:[]}),'Control API');
  expect(snapshot.account.status).toBe('active');
 });
 it('recovers from malformed 200 OK JSON on read-only candle requests',async()=>{
  const error=await parseUpstreamJson(plain('error code: 520',200),'Hyperliquid market data').catch(e=>e);
  expect(retryableReadError(error)).toBe(true);
 });
 it('does not classify a 401 authentication error as a temporary provider outage',async()=>{
  const error=await parseUpstreamJson(Response.json({error:'Invalid account credentials'},{status:401}),'Control API').catch(e=>e);
  expect(retryableReadError(error)).toBe(false);
  expect(error.message).toMatch(/Invalid account credentials/);
 });
 it('continues after an upstream rate-limit before the order submission phase',async()=>{
  const error=await parseUpstreamJson(plain('rate limit',429),'Hyperliquid market data').catch(e=>e);
  expect(retryableReadError(error)).toBe(true);
 });
 it('never automatically retries an uncertain order submission after a 520',async()=>{
  const error=await parseUpstreamJson(plain('error code: 520 ',520),'Control API',{mayHaveSubmittedOrder:true}).catch(e=>e);
  expect(retryableReadError(error)).toBe(false);
  expect(error.message).toMatch(/Order submission outcome is unknown/);
 });
 it('never automatically retries an uncertain order submission after a malformed 200',async()=>{
  const error=await parseUpstreamJson(plain('not JSON',200),'Control API',{mayHaveSubmittedOrder:true}).catch(e=>e);
  expect(retryableReadError(error)).toBe(false);
  expect(error.message).toMatch(/Order submission outcome is unknown/);
 });
 it('retains a trusted pre-submission confirmation for safe order-lock cleanup',async()=>{
  const response=Response.json({error:'Order preflight rejected due to exposure',notSubmitted:true},{status:409});
  const error=await parseUpstreamJson(response,'Control API',{mayHaveSubmittedOrder:true}).catch(e=>e);
  expect(error.notSubmitted).toBe(true);
  expect(retryableReadError(error)).toBe(false);
 });
 it('does not trust an unstructured 4xx as evidence no order was sent',async()=>{
  const error=await parseUpstreamJson(plain('invalid',400),'Control API',{mayHaveSubmittedOrder:true}).catch(e=>e);
  expect(error.notSubmitted).not.toBe(true);
  expect(retryableReadError(error)).toBe(false);
 });
 it('never exposes arbitrary upstream body text in a log message',async()=>{
  const error=await parseUpstreamJson(plain('<html>SECRET_TOKEN_NEVERSHOW</html>',502),'Control API').catch(e=>e);
  expect(error.message).not.toContain('SECRET_TOKEN_NEVERSHOW');
 });
});
