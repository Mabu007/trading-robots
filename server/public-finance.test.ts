import {describe,expect,it} from 'vitest';
import {fetchPublicSource,isPublicResearchIp} from './public-finance.ts';

describe('public research network boundary',()=>{
 it('rejects loopback, private, carrier-grade NAT, link-local and mapped addresses',async()=>{
  for(const ip of ['127.0.0.1','10.2.3.4','192.168.1.1','172.31.0.1','100.64.0.1','169.254.169.254','::ffff:127.0.0.1'])expect(isPublicResearchIp(ip)).toBe(false);
  expect(isPublicResearchIp('8.8.8.8')).toBe(true);
  for(const url of ['http://example.com','https://127.0.0.1','https://169.254.169.254','https://abc.example.com:8443','https://name:password@example.com','https://example.com/?api_key=secret'])await expect(fetchPublicSource(url)).rejects.toThrow();
 });
});
