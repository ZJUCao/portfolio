// Entry of the camera AR tracking worker (design §5.4): it creates one pipeline, passes every
// message to handleWorkerMessage and posts each reply with its transfer list. All logic lives in
// pipeline.ts, so this bundle holds no three.js or DOM code (§4).

import { type WorkerRequest, type WorkerResponse, createPipeline, handleWorkerMessage } from "./pipeline";

// The part of the dedicated worker scope used here; the project's TypeScript lib is "dom", which
// types `self` as a window, not "webworker"
interface WorkerScope {
  onmessage: ((event: { readonly data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const pipeline = createPipeline();

scope.onmessage = (event) => {
  const handled = handleWorkerMessage(pipeline, event.data);
  if (handled !== null) scope.postMessage(handled.reply, handled.transfer);
};
