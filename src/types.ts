export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number};
export type Side='LONG'|'SHORT';
export type Trade={id:number;side:Side;entryTime:number;exitTime:number;entry:number;exit:number;stop:number;target:number;pnl:number;reason:'stop'|'target'|'signal'|'end';};
export type Result={candles:Candle[];trades:Trade[];equity:{time:number,value:number}[];metrics:{trades:number;wins:number;losses:number;winRate:number;netReturn:number;profitFactor:number;maxDrawdown:number;endingBalance:number};logs:string[];source?:string;timeframe?:string;};
