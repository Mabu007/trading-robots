import {describe,it,expect} from 'vitest';
import {composioIdentity,isConnectedAppToolkit,connectedAppToolkits} from './composio-apps.ts';
describe('Composio account security',()=>{
 it('isolates users',()=>{expect(composioIdentity('alice')).not.toBe(composioIdentity('bob'));expect(composioIdentity('alice')).toBe('trading-vibes:alice');});
 it('disallows broker order toolkits',()=>{for(const venue of ['ctrader','propdao','valr','hyperliquid','unknown'])expect(isConnectedAppToolkit(venue)).toBe(false);expect(connectedAppToolkits).toContain('telegram');});
});
