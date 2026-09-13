import "server-only";

import { inventoryRitualAssetJson } from "../offline/ritualAssetInventory";
import {
  formatRitualFileLocator,
  type RitualFileLocator,
} from "./ritualFileLocator";
import type { RitualFileRecord } from "./repository";

export interface RenderedRitualForFileAccess {
  ritual: { id: string; canEdit: boolean };
  contentJson: string;
}

export interface RitualFileAccessReader {
  getRendered(ritualId: string): Promise<RenderedRitualForFileAccess | null>;
}

/**
 * Authorization is based on the current selected rendered ritual. A link or an
 * uploader identity alone never permits download.
 */
export function createRitualFileAuthorizer(reader: RitualFileAccessReader) {
  return async function authorize(
    record: RitualFileRecord,
    locator: RitualFileLocator,
  ): Promise<boolean> {
    if (
      locator.ritualId !== record.ritualId ||
      locator.attachmentId !== record.attachmentId ||
      locator.fileId !== record.id
    )
      return false;
    const selected = await reader.getRendered(record.ritualId);
    if (!selected || selected.ritual.id !== record.ritualId) return false;
    // Editors need a newly finalized attachment before their unsaved source can
    // contain its locator. This grant still comes from the fresh ritual policy.
    if (selected.ritual.canEdit) return true;
    const source = formatRitualFileLocator(locator);
    const inventory = inventoryRitualAssetJson(selected.contentJson, {
      knownAppOrigins: [],
      staticPaths: [],
    });
    return (
      inventory.enumerationComplete &&
      inventory.occurrences.some(
        (occurrence) =>
          occurrence.networkReference === source &&
          occurrence.reference.kind === "private-ritual-file" &&
          occurrence.reference.ritualId === locator.ritualId &&
          occurrence.reference.attachmentId === locator.attachmentId &&
          occurrence.reference.fileId === locator.fileId,
      )
    );
  };
}
