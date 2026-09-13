import "server-only";
import { createHash } from "node:crypto";
import {
  RITUAL_OUTPUT_FORMAT,
  RITUAL_OUTPUT_FORMAT_VERSION,
} from "../doc/compileContract";
import type { SqlRitualParentRow } from "../doc/sqlPolicy";
import type { RitualRenderDescriptorV1 } from "./permissionContract";

/**
 * Bind a parent and its supported selected output from the same authorized SQL
 * snapshot. This does not select/authorize content or identify a complete bundle.
 * The v1 array order is a persisted digest contract; revision/artifact tokens and
 * source content stay internal rather than becoming descriptor fields.
 */
export function createRitualRenderDescriptor(
  parent: Pick<
    SqlRitualParentRow,
    "id" | "currentRevisionId" | "version" | "currentCompiledArtifactId"
  >,
  selected: { contentSha256: string },
): RitualRenderDescriptorV1 {
  return {
    descriptorSha256: createHash("sha256")
      .update(
        JSON.stringify([
          "magickli-ritual-render-descriptor-v1",
          parent.id,
          parent.currentRevisionId,
          parent.version,
          parent.currentCompiledArtifactId,
          selected.contentSha256,
          RITUAL_OUTPUT_FORMAT,
          RITUAL_OUTPUT_FORMAT_VERSION,
        ]),
        "utf8",
      )
      .digest("hex"),
    contentSha256: selected.contentSha256,
    outputFormat: RITUAL_OUTPUT_FORMAT,
    outputFormatVersion: RITUAL_OUTPUT_FORMAT_VERSION,
  };
}
