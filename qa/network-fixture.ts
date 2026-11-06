import {starterCode} from '../src/strategy';
if(new URLSearchParams(location.search).has('fixtureAgent'))localStorage.setItem('trading-vibes:draft:ui-fixture',JSON.stringify({created:true,id:'fixture-agent',name:'Gold research · UI fixture',venue:'propdao',asset:'GOLDUSDC',prompt:'UI fixture, no trading',code:starterCode,view:'chart'}));else localStorage.removeItem('trading-vibes:draft:ui-fixture');
// All external requests are replaced with isolated fixture responses.
window.fetch=async(input)=>{
 const url=String(input instanceof Request?input.url:input);
 if(url.includes('/api/venues/propdao/markets'))return Response.json({markets:[{symbol:'GOLDUSDC'}]});
 if(url.includes('/api/venues/propdao/accounts'))return Response.json({connected:false,accounts:[]});
 if(url.includes('/api/venues/ctrader/accounts'))return Response.json({connected:false,accounts:[]});
 if(url.includes('/api/venues/propdao/bots/'))return Response.json({configured:false,deployed:false,running:false,events:['UI fixture: no runtime connection']});
 if(url.includes('/api/user-bots/fixture-agent/current'))return Response.json({code:starterCode,storageKey:'fixture'});
 if(url.endsWith('/api/user-bots/fixture-agent'))return Response.json({ok:true});
 if(url.includes('/api/valr/markets'))return Response.json({markets:[{symbol:'BTCUSDT'}]});
 if(url.includes('/api/valr/account'))return Response.json({connected:false});
 if(url.includes('/api/code-watches'))return Response.json({watches:[]});
 if(url.endsWith('/api/agents'))return Response.json([]);
 if(url.includes('/api/economy'))return Response.json({items:[],projects:[],covers:{}});
 if(url.includes('/api/openrouter/models'))return Response.json({models:[{id:'fixture/model',name:'UI fixture (no inference)',pricing:{prompt:'0',completion:'0'}}]});
 if(url.includes('/api/openrouter/account'))return Response.json({connected:false});
 if(url.includes('/api/openrouter/spending'))return Response.json({connected:false});
 if(url.includes('/api/chat/plan'))return Response.json({tool:null});
 if(url.endsWith('/api/ai'))return new Response('data: {"choices":[{"delta":{"content":"Fixture response."}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 return Response.json({error:'UI fixture: external operations are disabled.'},{status:503});
};
