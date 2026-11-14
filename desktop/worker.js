import { parentPort, workerData } from 'node:worker_threads';
import { runJob } from './backend.js';

try {
  const result = await runJob(workerData.action, workerData.request, (stage) => parentPort.postMessage({ stage }));
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
