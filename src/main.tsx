import React from 'react';
import ReactDOM from 'react-dom/client';
import NativeApp from './native/NativeApp';
import { consumeRecoveryToken } from './native/api-client';
import './native/native.css';

const recoveryToken = consumeRecoveryToken(window.location, path => window.history.replaceState(null, '', path));

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <NativeApp initialRecoveryToken={recoveryToken} />
  </React.StrictMode>
);
