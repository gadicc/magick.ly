import { SourceMapConsumer } from "source-map";

// Both bundlers emit the WASM as a static asset. The service worker precaches
// build assets, so the editor can still map source offline.
SourceMapConsumer.initialize({
  "lib/mappings.wasm": new URL("source-map/lib/mappings.wasm", import.meta.url)
    .href,
});

export default SourceMapConsumer;
