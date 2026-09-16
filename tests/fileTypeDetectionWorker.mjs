// Runs file-type detection off the test thread so a parser that never yields
// (the class of defect behind GHSA-5v7r-6r5c-r473) can be terminated by a
// deadline instead of starving the whole Vitest worker.
import { parentPort, workerData } from "node:worker_threads";
import { fileTypeFromBuffer } from "file-type";

const result = await fileTypeFromBuffer(new Uint8Array(workerData));
parentPort.postMessage(result ?? null);
