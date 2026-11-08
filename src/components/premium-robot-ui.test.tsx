import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CloudClient} from '../firebase';
import {StrategyWorkbench} from './StrategyWorkbench';
import {DeployedRobotInspector} from './DeployedRobotInspector';
import {PropDAODeployDialog} from './Marketplace';
import type {PersistentAgent} from '../agents';
import {BacktestChatCard,type BacktestCardData} from './BacktestChatCard';

const noOp=()=>undefined;
describe('premium robot beta surfaces',()=>{
 it('renders full UTC research range and useful quick ranges in workbench',()=>{
  const html=renderToStaticMarkup(createElement(StrategyWorkbench,{
   bot:null,client:{} as CloudClient,initialView:'backtest',onSaved:noOp,onDeploy:noOp,onClose:noOp
  }));
  expect(html).toContain('Backtest date range');
  expect(html).toContain('From (UTC)');
  expect(html).toContain('To (UTC)');
  expect(html).toContain('Yesterday');
  expect(html).toContain('7 days');
  expect(html).toContain('30 days');
  expect(html).toContain('Run backtest');
 });
 it('has a clickable Deploy action and visible prerequisites before server authorization',()=>{
  const html=renderToStaticMarkup(createElement(PropDAODeployDialog,{
   client:{} as CloudClient,botId:'demo-bot',onClose:noOp,onLog:noOp
  }));
  expect(html).toContain('Deploy robot');
  expect(html).toContain('>Deploy</button>');
  expect(html).toContain('Choose a PropDAO account');
  expect(html).not.toContain('Review exact deployment');
 });
 it('shows UTC and South African time for both trade entry and exit',()=>{
  const card:BacktestCardData={
   botId:'a',name:'Gold',asset:'GOLDUSDC',venue:'propdao',
   from:'2026-10-19',to:'2026-10-19',completedAt:'2026-10-20T00:00:00Z',
   metrics:{trades:1},candleCount:100,
   trades:[{id:1,side:'LONG',entryTime:Date.parse('2026-10-19T09:02:00Z')/1000,
    exitTime:Date.parse('2026-10-19T09:22:00Z')/1000,entry:4200,exit:4202,pnl:2,reason:'target'}]
  };
  const html=renderToStaticMarkup(createElement(BacktestChatCard,{data:card,onInspect:noOp}));
  expect(html).toContain('Opened · UTC (SAST)');
  expect(html).toContain('Closed · UTC (SAST)');
  expect(html).toContain('09:02 UTC');
  expect(html).toContain('11:02 SAST');
  expect(html).toContain('09:22 UTC');
  expect(html).toContain('11:22 SAST');
 });
 it('does not pretend a broker read is verified when status data is missing',()=>{
  const agent={
   id:'ag-1',botId:'a',name:'Gold Robot',asset:'GOLDUSDC',venue:'propdao',ownerUid:'owner',
   schemaVersion:1,mode:'live',state:'running',strategy:{version:'1',codeHash:'abc',revision:1},
   configuration:{timeframes:['m1'],executionTimeframe:'m1',riskPercent:1,riskReward:2},
   permissions:{marketDataRead:true,backtests:true,strategyProposals:true,brokerStateRead:true,paperExecution:true,liveExecution:true,executionManagement:true},
   createdAt:1,updatedAt:1,lastEventAt:1,deployment:{grantId:'grant-1',authorizedAt:1,expiresAt:50000,limits:{}}
  } satisfies PersistentAgent;
  const html=renderToStaticMarkup(createElement(DeployedRobotInspector,{
   client:{} as CloudClient,agent,onClose:noOp,onRefreshAgents:noOp,
   onStop:async()=>({authorizationRevoked:false})
  }));
  expect(html).toContain('Broker exposure');
  expect(html).toContain('Unknown / not independently verified');
  expect(html).toContain('Account risk room');
  expect(html).toContain('Not metered per robot');
 });
});
