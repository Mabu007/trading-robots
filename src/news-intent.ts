import type {NewsTopic,NewsSpan} from '../server/gdelt-news';
export function newsIntent(text:string):{topic:NewsTopic;span:NewsSpan;coverage?:true}|null {
 if(text.length>5000||!/\b(headlines?|news|news stories|press coverage|articles|latest coverage)\b/i.test(text))return null;
 // Avoid hijacking requests for coding, brokerage operations or a specific saved trade.
 if(/\b(deploy|stop bot|place (?:an? )?order|buy now|sell now|backtest|write code|edit strategy|my trade|my position)\b/i.test(text))return null;
 const span:NewsSpan=/\b(?:last|past)\s+(?:7\s*days?|week)\b/i.test(text)?'7d':/\b(?:last|past)\s+3\s*days?\b/i.test(text)?'3d':'24h';
 let topic:NewsTopic='global';
 if(/\b(gold|xauusd|goldusdc|bullion)\b/i.test(text))topic='gold';
 else if(/\b(forex|currency|currencies|usd|eurusd|gbpusd)\b/i.test(text))topic='forex';
 else if(/\b(bitcoin|btc|eth|ethereum|crypto)\b/i.test(text))topic='crypto';
 else if(/\b(oil|brent|crude|opec|energy)\b/i.test(text))topic='energy';
 else if(/\b(stocks?|equities|nasdaq|s&p)\b/i.test(text))topic='equities';
 else if(/\b(cpi|inflation|fed|interest rates?|macro|central bank|jobs report)\b/i.test(text))topic='macro';
 return /\b(coverage trend|news volume|article count|news coverage|headlines? trend)\b/i.test(text)?{topic,span,coverage:true}:{topic,span};
}
