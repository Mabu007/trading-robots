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
  if(dex && !coin.startsWith(dex+':'))throw Error('Mismatched HIP-3 DEX');
  if(!Number.isInteger(v.szDecimals)||Number(v.szDecimals)<0||Number(v.szDecimals)>12)throw Error('Invalid quantity precision');
  const under=dex?coin.slice(dex.length+1):coin;
  const kind:MarketKind=dex?'hip3-perpetual':'perpetual';
  return {id:canonicalId('hyperliquid',kind,coin),venue:'hyperliquid',kind,symbol:coin,
    aliases:[],underlying:under,base:under,quote:null,contractSize:null,multiplier:null,
    pricePrecision:null,quantityPrecision:Number(v.szDecimals),quantityStep:10**-Number(v.szDecimals),
    tradingHours:'24/7',providerIds:{coin,dex,index:Number.isInteger(v.index)?Number(v.index):-1},
    provenance:'Hyperliquid public perp meta; contract size, multiplier and quote not asserted',verifiedAt:at};
}
export function instrumentsFromHyperSpot(data:unknown,at:string|null=null):CanonicalInstrument[]{
  const root=data as Record<string,unknown>;
  if(!Array.isArray(root?.universe)||!Array.isArray(root?.tokens))throw Error('Invalid Hyperliquid spot metadata');
  const tokens=new Map<number,Record<string,unknown>>();
  for(const t of root.tokens){if(typeof t?.index==='number'&&typeof t?.name==='string')tokens.set(t.index,t);}
  return root.universe.map((u:Record<string,unknown>)=>{
    if(!Array.isArray(u.tokens)||u.tokens.length!==2||!Number.isInteger(u.index))throw Error('Invalid spot pair');
    const base=tokens.get(u.tokens[0]),quote=tokens.get(u.tokens[1]);
    if(!base||!quote)throw Error('Unknown Hyperliquid spot token');
    const coin=assertSymbol(String(u.name));
    const precision=Number(base.szDecimals);
    if(!Number.isInteger(precision)||precision<0||precision>12)throw Error('Invalid spot precision');
    return {id:canonicalId('hyperliquid','spot',coin),venue:'hyperliquid' as const,kind:'spot' as const,symbol:coin,
      aliases:[],underlying:String(base.name),base:String(base.name),quote:String(quote.name),
      contractSize:null,multiplier:null,pricePrecision:null,quantityPrecision:precision,
      quantityStep:10**-precision,tradingHours:'24/7',providerIds:{coin,spotIndex:Number(u.index),
       baseTokenIndex:Number(u.tokens[0]),quoteTokenIndex:Number(u.tokens[1])},
      provenance:'Hyperliquid public spotMeta token indices',verifiedAt:at};
  });
}
export function brokerInstrument(input:{
 venue:'propdao'|'ctrader'|'valr';kind:MarketKind;symbol:string;underlying?:string|null;
 base?:string|null;quote?:string|null;contractSize?:number|null;multiplier?:number|null;
 pricePrecision?:number|null;quantityPrecision?:number|null;tradingHours?:string|null;
 providerIds?:Record<string,string|number>;verifiedAt?:string|null;
}):CanonicalInstrument{
 const symbol=assertSymbol(input.symbol);
 return {id:canonicalId(input.venue,input.kind,symbol),venue:input.venue,kind:input.kind,symbol,
  aliases:[],underlying:input.underlying??null,base:input.base??null,quote:input.quote??null,
  contractSize:input.contractSize??null,multiplier:input.multiplier??null,
  pricePrecision:input.pricePrecision??null,quantityPrecision:input.quantityPrecision??null,
  quantityStep:input.quantityPrecision==null?null:10**-input.quantityPrecision,
  tradingHours:input.tradingHours??null,providerIds:input.providerIds??{symbol},
  provenance:'Venue-specific metadata; unverified fields intentionally null',verifiedAt:input.verifiedAt??null};
}
export class InstrumentRegistry {
 private byId=new Map<string,CanonicalInstrument>();
 private byScope=new Map<string,string>();
 add(item:CanonicalInstrument){
  if(item.id!==canonicalId(item.venue,item.kind,item.symbol))throw Error('Invalid canonical identity');
  const key=item.venue+'|'+item.kind+'|'+item.symbol;
  if(this.byId.has(item.id)||this.byScope.has(key))throw Error('Duplicate canonical instrument');
  this.byId.set(item.id,Object.freeze({...item,aliases:[...item.aliases] }));
  this.byScope.set(key,item.id);
 }
 all(){return [...this.byId.values()];}
 get(id:string){return this.byId.get(id)??null;}
 resolve(input:{id?:string;venue?:TradingVenue;kind?:MarketKind;symbol?:string}):CanonicalInstrument{
  const id=input.id||(input.venue&&input.kind&&input.symbol?canonicalId(input.venue,input.kind,input.symbol):'');
  const entry=this.byId.get(id);
  if(!entry)throw Error('Unknown or ambiguous instrument; specify exact venue, market type and symbol');
  if((input.venue&&entry.venue!==input.venue)||(input.kind&&entry.kind!==input.kind)||(input.symbol&&entry.symbol!==input.symbol))throw Error('Instrument scope mismatch');
  return entry;
 }
}

