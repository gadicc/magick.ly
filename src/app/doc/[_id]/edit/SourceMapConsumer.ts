// @ts-expect-error: no types
import sourceMapMappings from "arraybuffer-loader!source-map/lib/mappings.wasm";
import { SourceMapConsumer } from "source-map";

SourceMapConsumer.initialize({
  "lib/mappings.wasm": sourceMapMappings,
});

export default SourceMapConsumer;
