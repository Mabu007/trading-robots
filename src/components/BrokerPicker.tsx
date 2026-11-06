import {ArrowRight,Wallet} from 'lucide-react';
import {Dialog} from './Dialog';
export type BrokerChoice='propdao'|'ctrader'|'valr';
export function BrokerPicker({onChoose,onClose}:{onChoose:(broker:BrokerChoice)=>void;onClose:()=>void}){
 return <Dialog title="Connect a broker" onClose={onClose}>
  <p>Choose a broker to connect and view your account activity.</p>
  <div className="tv-broker-picker">
   {([['propdao','PropDAO','Connect your developer API key'],['ctrader','cTrader','Connect a cTrader ID'],['valr','VALR','Connect your VALR account']] as const).map(([id,name,description])=><button type="button" key={id} onClick={()=>onChoose(id)}><Wallet size={18}/><span><strong>{name}</strong><small>{description}</small></span><ArrowRight size={15}/></button>)}
  </div>
 </Dialog>;
}
