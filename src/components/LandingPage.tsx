import {Activity,ArrowDown,ArrowRight,BookOpen,ChartCandlestick,Check,ChevronDown,Code2,History,LockKeyhole,MessageSquare,ShieldCheck,Sparkles,Wallet} from 'lucide-react';
import './landing-vibes.css';

const workflow = [
 {title:'Explore a market',description:'Ask VIBES what changed. Open the chart, check the timeframe and follow the sources.',Icon:MessageSquare},
 {title:'Build a strategy',description:'Describe the setup, entry, exit and risk rules. Review the editable strategy that VIBES prepares.',Icon:Code2},
 {title:'Backtest your rules',description:'Choose a historical window and see trades, drawdown and the inputs behind the result.',Icon:History},
 {title:'Review a deployment',description:'Choose a PropDAO account and confirm the settings yourself. Track the runtime from Robots.',Icon:ShieldCheck},
];

const questions = [
 ['How do I get in?', 'Trading Vibes is invite-only. Use the email and password provided by the team. If you already have an account, you can reset your password from the sign-in page.'],
 ['Do I need to write code?', 'You can start with a plain-language idea. VIBES prepares editable strategy code that you can inspect, test and revise before deployment.'],
 ['What powers the AI and market data?', 'Connect your own OpenRouter account for VIBES. Supported market views use Hyperliquid data, with links and timestamps so you can check the evidence.'],
 ['Can a strategy place orders?', 'A supported PropDAO strategy can run after you select an account and explicitly approve the deployment. PropDAO evaluation and funded accounts use simulated capital.'],
 ['What does a backtest tell me?', 'It shows how the strategy behaved under the selected historical data and simulation assumptions. Coverage gaps, execution costs and fills can affect what the result tells you.'],
];

