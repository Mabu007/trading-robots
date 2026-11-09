import {describe,it,expect} from 'vitest';
import {durableTaskIntent} from './agent-task-intent';
describe('chat-first durable task routing',()=>{
 it.each([
  'VIBES, build and trade a Gold scalping strategy.',
  'VIBES, manage my PropDAO demo challenge for five days.',
  'Research Gold and develop a strategy to trade my demo account',
  'We need to pass a PropDAO evaluation, research and test strategies until a credible candidate is found.',
  'Build a trading robot and backtest it across market regimes.'
 ])('recognizes explicit goals: %s',text=>expect(durableTaskIntent(text)).toBe(true));
 it.each(['How is gold doing today?', 'What is a stop loss?', 'Explain a prop firm', 'Is my robot running?', 'Show my strategy code', 'What strategy should we use?', 'Cancel', 'Backtest this robot', ''])('does not hijack normal chat: %s',text=>expect(durableTaskIntent(text)).toBe(false));
});
