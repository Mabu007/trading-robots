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
 it('labels live activity only when execution is confirmed and never labels backtest rows live',()=>{const running={runtime:{running:true},live:false};const inactive=renderToStaticMarkup(createElement(OutputDock,{...props,liveStatus:running,liveExecutions:[]}));expect(inactive).not.toContain('(LIVE · DEMO)');expect(inactive).toContain('execution not confirmed');const active=renderToStaticMarkup(createElement(OutputDock,{...props,liveStatus:{...running,live:true},liveExecutions:[]}));expect(active).toContain('(LIVE · DEMO)');expect(active).not.toContain('RISK AT STOP')});
});
