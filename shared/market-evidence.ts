export type MarketSource = {name:string;url:string;title?:string;asOf?:string};
export type MarketChartEvidence = {
 coin:string;
 timeframe:'h1'|'h4'|'d1';
 asOf:string;
 candles:{time:number;open:number;high:number;low:number;close:number}[];
 trend:'uptrend'|'downtrend'|'mixed'|null;
};
