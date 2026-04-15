import type { GetPaymentResult } from '@fiber-pay/sdk/browser';
import { FiberPayQuickCard } from '@fiber-pay/react';

export function App() {
  const handleInvoiceCreated = (invoice: string) => {
    // eslint-disable-next-line no-console
    console.log('Invoice created:', invoice);
  };

  const handlePaymentResult = (result: GetPaymentResult) => {
    // eslint-disable-next-line no-console
    console.log('Payment result:', result);
  };

  const handleError = (error: { scope: 'node' | 'payment' | 'invoice'; message: string }) => {
    // eslint-disable-next-line no-console
    console.error('FiberPay error:', error);
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Fiber Pay Quick Card Demo</h1>
      <p>
        This is a minimal demo of the <code>FiberPayQuickCard</code> component from{' '}
        <code>@fiber-pay/react</code>.
      </p>
      <FiberPayQuickCard
        network="testnet"
        title="Quick Card"
        onInvoiceCreated={handleInvoiceCreated}
        onPaymentResult={handlePaymentResult}
        onError={handleError}
      />
    </div>
  );
}
