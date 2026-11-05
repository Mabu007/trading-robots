import {describe,it,expect} from 'vitest';
import {classifyChatCommand} from './chat-commands';

describe('conversational trading tool routing',()=>{
 it.each([
  ['run a backtest','backtest'],
  ['Backtest it!','backtest'],
  ['please test my strategy on historical candles','backtest'],
  ['check my bot status','status'],
  ['what is my bot status?','status'],
  ['can you run a backtest?','backtest'],
  ['can you deploy my bot?','deploy'],
  ['is my robot running?','status'],
  ['deploy this bot','deploy'],
  ['stop my live bot','stop'],
  ['please halt trading','stop'],
 ])('recognises explicit action: %s', (message,expected)=>{
  expect(classifyChatCommand(message)).toBe(expected);
 });
 it.each([
  'what is backtesting?',
  'how do I deploy a robot?',
  'explain my backtest',
  'would you stop the trading bot?',
  'can the agent trade for me?',
  'I want to learn forex',
  'build me a mean reversion strategy',
  'why is my robot stopped?',
 ])('does not execute ordinary discussion: %s',(message)=>{
  expect(classifyChatCommand(message)).toBeNull();
 });
});
