import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Dialog({title,children,onClose,busy=false,role='dialog',className=''}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;role?:'dialog'|'alertdialog';className?:string}){
 const panel=useRef<HTMLElement>(null),close=useRef(onClose),blocked=useRef(busy);close.current=onClose;blocked.current=busy;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const focusable=()=>[...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[])].filter(e=>e.getClientRects().length>0);
  (panel.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')||focusable()[0]||panel.current)?.focus();
  const keyboard=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!blocked.current){e.preventDefault();close.current()}if(e.key==='Tab'){const items=focusable(),first=items[0],last=items.at(-1);if(!first){e.preventDefault();panel.current?.focus()}else if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
  document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('keydown',keyboard);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()};
 },[]);
 return <div className="trade-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}><section ref={panel} tabIndex={-1} className={'trade-modal market-modal app-dialog '+className} role={role} aria-modal="true" aria-label={title} aria-busy={busy}><header className="app-dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18}/></button></header><div className="app-dialog-content">{children}</div></section></div>;
}
