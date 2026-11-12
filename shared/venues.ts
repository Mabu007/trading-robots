export const venues = ['research','valr','ctrader','hyperliquid','propdao'] as const;
export type Venue = typeof venues[number];
export const venueLabel:Record<Venue,string>={research:'Market research',valr:'VALR',ctrader:'cTrader',hyperliquid:'Hyperliquid',propdao:'PropDAO'};
export function venueOf(value:unknown):Venue {return venues.includes(value as Venue)?value as Venue:'valr'}
