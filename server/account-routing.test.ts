import {describe,it,expect} from 'vitest';
import {ownedAccounts,resolveOwnedAccount,type OwnedBrokerAccount} from './account-routing.ts';
const records:OwnedBrokerAccount[]=[
  {ownerUid:'u1',connectionId:'p1',brokerAccountId:'A',venueId:'propdao'},
  {ownerUid:'u1',connectionId:'c1',brokerAccountId:'B',venueId:'ctrader'},
  {ownerUid:'u2',connectionId:'p2',brokerAccountId:'A',venueId:'propdao'}
];
describe('broker account isolation',()=>{
  it('resolves only the selected owned target',()=>expect(resolveOwnedAccount('u1',records,{connectionId:'p1',brokerAccountId:'A',venueId:'propdao'})).toBe(records[0]));
  it('rejects implicit last-used account',()=>expect(()=>resolveOwnedAccount('u1',records,{brokerAccountId:'A',venueId:'propdao'})).toThrow());
  it('rejects another user account',()=>expect(()=>resolveOwnedAccount('u1',records,{connectionId:'p2',brokerAccountId:'A',venueId:'propdao'})).toThrow(/verified/));
  it('rejects wrong venue',()=>expect(()=>resolveOwnedAccount('u1',records,{connectionId:'c1',brokerAccountId:'B',venueId:'propdao'})).toThrow(/verified/));
  it('rejects duplicate targets',()=>expect(()=>resolveOwnedAccount('u1',[...records,records[0]],{connectionId:'p1',brokerAccountId:'A',venueId:'propdao'})).toThrow(/uniquely/));
  it('aggregates only owned accounts',()=>expect(ownedAccounts('u1',records)).toHaveLength(2));
});
