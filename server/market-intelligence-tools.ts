import {tool} from 'ai';
import {z} from 'zod';
import {getMarketNews,getEconomicCalendar} from './market-intelligence.ts';

/** Read-only, on-demand tools. Input fields map to documented upstream parameters
 * with the remaining relevance and time-window filters applied locally. */
const filters=z.object({
 symbol:z.string().min(1).max(24).optional(),
 topic:z.string().max(120).optional(),
 from:z.string().max(48).optional(),
 to:z.string().max(48).optional(),
 country:z.string().regex(/^[A-Za-z]{2}$/).optional(),
 countries:z.array(z.string().regex(/^[A-Za-z]{2}$/)).max(15).optional(),
 importance:z.enum(['low','medium','high']).optional(),
 relevance:z.enum(['strict','balanced']).optional(),
 limit:z.number().int().min(1).max(10).optional()
}).strict();

export const marketIntelligenceTools=()=>({
 getMarketNews:tool({
  description:'Search up-to-date public financial news. Filter by symbol, topic, UTC date range, country and relevance. Return 5–10 unique credible recent article titles, publisher names, publication timestamps and links. Do not imply a headline proves why the market moved. Do not mention backend vendors in the chat.',
  inputSchema:filters,
  execute:async(input)=>getMarketNews(input)
 }),
 getEconomicCalendar:tool({
  description:'Look up actual, expected and upcoming macroeconomic releases (e.g. US CPI, NFP, Fed). Filter by symbol, topic, UTC date range, countries, importance and relevance. Null actual means not published; non-exact event times are tentative. Give traders material times and data not raw JSON.',
  inputSchema:filters,
  execute:async(input)=>getEconomicCalendar(input)
 })
});
