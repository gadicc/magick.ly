// @ts-expect-error: no types
import sourceMapMappings from "arraybuffer-loader!source-map/lib/mappings.wasm";
import { SourceMapConsumer } from "source-map";

// @ts-expect-error: not in spec but exists
SourceMapConsumer.initialize({
  "lib/mappings.wasm": sourceMapMappings,
});

export default SourceMapConsumer;
