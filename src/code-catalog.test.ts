import {describe,it,expect} from 'vitest';
import {resolveCodeReference,codeSuggestions,catalogContext} from './code-catalog';
import type {CloudBot} from './firebase';
const bots=[
 {id:'bot-a',name:'MySol Robot',asset:'SOLUSDC',venue:'propdao',prompt:'',code:'',lastBacktest:{metrics:{},candleCount:500,from:'2026-10-01',to:'2026-10-10'}},
 {id:'bot-b',name:'Gold Sweep Finder',asset:'GOLDUSDC',venue:'propdao',prompt:'',code:''},
 {id:'bot-c',name:'Sol Scalper',asset:'SOLUSDC',venue:'valr',prompt:'',code:''}
] as CloudBot[];
describe('saved Code library lookup',()=>{
 it('resolves a unique, named saved robot',()=>{expect(resolveCodeReference('Please backtest MySol Robot',bots)?.bot.id).toBe('bot-a')});
 it('resolves a quoted name exactly',()=>{expect(resolveCodeReference('Run "Gold Sweep Finder" and show the result',bots)?.bot.id).toBe('bot-b')});
 it('does not invent or guess unnamed code',()=>{expect(resolveCodeReference('run that strategy from last week',bots)).toBeNull()});
 it('fails closed on ambiguous duplicate names',()=>{expect(resolveCodeReference('run MySol Robot',[...bots,{...bots[0],id:'bot-d'}])).toBeNull()});
 it('searches by owned asset or code label without revealing source',()=>{expect(codeSuggestions('Find our Gold sweep detector',bots).map(b=>b.id)).toContain('bot-b');expect(catalogContext(bots)).not.toContain('onCandle')});
 it('does not include any other account code: only the supplied list is searchable',()=>{expect(resolveCodeReference('Run secret competitor bot',bots)).toBeNull()});
});
