import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ccc } from '@ckb-ccc/connector-react';
import { App } from './App.tsx';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ccc.Provider defaultClient={new ccc.ClientPublicTestnet()}>
      <App />
    </ccc.Provider>
  </StrictMode>,
);
