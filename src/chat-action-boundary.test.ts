import {describe,it,expect} from 'vitest';
import {explicitBacktestRequest,explicitActionRequest,isPendingCreateAnswer,isPendingRobotChoice,needsLiveBotContext} from './chat-action-boundary';
describe('AI-first action safety and conversational intent',()=>{
 it.each(['any trades yet?','am talking about now, not the backtest','papi whats wrong with u','what is happening with ai 2 today?','are there any live positions?','why no trades?','how did the backtest do?','no, I mean live trades','does my robot backtest itself?','tell me about the backtest','can we discuss running a backtest?'])
 ('does not launch an action from %s',message=>{expect(explicitBacktestRequest(message)).toBe(false);expect(explicitActionRequest(message)).toBe(false)});
 it.each(['Backtest ai 2 from 2026-10-01 to 2026-10-31','please run a backtest for ai 2','could you run another backtest?'])
 ('allows explicitly requested backtests: %s',message=>{expect(explicitBacktestRequest(message)).toBe(true);expect(explicitActionRequest(message)).toBe(true)});
 it('pending UI requests do not hijack unrelated questions',()=>{
  expect(isPendingCreateAnswer('papi whats wrong with u')).toBe(false);
  expect(isPendingCreateAnswer('PropDAO GOLDUSDC')).toBe(true);
  expect(isPendingRobotChoice('no bro, I mean live',['ai 2','ai 1'])).toBe(false);
  expect(isPendingRobotChoice('ai 2',['ai 2','ai 1'])).toBe(true);
  expect(needsLiveBotContext('any trades yet?')).toBe(true);
 });
});
