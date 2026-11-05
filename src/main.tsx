import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {AppErrorBoundary} from './components/AppErrorBoundary';
import './style.css';
import './premium.css';
import './studio-polish.css';
import './shadcn.css';
import './chat-first.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App /></AppErrorBoundary></React.StrictMode>);

