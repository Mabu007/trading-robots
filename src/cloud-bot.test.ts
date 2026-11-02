import {expect,it} from 'vitest';
import {cloudBotFromRecord} from './cloud-bot';
it('uses the document identity and safe searchable metadata for old or malformed records',()=>{
 const bot=cloudBotFromRecord('actual-document',{id:'another-bot',name:12,asset:{symbol:'ETHZAR'},prompt:null,storage:{key:42},lastBacktest:{money:{netProfit:Infinity}}});expect(bot).toMatchObject({id:'actual-document',name:'Untitled robot',asset:'',prompt:'',lastBacktest:null});expect(bot.storageKey).toBeUndefined();expect(()=>[bot,cloudBotFromRecord('second',null)].sort((a,b)=>a.name.localeCompare(b.name))).not.toThrow();
});
it('preserves a valid saved backtest and only displays finite ZAR results',()=>{
 const result={metrics:{trades:3},candleCount:1440,from:'2026-10-31',to:'2026-10-31',money:{currency:'ZAR',netProfit:10,returnPercent:2}};
 expect(cloudBotFromRecord('bot',{name:'ETH idea',asset:'ETHZAR',prompt:'Rules',storage:{key:'private/current.json'},lastBacktest:result})).toMatchObject({name:'ETH idea',asset:'ETHZAR',storageKey:'private/current.json',lastBacktest:result});expect(cloudBotFromRecord('bot',{lastBacktest:{...result,money:{...result.money,netProfit:NaN}}}).lastBacktest?.money).toBeUndefined();
});

it('retains provider-specific symbols and defaults old bots to VALR',()=>{expect(cloudBotFromRecord('b',{venue:'hyperliquid',asset:'xyz:GOLD'})).toMatchObject({venue:'hyperliquid',asset:'xyz:GOLD'});expect(cloudBotFromRecord('c',{asset:'BTCUSDC',venue:'propdao'}).venue).toBe('propdao');expect(cloudBotFromRecord('d',{}).venue).toBe('valr')});
