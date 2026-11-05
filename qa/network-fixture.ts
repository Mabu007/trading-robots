import {starterCode} from '../src/strategy';
if(new URLSearchParams(location.search).has('fixtureAgent'))localStorage.setItem('trading-vibes:draft:ui-fixture',JSON.stringify({created:true,id:'fixture-agent',name:'Gold research · UI fixture',venue:'propdao',asset:'GOLDUSDC',prompt:'UI fixture, no trading',code:starterCode,view:'chart'}));else localStorage.removeItem('trading-vibes:draft:ui-fixture');
// No real account or venue request is allowed in this fixture.
window.fetch=async(input)=>{
 const url=String(input instanceof Request?input.url:input);
 if(url.includes('/api/venues/propdao/markets'))return Response.json({markets:[{symbol:'GOLDUSDC'}]});
 if(url.includes('/api/venues/propdao/bots/'))return Response.json({configured:false,deployed:false,running:false,events:['UI fixture: no runtime connection']});
 if(url.includes('/api/user-bots/fixture-agent/current'))return Response.json({code:starterCode});
 if(url.includes('/api/valr/markets'))return Response.json({markets:[{symbol:'BTCUSDT'}]});
 if(url.includes('/api/economy'))return Response.json({items:[],projects:[],covers:{}});
 if(url.includes('/api/openrouter/models'))return Response.json({models:[{id:'fixture/model',name:'UI fixture (no inference)',pricing:{prompt:'0',completion:'0'}}]});
 if(url.includes('/api/openrouter/account'))return Response.json({connected:false});
 return Response.json({error:'UI fixture: external operations are disabled.'},{status:503});
};
