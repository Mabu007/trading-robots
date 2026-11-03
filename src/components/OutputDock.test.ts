import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OutputDock } from './OutputDock';
import { simulate } from '../engine';
import { simulateMoney } from '../monetary-backtest';
const c=(time:number,open:number,high:number,low:number,close:number)=>({time,open,high,low,close,volume:1});
const candles=[c(1,100,101,99,100),c(2,100,102,99.5,101)],decisions=[{action:'BUY',stopLoss:99,takeProfit:102}];
const result=simulate(candles,decisions),monetary=simulateMoney(candles,decisions,500,5,{contractSize:1,minVolume:1,volumeStep:1,quoteToZar:1,spread:0,slippage:0,commissionPerLotZar:0});
const noop=()=>{};
const props:any={asset:'XAUUSD',timeframe:'m1',from:'2026-01-01',to:'2026-01-02',logs:[],result,monetary,selectedTrade:monetary.trades[0],showTradeModal:true,busy:'',active:'trades',collapsed:false,onTabChange:noop,onCollapse:noop,onClear:noop,onDeleteBacktest:async()=>{},onStop:noop,onSelectTrade:noop,onClearSelectedTrade:noop,onAuditTrade:noop,versions:[],versionsLoading:false,versionError:'',onLoadVersion:noop,onRenameVersion:async()=>{},onDeleteVersion:async()=>{},compact:true};
describe('workspace results presentation',()=>{
 it('puts simulated money and stop risk into the selected monetary trade',()=>{const markup=renderToStaticMarkup(createElement(OutputDock,props));expect(markup).toContain('NET PROFIT / LOSS');expect(markup).toContain('RISK AT STOP');expect(markup).toContain('RISK BUDGET');expect(markup).toContain(new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(50));expect(markup).toContain(new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(25))});
 it('shows money results first and keeps R as a clearly separate theoretical detail',()=>{const markup=renderToStaticMarkup(createElement(OutputDock,{...props,active:'results',showTradeModal:false}));expect(markup).toContain('MONEY BACKTEST');expect(markup.indexOf('Money results')).toBeLessThan(markup.indexOf('View theoretical R results'))});
 it('keeps simulated trades explicitly separate from live account activity',()=>{const markup=renderToStaticMarkup(createElement(OutputDock,props));expect(markup).toContain('Backtest trades');expect(markup).not.toContain('(LIVE');expect(markup).toContain('RISK AT STOP')});
 it('shows actual PropDAO positions and closed trades instead of saved backtest results in LIVE mode',()=>{
  const live={running:true,deployed:true,events:['Candle m1 · signal WAIT'],positions:[{id:'pos-1',symbol:'BTCUSDC',side:'BUY',qty:0.01,entry:100,mark:102,unrealizedPnl:0.02,slPrice:90,tpPrice:110}],closedTrades:[{id:'hist-1',symbol:'BTCUSDC',side:'SELL',qty:0.01,entry:110,exit:100,pnl:0.1,closedAt:Date.now(),reason:'Take Profit'}]};
  const markup=renderToStaticMarkup(createElement(OutputDock,{...props,active:'trades',liveMode:true,propLive:live,isPropDAO:true,propEvaluation:null,selectedTrade:null}));
  expect(markup).toContain('LIVE Trades');expect(markup).toContain('OPEN POSITIONS');expect(markup).toContain('CLOSED TRADES');expect(markup).toContain('BTCUSDC');expect(markup).toContain('Inspect open BTCUSDC position pos-1');expect(markup).toContain('Inspect closed BTCUSDC trade hist-1');
  expect(markup).not.toContain('Backtest trades');expect(markup).not.toContain('Delete saved backtest');
 });
});
