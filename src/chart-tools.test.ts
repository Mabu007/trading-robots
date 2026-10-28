import { afterEach, describe, expect, it, vi } from 'vitest';
import { installChartTools } from './chart-tools';

class FakeElement extends EventTarget {
  children:FakeElement[]=[]; style:Record<string,string>={}; attributes:Record<string,string>={}; textContent=''; innerHTML=''; className=''; open=false; clientWidth=400; clientHeight=200;
  classList={add:()=>{},remove:()=>{},toggle:()=>{}};
  appendChild<T extends FakeElement>(child:T):T{this.children.push(child);return child}
  setAttribute(key:string,value:string){this.attributes[key]=value}
  contains(target:unknown):boolean{return this===target||this.children.some(c=>c.contains(target))}
  replaceChildren(...children:FakeElement[]){this.children=children}
  cloneNode(){const el=new FakeSvg();el.attributes={...this.attributes};return el}
  remove(){} setPointerCapture(){} getBoundingClientRect(){return {left:0,top:0}}
}
class FakeSvg extends FakeElement {}
function pointer(type:string,x:number,y:number){const e=new Event(type,{cancelable:true});Object.assign(e,{clientX:x,clientY:y,button:0,pointerId:1});return e}
function find(el:FakeElement,predicate:(e:FakeElement)=>boolean):FakeElement|undefined {if(predicate(el))return el;for(const child of el.children){const result=find(child,predicate);if(result)return result}}
const candles=Array.from({length:20},(_,i)=>({time:1000+i*60,open:100,high:101,low:99,close:100,volume:1}));
afterEach(()=>vi.unstubAllGlobals());
describe('chart drawing controls',()=>{
 it('creates, persists, selects, deletes and undoes a rectangle, and cleans up subscriptions',()=>{
  const data=new Map<string,string>();const storage={getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value)};
  const win=new EventTarget() as EventTarget & {confirm:()=>boolean;prompt:()=>string|null};win.confirm=()=>true;win.prompt=()=>null;
  vi.stubGlobal('HTMLElement',FakeElement);vi.stubGlobal('SVGElement',FakeSvg);vi.stubGlobal('localStorage',storage);vi.stubGlobal('window',win);
  vi.stubGlobal('document',{createElement:()=>new FakeElement(),createElementNS:()=>new FakeSvg()});vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
  const range={logicalToCoordinate:(v:number)=>v*10,coordinateToLogical:(v:number)=>v/10,subscribeVisibleLogicalRangeChange:vi.fn(),unsubscribeVisibleLogicalRangeChange:vi.fn()};
  const chart={timeScale:()=>range,subscribeCrosshairMove:vi.fn(),unsubscribeCrosshairMove:vi.fn()};const series={priceToCoordinate:(v:number)=>200-v,coordinateToPrice:(v:number)=>200-v};
  const el=new FakeElement();const cleanup=installChartTools(el as unknown as HTMLElement,chart,series,candles,'test');
  const rectangle=find(el,n=>n.textContent==='Rectangle')!;rectangle.dispatchEvent(new Event('click'));
  el.dispatchEvent(pointer('pointerdown',20,80));el.dispatchEvent(pointer('pointermove',50,100));el.dispatchEvent(pointer('pointerup',50,100));
  const saved=JSON.parse(data.get('test')!);expect(saved.drawings).toHaveLength(1);expect(saved.drawings[0].a).toEqual({time:1120,price:120});expect(saved.drawings[0].b).toEqual({time:1300,price:100});
  const shape=find(el,n=>n instanceof FakeSvg&&n.attributes['stroke-opacity']==='0.01')!;shape.dispatchEvent(pointer('pointerdown',20,80));el.dispatchEvent(pointer('pointerup',20,80));
  const handle=find(el,n=>n instanceof FakeSvg&&n.attributes.r==='5')!;handle.dispatchEvent(pointer('pointerdown',20,80));el.dispatchEvent(pointer('pointermove',30,90));el.dispatchEvent(pointer('pointerup',30,90));expect(JSON.parse(data.get('test')!).drawings[0].a).toEqual({time:1180,price:110});
  const del=find(el,n=>n.attributes['aria-label']==='Delete selected drawing')!;del.dispatchEvent(new Event('click'));expect(JSON.parse(data.get('test')!).drawings).toHaveLength(0);
  const undo=find(el,n=>n.attributes['aria-label']==='Undo drawing')!;undo.dispatchEvent(new Event('click'));expect(JSON.parse(data.get('test')!).drawings).toHaveLength(1);
  const again=new FakeElement();const slower=candles.map((c,i)=>({...c,time:1000+i*120}));const cleanupAgain=installChartTools(again as unknown as HTMLElement,chart,series,slower,'test');const restored=find(again,n=>n instanceof FakeSvg&&n.attributes['stroke-opacity']==='0.01');expect(restored?.attributes.x).toBe('15');expect(restored?.attributes.width).toBe('10');cleanupAgain();
  cleanup();expect(range.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(2);expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(2);
 });
 it('measures with an explicitly configured pip size and clears on a later chart click',()=>{
  const data=new Map<string,string>();const win=new EventTarget() as EventTarget & {confirm:()=>boolean;prompt:()=>string|null};win.confirm=()=>true;win.prompt=()=>'.01';
  vi.stubGlobal('HTMLElement',FakeElement);vi.stubGlobal('SVGElement',FakeSvg);vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v)});vi.stubGlobal('window',win);
  vi.stubGlobal('document',{createElement:()=>new FakeElement(),createElementNS:()=>new FakeSvg()});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const range={logicalToCoordinate:(v:number)=>v*10,coordinateToLogical:(v:number)=>v/10,subscribeVisibleLogicalRangeChange:vi.fn(),unsubscribeVisibleLogicalRangeChange:vi.fn()};
  const chart={timeScale:()=>range,subscribeCrosshairMove:vi.fn(),unsubscribeCrosshairMove:vi.fn()},series={priceToCoordinate:(v:number)=>200-v,coordinateToPrice:(v:number)=>200-v};const el=new FakeElement();const cleanup=installChartTools(el as unknown as HTMLElement,chart,series,candles,'pip-test');
  find(el,n=>n.attributes['aria-label']==='Set pip size for measurement')!.dispatchEvent(new Event('click'));
  find(el,n=>n.attributes['aria-label']==='Measure movement')!.dispatchEvent(new Event('click'));
  el.dispatchEvent(pointer('pointerdown',20,100));el.dispatchEvent(pointer('pointermove',40,90));el.dispatchEvent(pointer('pointerup',40,90));
  const label=find(el,n=>n.className==='chart-measure-label')!;expect(label.textContent).toContain('1000.0 pips');expect(label.textContent).toContain('2 candles');
  el.dispatchEvent(pointer('pointerdown',70,80));expect(label.style.display).toBe('none');cleanup();
 });

});
