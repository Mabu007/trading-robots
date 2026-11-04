import {describe,it,expect} from 'vitest';
import {requestsCodeChange,type ChatTurn} from './chat-intent';

describe('chat intent: explain vs edit strategy.js',()=>{
 const discussion=[
  'so as u can see cant it use data that existing instead of it starts and waits to get data for hours to make an indicator why doesnt it get data there e.g it strts at 10am it must have previous data like data all the data it needs plus live data so as it starts it must already be able to calculate indicators and run algos?',
  'am asking a question not saying u should change the strategy',
  'Why does my M1 bot wait before it can make an indicator?',
  'Can it use previous data before it starts to run the algo?',
  'Does the bot calculate the EMA using historical candles?',
  'What if we add RSI? Would the strategy become more stable?',
  'How can I modify my breakout strategy for fewer signals?',
  'Can you explain how to change the strategy.js risk?',
  'Can you describe what the edit strategy function does?',
  'I think the robot should load data before running the indicators',
  'Is my strategy already designed to use previous candles?',
  'Why would you change the signal when the bot is live?',
  'Tell me why stop-loss prices change in backtesting',
  'Should the algorithm use a longer warm-up?',
  'I need an explanation of how the strategy works',
  'Please explain why the strategy should add ATR',
  'How do I add an indicator to strategy.js?',
  'Can you check whether changing the strategy would help?',
  'When you say "please add RSI", does it edit?',
  'My question is whether a script can make use of H1 history',
  'I feel the chat logic is not sophisticated enough so please fix the chatbot',
  'Please fix the Cloudflare runtime to preload candle data',
  'Can you modify the website to show indicator history?',
  'I want you to explain how to rewrite my code',
  'Can you tell me what would change if we add trailing stops?',
  'Okay, why does my robot wait for EMA history?',
  'Nice, can you explain what changing strategy.js would do?',
 ];
 const edits=[
  'Write a full strategy.js with EMA20 and ATR stop',
  'Please modify my strategy to filter out bad breakouts',
  'Edit the existing entry logic to use H1 trend',
  'Change riskReward in the strategy to 1:2',
  'Can you update the strategy.js to include a 200-period EMA?',
  'Could you rewrite my bot to scalp GOLDUSDC M1?',
  'I want you to add ATR to the trading strategy',
  'I need you to implement a trailing stop in my strategy',
  "Let's add a liquidity sweep filter to the entry rules",
  'Please remove the RSI indicator',
  'Fix the strategy code so the onCandle function compiles',
  'Make the bot trade only during London session',
  'Build a breakout trading robot from this strategy',
  'Convert this strategy into a trend-following scalper',
  'Add EMA20 to the existing script',
  'Go ahead and edit strategy.js to use m5 instead of m1',
  'Okay nice, can you update strategy.js to use H1 candles?',
  'pls add EMA20 to my script',
 ];
 it.each(discussion)('answers as discussion: %s',message=>{
  expect(requestsCodeChange(message)).toBe(false);
 });
 it.each(edits)('prepares a strategy edit on explicit instruction: %s',message=>{
  expect(requestsCodeChange(message)).toBe(true);
 });
 it('does not use unrelated assistant messages to turn yes into editing',()=>{
  const history:ChatTurn[]=[{role:'user',content:'Can it use older H1 candles?'},{role:'assistant',content:'Yes, indicators can change using older candles. You may edit the strategy if you choose.'}];
  expect(requestsCodeChange('yes',history)).toBe(false);
 });
 it('accepts a short affirmative only after an explicit offered strategy edit',()=>{
  const history:ChatTurn[]=[{role:'assistant',content:'Would you like me to edit your strategy to use the H1 bias?'}];
  expect(requestsCodeChange('yes',history)).toBe(true);
  expect(requestsCodeChange('no',history)).toBe(false);
 });
 it('does not edit if an explanation explicitly forbids code changes',()=>{
  expect(requestsCodeChange("Do not change strategy.js; I'm only asking why indicators need history")).toBe(false);
 });
});