import {describe,it,expect,vi} from 'vitest';
import {AiOutputLimitError} from './api';
import {generateStrategyWithRecovery} from './strategy-ai-generation';
import {starterCode} from './strategy';

const signal=new AbortController().signal;
const generate=(request:(messages:any[],signal:AbortSignal)=>Promise<string>)=>generateStrategyWithRecovery({
  system:'Generate a strategy.js',user:'Make a momentum strategy',signal,request
});
describe('AI strategy generation recovery',()=>{
  it('accepts a valid completed JavaScript strategy',async()=>{
    await expect(generate(async()=>starterCode)).resolves.toBe(starterCode.trim());
  });
  it('continues output after a provider length limit and validates complete code',async()=>{
    const partial=starterCode.slice(0,200),remaining=starterCode.slice(200);
    const request=vi.fn().mockRejectedValueOnce(new AiOutputLimitError(partial)).mockResolvedValueOnce(remaining);
    await expect(generate(request)).resolves.toBe(starterCode.trim());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0][1].content).toContain('Continue the following JavaScript response');
  });
  it('repairs malformed config with a complete validated fresh draft',async()=>{
    const request=vi.fn().mockResolvedValueOnce('export const config = {}; export function onCandle(){}').mockResolvedValueOnce(starterCode);
    await expect(generate(request)).resolves.toBe(starterCode.trim());
    expect(request.mock.calls[1][0][1].content).toContain('failed local validation');
  });
  it('never accepts invalid or repeatedly truncated output as saved code',async()=>{
    const request=vi.fn().mockImplementation(async()=>{throw new AiOutputLimitError('export const config = {');});
    await expect(generate(request)).rejects.toThrow('existing code was not changed');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('propagates provider authorization or network errors',async()=>{
    await expect(generate(async()=>{throw Error('OpenRouter API key expired')})).rejects.toThrow('OpenRouter API key expired');
  });
});
