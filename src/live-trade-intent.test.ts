import {it,expect} from 'vitest';
import {wantsLiveTradeEvidence} from './live-trade-intent';
it.each(['why m i incurring so many loses','why am i losing so many trades','any trades yet?','how is my pnl now?','why are the recent trades stopping out?','I mean LIVE, not backtest losses','why is my robot in drawdown'])('requests authenticated read for %s',s=>expect(wantsLiveTradeEvidence(s)).toBe(true));
it.each(['Why did the backtest lose?','Check October historical results','Explain 25R from our saved backtest','Hello papi','Build a strategy for Gold'])('does not misinterpret backtesting or generic chat: %s',s=>expect(wantsLiveTradeEvidence(s)).toBe(false));