const examplePrices=[41,38,45,42,51,47,53,60,56,62,54,58,68,65,70,64,73,77,69,75,80];
function ChartPreview(){
 return <svg viewBox="0 0 480 145" role="img" aria-label="Illustrative candlestick chart">
  <path d="M0 35H480M0 72H480M0 109H480M96 0V145M192 0V145M288 0V145M384 0V145" className="vl-chart-grid"/>
  {examplePrices.map((close,index)=>{
   const open=examplePrices[index-1]??37, x=12+index*22.5,y=128-Math.max(open,close),height=Math.abs(close-open);
   return <g key={index} className={close>=open?'vl-up':'vl-down'}>
    <line x1={x} x2={x} y1={y-7-(index%4)} y2={y+height+6}/>
    <rect x={x-4.5} y={y} width={9} height={height} rx={1.4}/>
   </g>;
  })}
 </svg>;
}
function SignIn({className='vl-button'}:{className?:string}){
 return <a className={className} href="/sign-in">Sign in <ArrowRight size={17} aria-hidden="true"/></a>;
}
export function LandingPage(){
 return <main className="vl-landing" id="top">
  <header className="vl-nav"><div className="vl-wrap vl-nav-row">
   <a href="#top" className="vl-brand"><img src="/logo.png" alt=""/><span>Trading Vibes</span></a>
   <nav aria-label="Product navigation"><a href="#research">VIBES</a><a href="#workflow">Workflow</a><a href="#strategy">Robots</a><a href="#faq">FAQ</a></nav>
   <SignIn className="vl-nav-signin"/>
  </div></header>

  <section className="vl-hero" aria-labelledby="vl-title"><div className="vl-wrap vl-hero-grid">
   <div><div className="vl-kicker"><i/> Invite-only access</div>
    <h1 id="vl-title">Turn market ideas into <em>testable strategies.</em></h1>
    <p>Ask VIBES about the market, turn your rules into editable code and see how they would have behaved on historical data.</p>
    <div className="vl-actions"><SignIn/><a href="#workflow" className="vl-text-link">See how it works <ArrowDown size={15} aria-hidden="true"/></a></div>
    <div className="vl-hero-notes"><span><Check size={14}/> Source-linked research</span><span><Check size={14}/> PropDAO-first execution</span></div>
   </div>
   <figure className="vl-demo">
    <div className="vl-demo-header"><span><Sparkles size={15}/> VIBES</span><span>Workspace preview</span></div>
    <div className="vl-demo-chat"><p className="vl-demo-user">What should I check before testing a Gold setup?</p><p>Start with the exact market, timeframe and entry rules. Then replay the same setup on completed candles.</p></div>
    <div className="vl-demo-chart"><div><strong><ChartCandlestick size={15}/> Gold setup</strong><span>H4 · Example</span></div><ChartPreview/></div>
    <figcaption>Illustrative workspace · chart uses example data</figcaption>
   </figure>
  </div></section>

  <section className="vl-section vl-research" id="research" aria-labelledby="vl-research-title"><div className="vl-wrap vl-split">
   <div><div className="vl-kicker"><Sparkles size={15}/> Market research</div><h2 id="vl-research-title">Ask a real market question.</h2><p>Get a quick read on a supported market, learn what an indicator measures or look into a news story. VIBES separates observed prices from possible explanations.</p></div>
   <div className="vl-research-list">
    <div><ChartCandlestick size={20}/><span><strong>Charts inside chat</strong><small>Open the candles and see the timeframe and marked highs and lows.</small></span></div>
    <div><Activity size={20}/><span><strong>Evidence you can check</strong><small>Expand Sources and follow the available market and news links.</small></span></div>
    <div><History size={20}/><span><strong>UTC and South African time</strong><small>Compare times in the same answer, for example 12:00 UTC (14:00 SAST).</small></span></div>
   </div>
  </div></section>

  <section className="vl-section vl-workflow" id="workflow" aria-labelledby="vl-workflow-title"><div className="vl-wrap">
   <div className="vl-kicker">The workflow</div><h2 id="vl-workflow-title">From first question to a reviewed plan.</h2>
   <div className="vl-steps">{workflow.map(({title,description,Icon},index)=><article key={title}><div><Icon size={22} aria-hidden="true"/><span>0{index+1}</span></div><h3>{title}</h3><p>{description}</p></article>)}</div>
  </div></section>

  <section className="vl-section vl-strategy" id="strategy" aria-labelledby="vl-strategy-title"><div className="vl-wrap vl-split">
   <div><div className="vl-kicker"><Code2 size={15}/> Robots and backtesting</div><h2 id="vl-strategy-title">See what the test actually did.</h2><p>Keep your code, rules and saved results together. Inspect trades and metrics, revise the strategy and replay it over a specific date range.</p><p className="vl-note">Backtests simulate execution on the available data. Historical results carry no promise of future returns.</p></div>
   <div className="vl-result"><div className="vl-result-head"><Activity size={19}/><div><strong>Gold strategy replay</strong><small>Illustrative WAIT-only test</small></div><span>Simulation</span></div>
    <dl><div><dt>Candles replayed</dt><dd>576</dd></div><div><dt>Trades opened</dt><dd>0</dd></div><div><dt>Execution chart</dt><dd>M5</dd></div></dl>
    <div className="vl-result-foot"><Check size={15}/> A run can finish without a trade. That outcome belongs in the report.</div>
   </div>
  </div></section>

  <section className="vl-section vl-control" aria-labelledby="vl-control-title"><div className="vl-wrap">
   <div className="vl-kicker"><ShieldCheck size={16}/> PropDAO controls</div><h2 id="vl-control-title">You decide when automation starts.</h2><p className="vl-lede">Review the exact account and settings before authorizing a supported strategy on PropDAO’s simulated-capital accounts.</p>
   <div className="vl-control-grid"><div><strong>Review</strong><p>Inspect the strategy and the deployment settings before you approve.</p></div><div><strong>Monitor</strong><p>Check verified runtime status and account activity from the workspace.</p></div><div><strong>Stop</strong><p>Use the stop review to disable new orders. Manage existing positions separately.</p></div></div>
  </div></section>

  <section className="vl-section vl-personal" aria-labelledby="vl-personal-title"><div className="vl-wrap">
   <div className="vl-kicker">Your workspace</div><h2 id="vl-personal-title">Make it work the way you do.</h2>
   <div className="vl-steps vl-three">
    <article><div><BookOpen size={22}/></div><h3>Skills</h3><p>Save your research checklist or explanation style. Enable a skill and give it a trigger phrase.</p></article>
    <article><div><Sparkles size={22}/></div><h3>OpenRouter</h3><p>Bring your own AI account and choose a model for each conversation.</p></article>
    <article><div><Wallet size={22}/></div><h3>PropDAO</h3><p>Connect your developer key to view supported account activity and review deployments.</p></article>
   </div>
  </div></section>

  <section className="vl-section vl-faq" id="faq" aria-labelledby="vl-faq-title"><div className="vl-wrap vl-split">
   <div><div className="vl-kicker">Before you sign in</div><h2 id="vl-faq-title">Good questions.</h2></div>
   <div className="vl-faq-list">{questions.map(([q,a])=><details key={q}><summary>{q}<ChevronDown size={17} aria-hidden="true"/></summary><p>{a}</p></details>)}</div>
  </div></section>

  <section className="vl-section vl-invite" aria-labelledby="vl-invite-title"><div className="vl-wrap vl-invite-inner">
   <div><div className="vl-kicker"><LockKeyhole size={15}/> Private workspace</div><h2 id="vl-invite-title">Got an invitation?</h2><p>Sign in with the email and password provided by Trading Vibes.</p></div><SignIn/>
  </div></section>
  <footer className="vl-footer"><div className="vl-wrap"><a href="#top" className="vl-brand"><img src="/logo.png" alt=""/><span>Trading Vibes</span></a><span>Market research · Robot development · PropDAO</span><a href="/sign-in">Sign in</a></div></footer>
 </main>;
}
