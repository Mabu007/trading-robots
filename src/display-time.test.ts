import {expect,it} from 'vitest';
import {displayTime} from './display-time';

it('shows UTC first, then South African time, including a local date rollover',()=>{
 expect(displayTime('2026-11-07T13:46:00Z')).toBe('7 Nov 2026, 13:46 UTC (15:46 SAST)');
 expect(displayTime(Date.parse('2026-11-07T23:00:00Z'))).toBe('7 Nov 2026, 23:00 UTC (8 Nov 2026, 01:00 SAST)');
 expect(displayTime('invalid')).toBe('—');
});
