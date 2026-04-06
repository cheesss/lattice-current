import { parentPort } from 'node:worker_threads';
import { runTruthDiscovery } from './truth-discovery';

parentPort?.on('message', (msg: { claims: Parameters<typeof runTruthDiscovery>[0]; options: Parameters<typeof runTruthDiscovery>[1] }) => {
  const result = runTruthDiscovery(msg.claims, msg.options);
  parentPort?.postMessage(result);
});
