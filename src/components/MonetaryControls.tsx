import { useEffect, useState } from 'react';
import type { MonetaryAssumptions } from '../monetary-backtest';

export type SimulationSettings = { balance: number; assumptions: MonetaryAssumptions };
const defaults: SimulationSettings = { balance: 500, assumptions: {contractSize: 0, minVolume: 0, volumeStep: 0, quoteToZar: 0, spread: 0, slippage: 0, commissionPerLotZar: 0} };
function read(key: string): SimulationSettings {
  try { const stored=JSON.parse(localStorage.getItem(key)||'null'); if (stored && Number.isFinite(stored.balance) && stored.balance>0) return {balance:stored.balance, assumptions:{...defaults.assumptions,...stored.assumptions}}; } catch { /* use defaults */ }
  return structuredClone(defaults);
}
export function MonetaryControls({ storageKey, onChange }: { storageKey: string; onChange: (key: string, settings: SimulationSettings) => void }) {
  const [state, setState] = useState(()=>({key:storageKey, settings:read(storageKey)}));
  useEffect(()=>{ if(state.key!==storageKey) setState({key:storageKey,settings:read(storageKey)}); },[storageKey,state.key]);
  useEffect(()=>{ if(state.key!==storageKey)return; try{localStorage.setItem(storageKey,JSON.stringify(state.settings))}catch{} onChange(storageKey,state.settings); },[state,storageKey,onChange]);
  const setBalance=(value:string)=>setState(current=>({...current,settings:{...current.settings,balance:Number(value)}}));
  const setAssumption=(key:keyof MonetaryAssumptions,value:string)=>setState(current=>({...current,settings:{...current.settings,assumptions:{...current.settings.assumptions,[key]:key==='leverage' && value===''?undefined:Number(value)}}}));
  const a=state.settings.assumptions;
  return <div className="simulation-controls">
    <label className="balance-control" title="Starting simulation equity in South African rand">Account balance <span>R</span><input aria-label="Account balance in rand" type="number" min="0.01" step="any" value={state.settings.balance||''} onChange={e=>setBalance(e.currentTarget.value)}/></label>
    <details className="simulation-settings"><summary title="Inspect and edit simulation assumptions">Assumptions</summary><div className="simulation-popover">
      <strong>Simulation assumptions</strong><p>Enter verified values for this instrument and account. This is a simulation, not a broker deposit. Saved on this device.</p>
      {([['contractSize','Contract size per lot'],['minVolume','Minimum volume (lots)'],['volumeStep','Volume step (lots)'],['quoteToZar','ZAR per quote-currency unit'],['spread','Spread (price units)'],['slippage','Slippage per fill (price units)'],['commissionPerLotZar','Round-trip commission (R per lot)'],['leverage','Account leverage (optional)']] as const).map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="any" value={a[key]??''} onChange={e=>setAssumption(key,e.currentTarget.value)}/></label>)}
      <small>Price bars are treated as mid prices. Spread is charged at entry and slippage at both fills. These costs are independent of the strategy’s R-only cost settings. Margin is checked only if leverage is supplied. Swaps and changing conversion rates are not modeled.</small>
    </div></details>
  </div>;
}
