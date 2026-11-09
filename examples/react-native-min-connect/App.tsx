import { useFiberNode, useFiberPayment } from '@fiber-pay/react-native';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';

/**
 * Minimal real React Native consumer of @fiber-pay/react-native.
 *
 * This is not a demo app to run full end-to-end (it needs a reachable
 * `fnn` node URL), it exists so the package has a real RN entry point to
 * Metro-bundle in CI (see `pnpm smoke`), not just jsdom unit tests.
 */
export default function App() {
  const [nodeUrl, setNodeUrl] = useState('http://127.0.0.1:8227');
  const { state, nodeInfo, error: nodeError, client, isReady, reconnect } = useFiberNode({
    url: nodeUrl,
    enabled: false,
  });
  const { createInvoice, isPaying, error: paymentError } = useFiberPayment(client);

  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text>fiber-pay react-native min connect</Text>
      <TextInput value={nodeUrl} onChangeText={setNodeUrl} placeholder="fnn node URL" />
      <Button title="Reconnect" onPress={reconnect} disabled={!isReady && state === 'connecting'} />
      <Text>state: {state}</Text>
      {nodeInfo ? <Text>node version: {nodeInfo.version}</Text> : null}
      {nodeError ? <Text>node error: {nodeError}</Text> : null}
      <Button
        title="Create invoice"
        onPress={() => createInvoice({ amount: '0x1', currency: 'Fibt' })}
        disabled={!isReady || isPaying}
      />
      {paymentError ? <Text>payment error: {paymentError}</Text> : null}
    </View>
  );
}
