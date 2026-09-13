import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fetchRitualAsset } from "./ritualClientTransport";

const owner = "019947c5-abcd-7000-8000-000000000001";
const ritual = "019947c5-abcd-7000-8000-000000000002";
const bundle = "019947c5-abcd-7000-8000-000000000003";
const key = "019947c5-abcd-7000-8000-000000000004";
const bytes = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg">${" ".repeat(512)}</svg>`,
);
const digest = createHash("sha256").update(bytes).digest("hex");
const compressed = gzipSync(bytes);
let origin: string;
const server = createServer((_request, response) => {
  response.writeHead(200, {
    "cache-control": "private, no-store",
    "content-type": "image/svg+xml",
    "content-encoding": "gzip",
    "content-length": String(compressed.length),
    "x-content-sha256": digest,
  });
  response.end(compressed);
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test listener");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubGlobal("location", new URL(origin));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  if (server.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const asset = {
  key,
  reference: "/synthetic.svg",
  sha256: digest,
  mime: "image/svg+xml" as const,
  bytes: bytes.length,
  purpose: "read" as const,
};
const transport: typeof fetch = (input, init) =>
  fetch(new URL(String(input), origin), init);

it("verifies decoded asset bytes through a real compressed HTTP response", async () => {
  expect(compressed.length).not.toBe(bytes.length);
  const result = await fetchRitualAsset(
    owner,
    ritual,
    bundle,
    asset,
    new AbortController().signal,
    transport,
  );
  expect(result?.type).toBe("image/svg+xml");
  expect(Buffer.from(await result!.arrayBuffer())).toEqual(bytes);
});

it("rejects a compressed body that expands past its manifest byte bound", async () => {
  expect(
    await fetchRitualAsset(
      owner,
      ritual,
      bundle,
      { ...asset, bytes: bytes.length - 1 },
      new AbortController().signal,
      transport,
    ),
  ).toBeNull();
});
