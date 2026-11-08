import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TradesHub,tradeNumber,tradeMoney,tradeDate} from './TradingDesk';

const props={venue:'propdao' as const,name:'Gold trend',asset:'GOLDUSDC',created:true,botId:'bot-1',liveAccount:null,liveCheck:'ready',paperStatus:null,onOpenStrategy:()=>undefined,onInspectTrade:()=>undefined};

describe('MT5-style trading desk',()=>{
 it('renders independent open positions, pending orders and closed-trade history',()=>{
  const html=renderToStaticMarkup(<TradesHub {...props} propLive={{brokerExposureVerified:true,deployed:true,running:true,accountId:'prop-1',risk:{equity:1000,roomUsd:50},positions:[{id:'pos-1',symbol:'GOLDUSDC',side:'BUY',qty:0.25,entry:4000,mark:4020,slPrice:3990,tpPrice:4040,unrealizedPnl:5}],pendingOrders:[{id:'ord-1',symbol:'GOLDUSDC',side:'SELL',qty:1,price:4050,type:'LIMIT',status:'PENDING'}],closedTrades:[{id:'closed-1',symbol:'GOLDUSDC',side:'SELL',qty:0.5,entry:4100,exit:4050,pnl:25,fee:0.15,closedAt:1762371000,reason:'target'}]}}/>);
  expect(html).toContain('Open positions');
  expect(html).toContain('Pending orders');
  expect(html).toContain('Trade history');
  expect(html).toContain('pos-1 with AI');
  expect(html).toContain('ord-1 with AI');
  expect(html).toContain('closed-1 with AI');
  expect(html).toContain('Floating P/L');
  expect(html).toContain('Realized P/L');
  expect(html).toContain('LIMIT');
 });
 it('never equates an unresolved order intent with a verified broker pending order',()=>{
  const html=renderToStaticMarkup(<TradesHub {...props} propLive={{brokerExposureVerified:true,pendingOrders:[],positions:[],closedTrades:[],pendingIntent:{intentId:'tv-pending-123'},risk:null}}/>);
  expect(html).toContain('0 records');
  expect(html).toContain('Unresolved order intent');
  expect(html).toContain('not a confirmed provider order');
 });
 it('does not present missing API data as verified zero balances or zero orders',()=>{
  const html=renderToStaticMarkup(<TradesHub {...props} propLive={{deployed:true,accountError:'Upstream unavailable'}}/>);
  expect(html).toContain('Unavailable');
  expect(html).toContain('Pending-order data has not been verified');
  expect(html).toContain('Upstream unavailable');
 });
 it('does not invent trade history for venues without a verified account feed',()=>{
  const html=renderToStaticMarkup(<TradesHub {...props} venue="valr" propLive={null}/>);
  expect(html).toContain('VALR status is connected');
  expect(html).not.toContain('Completed trades');
 });
 it('renders an empty strategy state instead of fabricated trades',()=>{
  const html=renderToStaticMarkup(<TradesHub {...props} created={false} propLive={null}/>);
  expect(html).toContain('Select a robot');
  expect(html).not.toContain('Pending orders');
 });
 it('formats provider numbers and timestamps conservatively',()=>{
  expect(tradeNumber(undefined)).toBe('—');
  expect(tradeMoney(null)).toBe('—');
  expect(tradeMoney(-1.79)).toContain('-$1.79');
  expect(tradeDate(null)).toBe('—');
  expect(tradeDate(-4)).toBe('—');
 });
});
