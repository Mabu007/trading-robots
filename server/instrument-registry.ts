/* Phase 3: source identifiers are venue-specific, not fungible ticker aliases. */
export type MarketKind = 'perpetual'|'hip3-perpetual'|'spot'|'cfd'|'unknown';
export type TradingVenue = 'hyperliquid'|'propdao'|'ctrader'|'valr';
export type CanonicalInstrument = {
  id:string; venue:TradingVenue; kind:MarketKind; symbol:string; aliases:string[];
  underlying:string|null; base:string|null; quote:string|null;
  contractSize:number|null; multiplier:number|null;
  pricePrecision:number|null; quantityPrecision:number|null; quantityStep:number|null;
  tradingHours:string|null; providerIds:Record<string,string|number>;
  provenance:string; verifiedAt:string|null;
};
const symbolOk=/^[A-Za-z0-9@._:/-]{1,64}$/;
const dexOk=/^[A-Za-z0-9_-]{0,24}$/;
function assertSymbol(symbol:string){if(!symbolOk.test(symbol)||symbol.includes('..')||symbol.startsWith('/'))throw Error('Invalid instrument symbol');return symbol;}
export function canonicalId(venue:TradingVenue,kind:MarketKind,symbol:string):string{
  return venue+':'+kind+':'+assertSymbol(symbol);
}
export function instrumentFromHyperPerp(meta:unknown,dex:string,at:string|null=null):CanonicalInstrument{
  if(!dexOk.test(dex))throw Error('Invalid Hyperliquid DEX');
  const v=meta as Record<string,unknown>;
  const raw=assertSymbol(String(v?.name||''));
  const coin=dex ? (raw.startsWith(dex+':') ? raw : dex+':'+raw) : raw;
  if(!dex&&coin.includes(':'))throw Error('Unexpected namespaced core perpetual');
  if(dex && !coin.startsWith(dex+¶»§q«^