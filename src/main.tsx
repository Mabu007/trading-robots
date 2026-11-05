import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {AppErrorBoundary} from './components/AppErrorBoundary';
import './style.css';
import './premium.css';
import './studio-polish.css';
import './shadcn.css';
import './chat-first.css';
import './theme.css';
import './chatgpt-shell.css';
import './chat-code-workspace.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);


if(import.meta.env.PROD&&'serviceWorker' in navigator){window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{/* App remains usable without push. */})})}
