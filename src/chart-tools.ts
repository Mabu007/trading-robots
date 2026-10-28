import type { Candle } from './types';

type Point = {time:number; price:number};
type Shape = {id:string; kind:'trend'|'horizontal'|'vertical'|'rectangle'|'ellipse'; a:Point; b:Point};
type Tool = 'pan'|'measure'|Shape['kind'];
const NS='http://www.w3.org/2000/svg';
const icons:Record<string,string>={pan:'<path d="M8 13V5a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7l-1 4a5 5 0 0 1-5 4h-2a6 6 0 0 1-5-3l-3-4a2 2 0 0 1 3-2z"/>',measure:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',draw:'<path d="M4 20 20 4M5 4h3M4 5v3M16 20h4v-4"/>',undo:'<path d="M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6"/>',clear:'<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6"/>'};
const icon=(name:string)=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

/** Drawings are stored in time/price coordinates; the overlay only intercepts hits on shapes. */
export function installChartTools(el:HTMLElement, chart:any, series:any, candles:Candle[], storageKey:string) {
 let drawings:Shape[]=[]; let pipSize=0;
 try { const saved=JSON.parse(localStorage.getItem(storageKey)||'{}'); if(Array.isArray(saved.drawings))drawings=saved.drawings.filter((s:Shape)=>s?.a&&s?.b&&Number.isFinite(s.a.time)&&Number.isFinite(s.a.price)&&Number.isFinite(s.b.time)&&Number.isFinite(s.b.price)); if(Number.isFinite(saved.pipSize)&&saved.pipSize>0)pipSize=saved.pipSize; } catch { /* ignore malformed local data */ }
 let tool:Tool='pan', selected:string|null=null, first:Point|null=null, preview:Shape|null=null, measure:{a:Point;b:Point}|null=null, undo:Shape[][]=[];
 let drag:{mode:'create'|'measure'|'move'|'a'|'b'; start:Point; shape?:Shape; original?:Shape[]; moved:boolean}|null=null;
 const times=candles.map(c=>c.time);
 const precision=Math.min(8,Math.max(2,...candles.slice(0,100).flatMap(c=>[c.open,c.high,c.low,c.close].map(price=>{const s=String(price);return s.includes('.')?s.split('.')[1].length:0}))));
 const svg=document.createElementNS(NS,'svg'); svg.classList.add('drawing-overlay'); el.appendChild(svg);
 const toolbar=document.createElement('div');toolbar.className='drawing-toolbar';el.appendChild(toolbar);
 const label=document.createElement('div');label.className='chart-measure-label';label.style.display='none';el.appendChild(label);
 const button=(name:string,title:string,click:()=>void)=>{const b=document.createElement('button');b.type='button';b.title=title;b.setAttribute('aria-label',title);if(icons[name])b.innerHTML=icon(name);else b.textContent=name;b.addEventListener('click',click);toolbar.appendChild(b);return b};
 const panButton=button('pan','Pan chart',()=>setTool('pan'));
 const measureButton=button('measure','Measure movement',()=>setTool('measure'));
 const dropdown=document.createElement('details');dropdown.className='drawing-dropdown';const summary=document.createElement('summary');summary.title='Drawings';summary.setAttribute('aria-label','Drawings');summary.innerHTML=icon('draw');dropdown.appendChild(summary);const menu=document.createElement('div');menu.className='drawing-menu';dropdown.appendChild(menu);toolbar.appendChild(dropdown);
 for(const [kind,name] of [['trend','Trendline'],['horizontal','Horizontal line'],['vertical','Vertical line'],['rectangle','Rectangle'],['ellipse','Ellipse']] as const){const b=document.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',()=>{dropdown.open=false;setTool(kind)});menu.appendChild(b)}
 button('undo','Undo drawing',()=>{if(undo.length){drawings=undo.pop()!;selected=null;persist();render()}});
 button('clear','Clear drawings',()=>{if(drawings.length&&window.confirm('Clear all drawings for this chart?')){checkpoint();drawings=[];selected=null;persist();render()}});
 const pipButton=button('Pip','Set pip size for measurement',()=>{const value=window.prompt('Pip size in price units (leave empty to show pips as unavailable):',pipSize?String(pipSize):'');if(value===null)return;const parsed=Number(value);pipSize=Number.isFinite(parsed)&&parsed>0?parsed:0;persist();render()});pipButton.className='drawing-pip';
 const remove=button('×','Delete selected drawing',()=>deleteSelected());remove.style.display='none';
 function setTool(next:Tool){tool=next;first=null;preview=null;measure=null;selected=null;label.style.display='none';panButton.classList.toggle('active',next==='pan');measureButton.classList.toggle('active',next==='measure');summary.classList.toggle('active',!['pan','measure'].includes(next));el.classList.toggle('drawing-mode',next!=='pan');render()}
 function checkpoint(){undo.push(structuredClone(drawings));if(undo.length>50)undo.shift()}
 function persist(){try{localStorage.setItem(storageKey,JSON.stringify({drawings,pipSize}))}catch{/* local storage may be unavailable */}}
 function deleteSelected(){if(!selected)return;checkpoint();drawings=drawings.filter(s=>s.id!==selected);selected=null;persist();render()}
 function timeToIndex(time:number){if(!times.length)return 0;let lo=0,hi=times.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(times[mid]<time)lo=mid+1;else hi=mid}if(lo===0)return times.length>1?(time-times[0])/(times[1]-times[0]):0;if(times[lo]===time)return lo;const prev=lo-1;return prev+(time-times[prev])/(times[lo]-times[prev])}
 function indexToTime(index:number){if(!times.length)return 0;const i=Math.max(0,Math.min(times.length-1,index)),low=Math.floor(i),high=Math.min(times.length-1,low+1);return times[low]+(times[high]-times[low])*(i-low)}
 function screen(p:Point){return {x:chart.timeScale().logicalToCoordinate(timeToIndex(p.time)),y:series.priceToCoordinate(p.price)}}
 function point(e:PointerEvent):Point|null{const rect=el.getBoundingClientRect(),logical=chart.timeScale().coordinateToLogical(e.clientX-rect.left),price=series.coordinateToPrice(e.clientY-rect.top);return logical===null||price===null?null:{time:indexToTime(logical),price}}
 function node(tag:string,attrs:Record<string,string|number>){const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));svg.appendChild(n);return n}
 function selectShape(n:SVGElement,s:Shape,mode:'move'|'a'|'b'='move'){n.style.pointerEvents=mode==='move'?'stroke':'auto';n.addEventListener('pointerdown',e=>{if(tool!=='pan')return;const p=point(e);if(!p)return;e.preventDefault();e.stopPropagation();selected=s.id;drag={mode,start:p,shape:structuredClone(s),original:structuredClone(drawings),moved:false};el.setPointerCapture(e.pointerId);render()});n.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();selected=s.id;render();if(window.confirm('Delete this drawing?'))deleteSelected()})}
 function renderShape(s:Shape,temporary=false){const a=screen(s.a),b=screen(s.b);if(a.x===null||a.y===null||b.x===null||b.y===null)return;let n:SVGElement;const common={stroke:'#d5e6dc','stroke-width':1.5,fill:'none'};
  if(s.kind==='trend')n=node('line',{...common,x1:a.x,y1:a.y,x2:b.x,y2:b.y});
  else if(s.kind==='horizontal')n=node('line',{...common,x1:0,y1:a.y,x2:el.clientWidth-65,y2:a.y});
  else if(s.kind==='vertical')n=node('line',{...common,x1:a.x,y1:0,x2:a.x,y2:el.clientHeight-24});
  else if(s.kind==='rectangle')n=node('rect',{...common,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),fill:'#9ee3b626'});
  else n=node('ellipse',{...common,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,rx:Math.abs(a.x-b.x)/2,ry:Math.abs(a.y-b.y)/2,fill:'#9ee3b626'});
  if(!temporary){n.setAttribute('stroke-width','8');n.setAttribute('stroke-opacity','0.01');selectShape(n,s);const visible=n.cloneNode(false) as SVGElement;visible.setAttribute('stroke-width','1.5');visible.setAttribute('stroke-opacity','1');visible.style.pointerEvents='none';svg.appendChild(visible)}
  if(!temporary&&s.kind==='horizontal'){const t=node('text',{x:Math.max(2,el.clientWidth-63),y:a.y-4,fill:'#d5e6dc','font-size':10});t.textContent=s.a.price.toFixed(precision)}if(!temporary&&s.kind==='vertical'){const t=node('text',{x:a.x+3,y:el.clientHeight-27,fill:'#d5e6dc','font-size':10});t.textContent=new Date(s.a.time*1000).toISOString().slice(0,16).replace('T',' ')}
  if(!temporary&&selected===s.id){const points=s.kind==='horizontal'||s.kind==='vertical'?[['a',a] as const]:[['a',a] as const,['b',b] as const];for(const [which,p] of points){const handle=node('circle',{cx:p.x!,cy:p.y!,r:5,fill:'#cbf7dc',stroke:'#1d4330','stroke-width':1});selectShape(handle,s,which)}}
 }
 function render(){svg.replaceChildren();remove.style.display=selected?'':'none';for(const s of drawings)renderShape(s);if(preview)renderShape(preview,true);
  if(measure){const a=screen(measure.a),b=screen(measure.b);if(a.x!==null&&a.y!==null&&b.x!==null&&b.y!==null){const diff=measure.b.price-measure.a.price,percent=measure.a.price?diff/measure.a.price*100:0;node('rect',{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(1,Math.abs(b.x-a.x)),height:Math.max(1,Math.abs(b.y-a.y)),fill:diff>=0?'#42d8a426':'#e9777b26',stroke:diff>=0?'#42d8a4':'#e9777b','stroke-width':1});const duration=Math.abs(measure.b.time-measure.a.time);label.textContent=`${diff>=0?'↑':'↓'} ${measure.a.price.toFixed(precision)} → ${measure.b.price.toFixed(precision)} · Δ ${diff.toFixed(precision)} · ${pipSize?(diff/pipSize).toFixed(1)+' pips':'pips unavailable (set pip size)'} · ${percent.toFixed(2)}% · ${Math.round(Math.abs(timeToIndex(measure.b.time)-timeToIndex(measure.a.time)))} candles · ${Math.round(duration/60)} min`;label.style.left=`${Math.max(4,Math.min(el.clientWidth-230,b.x+8))}px`;label.style.top=`${Math.max(38,Math.min(el.clientHeight-55,b.y+8))}px`;label.classList.toggle('negative',diff<0);label.style.display='block'}}else label.style.display='none';
 }
 function down(e:PointerEvent){if(toolbar.contains(e.target as Node)||e.button!==0)return;const p=point(e);if(!p)return;if(tool==='pan'){if(!(e.target instanceof SVGElement)){selected=null;measure=null;render()}return}e.preventDefault();e.stopPropagation();el.setPointerCapture(e.pointerId);
  if(tool==='measure'){measure={a:p,b:p};drag={mode:'measure',start:p,moved:false};render();return}
  if(tool==='trend'&&first){checkpoint();drawings.push({id:crypto.randomUUID(),kind:'trend',a:first,b:p});first=null;persist();setTool('pan');return}
  if(tool==='trend'){first=p;preview={id:'preview',kind:'trend',a:p,b:p};render();return}
  if(tool==='horizontal'||tool==='vertical'){checkpoint();drawings.push({id:crypto.randomUUID(),kind:tool,a:p,b:p});persist();setTool('pan');return}
  preview={id:'preview',kind:tool,a:p,b:p};drag={mode:'create',start:p,moved:false};render();
 }
 function move(e:PointerEvent){const p=point(e);if(!p)return;if(!drag){if(tool==='trend'&&first&&preview){preview.b=p;render()}return}e.preventDefault();e.stopPropagation();drag.moved=true;
  if(drag.mode==='measure'&&measure)measure.b=p;
  else if(drag.mode==='create'&&preview)preview.b=p;
  else if(drag.shape){const original=drag.shape;drawings=drawings.map(s=>{if(s.id!==original.id)return s;if(drag!.mode==='a')return {...s,a:p};if(drag!.mode==='b')return {...s,b:p};const dt=p.time-drag!.start.time,dp=p.price-drag!.start.price;return {...s,a:{time:original.a.time+dt,price:original.a.price+dp},b:{time:original.b.time+dt,price:original.b.price+dp}}})}render();
 }
 function up(e:PointerEvent){if(!drag)return;e.preventDefault();e.stopPropagation();if(drag.mode==='measure'){drag=null;tool='pan';panButton.classList.add('active');measureButton.classList.remove('active');el.classList.remove('drawing-mode');render();return}if(drag.mode==='create'&&preview&&drag.moved){checkpoint();drawings.push({...preview,id:crypto.randomUUID()});persist();drag=null;setTool('pan');return}if(drag.original&&drag.moved){undo.push(drag.original);persist()}drag=null;preview=null;render()}
 function cancel(){if(drag?.original)drawings=drag.original;drag=null;preview=null;measure=null;setTool('pan')}
 function key(e:KeyboardEvent){if(e.target instanceof HTMLElement&&(e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)))return;if(e.key==='Escape'){if(drag?.original)drawings=drag.original;drag=null;setTool('pan')}else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();deleteSelected()}}
 let frame=0;function redraw(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render()})}
 el.addEventListener('pointerdown',down,true);el.addEventListener('pointermove',move,true);el.addEventListener('pointerup',up,true);el.addEventListener('pointercancel',cancel,true);window.addEventListener('keydown',key);chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);chart.subscribeCrosshairMove(redraw);const resize=new ResizeObserver(redraw);resize.observe(el);setTool('pan');
 return ()=>{if(frame)cancelAnimationFrame(frame);resize.disconnect();chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);chart.unsubscribeCrosshairMove(redraw);window.removeEventListener('keydown',key);el.removeEventListener('pointerdown',down,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true);el.removeEventListener('pointercancel',cancel,true);el.classList.remove('drawing-mode');svg.remove();toolbar.remove();label.remove()};
}
