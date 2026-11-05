import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, CircleHelp, Sparkles, X } from 'lucide-react';
import './GuidedLearning.css';

type Lesson = {
  name: string;
  kicker: string;
  minutes: string;
  explanation: string;
  simpler: string;
  question: string;
  choices: string[];
  correct: number;
  feedback: string;
};
const lessons: Lesson[] = [
  { name: 'What is trading?', kicker: 'THE FIRST CONCEPT', minutes: '2 MIN',
    explanation: 'Trading means exchanging an asset at one price and later closing that position at another. The difference, after costs, can be a gain or a loss. Markets are uncertain: no one knows the next price with certainty.',
    simpler: 'You open a position expecting a change in price. If price moves against you, you can lose money. Trading is not a guaranteed way to earn an income.',
    question: 'Which statement best describes trading?', choices: ['A reliable way to double savings', 'Taking a position where prices can rise or fall', 'A system with no possible losses'], correct: 1,
    feedback: 'Correct. Price changes create both opportunity and risk. Learning starts with understanding uncertainty.' },
  { name: 'Reading a candlestick', kicker: 'READ THE MARKET', minutes: '3 MIN',
    explanation: 'Each candle summarises price movement in a fixed interval: open, high, low and close (OHLC). A green candle typically closes above its open; a red one closes below it. Neither colour alone predicts what comes next.',
    simpler: 'Think of a candle as a short price story: where the price started, its highest and lowest points, and where it finished.',
    question: 'What can a single candlestick tell you?', choices: ['Exactly where the next candle will close', 'The open, high, low and close for an interval', 'Whether a trade is guaranteed to win'], correct: 1,
    feedback: 'Right. Candles describe past price action. They do not guarantee future price direction.' },
  { name: 'Risk before reward', kicker: 'PROTECT THE ACCOUNT', minutes: '3 MIN',
    explanation: 'A stop-loss is a planned exit level intended to limit losses, but actual fills can be worse during fast markets. Position sizing determines how much a price move affects your account. Percentage risk and daily loss caps help prevent one idea from dominating your account.',
    simpler: 'Decide how much you are prepared to lose before entering. Do not use money you cannot afford to lose.',
    question: 'Why calculate position size before a trade?', choices: ['To guarantee the target will be hit', 'To define the amount at risk if the stop is reached', 'To remove market volatility'], correct: 1,
    feedback: 'Exactly. A good risk plan controls your exposure, not the market outcome.' },
  { name: 'What is a trading robot?', kicker: 'RULES INTO SOFTWARE', minutes: '3 MIN',
    explanation: 'A trading robot is software that evaluates rules against market data and may place authorised orders through a connected venue. A robot is only as reliable as its logic, data, execution controls and operational monitoring. Automation does not make a strategy profitable.',
    simpler: 'It is a program that follows trading rules. It may do them automatically, but it can still make losing trades or encounter technical problems.',
    question: 'Which is true about automated strategies?', choices: ['They can still lose money', 'They always outperform human traders', 'They cannot fail technically'], correct: 0,
    feedback: 'Yes. Every strategy should be tested, monitored and controlled by its user.' },
  { name: 'What does a backtest prove?', kicker: 'TEST YOUR IDEAS', minutes: '3 MIN',
    explanation: 'A backtest runs strategy rules against historical market data to inspect hypothetical performance. It can reveal weak assumptions, costs, gaps and drawdowns. Results depend on the chosen data and execution model; past performance does not prove future returns.',
    simpler: 'A backtest asks: “What would these rules have done in the past?” It does not tell you exactly what will happen tomorrow.',
    question: 'What is a backtest primarily useful for?', choices: ['Guaranteeing future profits', 'Studying how rules behaved on historical data', 'Removing the need for live risk controls'], correct: 1,
    feedback: 'Correct. Backtesting is evidence for learning, not a promise of future profits.' },
];
export function GuidedLearning({ uid, onClose, onAsk, onCreate }: { uid: string; onClose: () => void; onAsk: (question: string) => void; onCreate: () => void }) {
  const key = 'trading-vibes:learning:' + uid;
  const [step, setStep] = useState(() => { try { const n = Number(localStorage.getItem(key)); return Number.isInteger(n) && n >= 0 && n < lessons.length ? n : 0; } catch { return 0; } });
  const [picked, setPicked] = useState<number | null>(null);
  const [simple, setSimple] = useState(false);
  const [completed, setCompleted] = useState<number[]>(() => { try { const x = JSON.parse(localStorage.getItem(key + ':complete') || '[]'); return Array.isArray(x) ? x.filter(v => Number.isInteger(v) && v >= 0 && v < lessons.length) : []; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(key, String(step)); localStorage.setItem(key + ':complete', JSON.stringify(completed)); } catch {} }, [key, step, completed]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [onClose]);
  const lesson = lessons[step];
  const correct = picked === lesson.correct;
  const next = () => { if (step < lessons.length - 1) { setStep(v => v + 1); setPicked(null); setSimple(false); } else onCreate(); };
  return <div className="tvx-learning-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="tvx-learning" role="dialog" aria-modal="true" aria-labelledby="tvx-lesson-title">
    <header><button onClick={onClose} aria-label="Close lesson"><X size={20}/></button><span><BookOpen size={17}/> LEARNING STUDIO</span><span>{completed.length} / {lessons.length}</span></header>
    <div className="tvx-learning-progress" aria-label={'Completed ' + completed.length + ' of ' + lessons.length + ' lessons'}>{lessons.map((_, i) => <button key={i} className={i === step ? 'active' : completed.includes(i) ? 'complete' : ''} title={'Lesson ' + (i + 1)} onClick={() => { setStep(i); setPicked(null); setSimple(false); }} aria-label={'Jump to lesson ' + (i + 1)}/>)}</div>
    <div className="tvx-lesson-body"><div className="tvx-lesson-kicker"><span>{lesson.kicker}</span><small>{lesson.minutes}</small></div><h2 id="tvx-lesson-title">{lesson.name}</h2>
      {step === 1 ? <div className="tvx-candle-illustration" role="img" aria-label="Illustration of green and red price candles showing each candle's high, low, open and close"><span className="tvx-candle up"/><span className="tvx-candle down"/><span className="tvx-candle up"/><span className="tvx-candle up"/><span className="tvx-candle down"/></div> : <div className="tvx-learning-orb"><Sparkles size={26}/></div>}
      <p>{simple ? lesson.simpler : lesson.explanation}</p><div className="tvx-lesson-help"><button onClick={() => setSimple(v => !v)}><CircleHelp size={15}/>{simple ? 'Show fuller explanation' : 'Explain simpler'}</button><button onClick={() => onAsk('Can you explain ' + lesson.name.toLowerCase() + ' with a simple South African example and one practice question?')}><Sparkles size={15}/> Ask the AI</button></div>
      <div className="tvx-lesson-checkpoint"><span className="tvx-learning-label">CHECK YOUR UNDERSTANDING</span><h3>{lesson.question}</h3><div>{lesson.choices.map((choice, index) => <button key={choice} disabled={completed.includes(step)} className={picked === index ? (correct ? 'correct' : 'incorrect') : ''} onClick={() => { setPicked(index); if (index === lesson.correct) setCompleted(old => [...new Set([...old, step])]); }}><span className="tvx-check-circle">{picked === index && correct ? <Check size={14}/> : String.fromCharCode(65 + index)}</span>{choice}</button>)}</div>{picked !== null && <p role="status" className={correct ? 'tvx-lesson-feedback good' : 'tvx-lesson-feedback'}>{correct ? lesson.feedback : 'Not quite. Read the explanation and try again.'}</p>}</div>
      <footer><button className="tvx-lesson-back" onClick={() => { setStep(v => Math.max(0, v - 1)); setPicked(null); setSimple(false); }} disabled={!step}><ArrowLeft size={17}/> Previous</button><button className="tvx-lesson-next" disabled={!completed.includes(step)} onClick={next}>{step === lessons.length - 1 ? 'Create your first robot' : 'Next lesson'}<ArrowRight size={17}/></button></footer>
      <p className="tvx-learning-note">Educational content only. Examples are illustrative, not personalised investment advice.</p>
    </div>
  </section></div>;
}
