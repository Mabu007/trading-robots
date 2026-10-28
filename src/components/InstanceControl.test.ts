import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstanceControl } from './InstanceControl';
import type { LiveReadiness } from '../live-status';

const base = {
  bot: {id:'bot',name:'Gold',asset:'XAUUSD',privateBotId:'private',published:false},
  runtime: {available:true,deployed:true,running:false},
  broker: {environment:'demo',accountVerified:true,mappingVerified:true,sourceMatches:true,permission:true},
  locked:false, live:false, observedAt:Date.now(),
} as LiveReadiness;
const callbacks={onControl:vi.fn(),onSetup:vi.fn(),onRefresh:vi.fn()};
const render=(status:LiveReadiness|null, extra:Record<string,unknown>={})=>renderToStaticMarkup(createElement(InstanceControl,{status,check:'ready',pending:null,workBusy:false,...callbacks,...extra}));

describe('instance control',()=>{
  it('only shows a control for a deployed or potentially running instance',()=>{
    expect(render(null)).toBe('');
    expect(render({...base,runtime:{available:true,deployed:false,running:false}})).toBe('');
    expect(render(base)).toContain('aria-label="Start bot"');
  });
  it('offers stop even when the broker is offline and explains open positions remain open',()=>{
    const html=render({...base,locked:true,runtime:{available:true,deployed:true,running:true},broker:{...base.broker,accountVerified:false}}, {workBusy:true});
    expect(html).toContain('aria-label="Stop bot"');
    expect(html).toContain('Existing positions remain open');
    expect(html).not.toContain('disabled');
  });
  it('routes a stopped bot with a changed or unverified source to broker setup',()=>{
    const html=render({...base,broker:{...base.broker,sourceMatches:false}});
    expect(html).toContain('aria-label="Set up broker to start bot"');
    expect(html).toContain('Connect the original demo account');
  });
  it('sends the right action and routes a missing broker to setup',()=>{
    const onControl=vi.fn(),onSetup=vi.fn(),onRefresh=vi.fn(),common={check:'ready' as const,pending:null,workBusy:false,onControl,onSetup,onRefresh};
    const stopped=InstanceControl({...common,status:base})!;
    (stopped.props as {onClick:()=>void}).onClick();expect(onControl).toHaveBeenCalledWith('start');
    const running=InstanceControl({...common,status:{...base,runtime:{available:true,deployed:true,running:true}}})!;
    (running.props as {onClick:()=>void}).onClick();expect(onControl).toHaveBeenCalledWith('stop');
    const missing=InstanceControl({...common,status:{...base,broker:{...base.broker,sourceMatches:false}}})!;
    (missing.props as {onClick:()=>void}).onClick();expect(onSetup).toHaveBeenCalledOnce();
  });
  it('never reports an unknown instance as stopped and blocks duplicate commands',()=>{
    const unknown=render({...base,locked:true,runtime:{available:false}});
    expect(unknown).toContain('Check status');
    expect(unknown).not.toContain('Stop bot');
    const pending=render(base,{pending:'start'});
    expect(pending).toContain('Starting…');
    expect(pending).toContain('disabled');
  });
});
