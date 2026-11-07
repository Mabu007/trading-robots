import {expect,it} from 'vitest';
import {chatBacktestDates} from './chat-backtest-dates';

it('preserves explicit UTC days and refuses to substitute invalid dates',()=>{
 expect(chatBacktestDates('Test Gold from 2026-10-26 to 2026-10-31')).toEqual({from:'2026-10-26',to:'2026-10-31'});
 expect(chatBacktestDates('Test Gold on 2026-10-26')).toEqual({from:'2026-10-26',to:'2026-10-26'});
 expect(chatBacktestDates('Backtest using the saved dates')).toBeNull();
 expect(()=>chatBacktestDates('From 2026-02-30 to 2026-03-12')).toThrow('valid UTC');
 expect(()=>chatBacktestDates('From 2026-03-12 to 2026-03-01')).toThrow('valid UTC');
});
