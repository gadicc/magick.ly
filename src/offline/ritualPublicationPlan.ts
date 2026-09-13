import "server-only";

import path from "node:path";
import { createExternalRitualImageCatalog } from "../files/externalRitualImageCatalog";
import { createGeneratedRitualImageCatalog } from "../files/generatedRitualImageCatalog";
import { readLegacyPublicR2Config } from "../files/legacyPublicR2";
import type { LegacyRitualImageSource } from "../files/legacyRitualImageCatalog";
import { createLegacyRitualImageCatalog } from "../files/legacyRitualImageCatalog";
import { legacyStaticImageAliases } from "../files/legacyStaticImages";
import { createPrivateRitualImageCatalog } from "../files/privateRitualImageCatalog";
import type { RitualFileLocator } from "../files/ritualFileLocator";
import type { AuthorizedRitualFile } from "../files/ritualFileService";
import { RITUAL_PUBLICATION_STATIC_PATHS } from "../files/ritualPublicationStaticPaths";
import { createStaticRitualImageCatalog } from "../files/staticRitualImageCatalog";
import {
  type PreparedRitualBundle,
  prepareRitualBundle,
} from "./prepareRitualBundle";
import { inventoryRitualAssetJson } from "./ritualAssetInventory";
import { createRitualAssetPlan, type RitualAssetPlan } from "./ritualAssetPlan";
import { deriveRitualPublicationIdentity } from "./ritualPublicationIdentity";
import type { RitualPublicationSelection } from "./sqlRitualPublicationSelection";

const KNOWN_APP_ORIGINS = ["https://magick.ly"] as const;
const STATIC_INVENTORY_PATHS = Object.freeze([
  ...RITUAL_PUBLICATION_STATIC_PATHS,
  ...Object.keys(legacyStaticImageAliases),
]);

interface RitualPublicationPlanDependencies {
  publicDirectory: string;
  environment: Readonly<Record<string, string | undefined>>;
  readAuthorizedPrivateFile(
    locator: RitualFileLocator,
  ): Promise<AuthorizedRitualFile | null>;
  loadLegacySources(
    sha256: readonly string[],
  ): Promise<LegacyRitualImageSource[]>;
}

const unique = (values: readonly string[]) => [...new Set(values)].sort();
/**
 * Builds owned v5/v3 evidence from the exact authorized selected rendering.
 * Catalogs are closed to reviewed static paths, protected SQL/R2 snapshots,
 * canonical private locators, the fixed external allowlist and local renderers.
 */
export function createRitualPublicationPlanBuilder(
  dependencies: RitualPublicationPlanDependencies,
) {
  if (
    !path.isAbsolute(dependencies.publicDirectory) ||
    path.resolve(dependencies.publicDirectory) !== dependencies.publicDirectory
  )
    throw new TypeError("Invalid ritual publication public directory");
  return async function build(
    input: { selection: RitualPublicationSelection; operationId: string },
    signal = new AbortController().signal,
  ): Promise<PreparedRitualBundle> {
    const inventory = inventoryRitualAssetJson(input.selection.contentJson, {
      knownAppOrigins: KNOWN_APP_ORIGINS,
      staticPaths: STATIC_INVENTORY_PATHS,
    });
    const occurrences = inventory.occurrences;
    const staticPaths = unique(
      occurrences.flatMap((item) => {
        if (item.reference.kind !== "local-static") return [];
        const pathname = item.reference.pathname;
        return [
          legacyStaticImageAliases[
            pathname as keyof typeof legacyStaticImageAliases
          ] ?? pathname,
        ];
      }),
    );
    const privateReferences = unique(
      occurrences.flatMap((item) =>
        item.reference.kind === "private-ritual-file"
          ? [item.networkReference]
          : [],
      ),
    );
    const externalReferences = unique(
      occurrences.flatMap((item) =>
        item.reference.kind === "external" ? [item.networkReference] : [],
      ),
    );
    const generatedReferences = unique(
      occurrences.flatMap((item) =>
        item.reference.kind === "generated-tree-of-life"
          ? [item.networkReference]
          : [],
      ),
    );
    const legacyDigests = unique(
      occurrences.flatMap((item) =>
        item.reference.kind === "legacy-file2" ? [item.reference.sha256] : [],
      ),
    );
    const catalogs: { dispose(): void }[] = [];
    let plan: RitualAssetPlan | undefined;
    try {
      const staticCatalog = await createStaticRitualImageCatalog({
        publicDirectory: dependencies.publicDirectory,
        paths: staticPaths,
        signal,
      });
      catalogs.push(staticCatalog);
      const privateCatalog = privateReferences.length
        ? await createPrivateRitualImageCatalog({
            references: privateReferences,
            readAuthorized: dependencies.readAuthorizedPrivateFile,
            signal,
          })
        : undefined;
      if (privateCatalog) catalogs.push(privateCatalog);
      const externalCatalog = externalReferences.length
        ? await createExternalRitualImageCatalog({
            references: externalReferences,
            signal,
          })
        : undefined;
      if (externalCatalog) catalogs.push(externalCatalog);
      const generatedCatalog = generatedReferences.length
        ? await createGeneratedRitualImageCatalog({
            references: generatedReferences,
            knownAppOrigins: KNOWN_APP_ORIGINS,
            signal,
          })
        : undefined;
      if (generatedCatalog) catalogs.push(generatedCatalog);
      const legacyCatalog = legacyDigests.length
        ? await createLegacyRitualImageCatalog({
            storage: readLegacyPublicR2Config(dependencies.environment),
            sources: await dependencies.loadLegacySources(legacyDigests),
            signal,
          })
        : undefined;
      if (legacyCatalog) catalogs.push(legacyCatalog);
      plan = await createRitualAssetPlan(input.selection.contentJson, {
        contentSha256: input.selection.descriptor.contentSha256,
        knownAppOrigins: KNOWN_APP_ORIGINS,
        staticCatalog,
        ...(privateCatalog ? { privateCatalog } : {}),
        ...(externalCatalog ? { externalCatalog } : {}),
        ...(generatedCatalog ? { generatedCatalog } : {}),
        ...(legacyCatalog ? { legacyCatalog } : {}),
        signal,
      });
      return await prepareRitualBundle({
        ritualId: input.selection.ritualId,
        title: input.selection.title,
        contentJson: input.selection.contentJson,
        descriptor: input.selection.descriptor,
        plan,
        identity: deriveRitualPublicationIdentity(
          input.operationId,
          plan.metadata.assets.length,
        ),
        signal,
      });
    } finally {
      plan?.dispose();
      for (const catalog of catalogs.reverse()) catalog.dispose();
    }
  };
}
