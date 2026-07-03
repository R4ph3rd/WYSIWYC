import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AnalysisPage } from './ui/AnalysisPage';
import './index.css';

const pathname = window.location.pathname;
const Root = pathname.endsWith('/analysis') ? AnalysisPage : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
