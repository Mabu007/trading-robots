import {ArrowRight,Wallet} from 'lucide-react';
import {Dialog} from './Dialog';
export type BrokerChoice='propdao'|'ctrader'|'valr';
export function BrokerPicker({onChoose,onClose}:{onChoose:(broker:BrokerChoice)=>void;onClose:()=>void}){
 return <Dialog title="Connect a broker" onClose={onClose}>
  <p>Connect PropDAO to view your account activity.</p>
  <div className="tv-broker-picker">
   {([['propdao','PropDAO','Connect your developer API key'],['ctrader','cTrader','Connect a cTrader ID'],['valr','VALR','Connect your VALR account']] as const).map(([id,name,description])=><button type="button" key={id} disabled={id!=='propdao'} onClick={()=>onChoose(id)}><Wallet size={18}/><span><strong>{name}</strong><small>{description}</small></span>{id==='propdao'?<ArrowRight size={15}/>:<span className="tv-paused-label">Paused</span>}</button>)}
  </div>
 </Dialog>;
}
