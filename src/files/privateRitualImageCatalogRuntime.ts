import "server-only";

import { createPrivateRitualImageCatalog } from "./privateRitualImageCatalog";
import { readAuthorizedRitualFile } from "./runtime";

export function createCurrentPrivateRitualImageCatalog(
  references: readonly string[],
  signal?: AbortSignal,
) {
  return createPrivateRitualImageCatalog({
    references,
    readAuthorized: readAuthorizedRitualFile,
    signal,
  });
}
