import {Component,type ReactNode} from 'react';
export class AppErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<main className="app-recovery" role="alert"><img src="/logo.png" alt=""/><h1>Let’s reload your workspace.</h1><p>Something interrupted this screen. Reload to reconnect to your saved strategies.</p><button className="primary" onClick={()=>window.location.reload()}>Reload Trading Vibes</button><a href="/">Return to home</a></main>:this.props.children}
}
