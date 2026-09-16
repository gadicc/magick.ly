import { Box, Typography } from "@mui/material";
import type { Metadata } from "next";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { parseRitualRouteIdentity } from "@/doc/ritualRouteIdentity";
import {
  publicSqlRitualReader,
  resolveSqlRitualRouteId,
} from "@/doc/sqlRuntime";
import type { DocNode } from "@/schemas";
import { privateMetadata, seoMetadata } from "@/seo/metadata";
import DocRender from "./DocRender";
import PrivateRitualReader from "./PrivateRitualReader";

function parsePublicDoc(contentJson: string): DocNode | null {
  try {
    const value: unknown = JSON.parse(contentJson);
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).type === "string"
      ? (value as DocNode)
      : null;
  } catch {
    return null;
  }
}

/** One anonymous lookup per request, shared by the metadata and the page. */
const loadPublicRitual = cache(async (routeId: string) => {
  const ritualId = await resolveSqlRitualRouteId(routeId).catch(() => null);
  const publicRitual = ritualId
    ? await publicSqlRitualReader.getRendered(ritualId).catch(() => null)
    : null;
  const publicDoc = publicRitual
    ? parsePublicDoc(publicRitual.contentJson)
    : null;
  return { ritualId, publicRitual, publicDoc };
});

/** Only anonymous, SQL-public rituals are indexed, under their canonical id. */
export async function generateMetadata({
  params,
}: PageProps<"/doc/[_id]">): Promise<Metadata> {
  await connection();
  const { publicRitual, publicDoc } = await loadPublicRitual(
    (await params)._id,
  );
  if (!publicRitual || !publicDoc) return privateMetadata("Ritual");
  const { id, title } = publicRitual.ritual;
  return seoMetadata(`/doc/${id}`, {
    title,
    description: `${title}: a public ritual on Magick.ly, laid out for reading on phones and tablets.`,
  });
}

/** SQL-public content may render anonymously; every other route gets the Dexie shell. */
export default async function DocPage({ params }: PageProps<"/doc/[_id]">) {
  await connection();
  const routeId = (await params)._id;
  const routeIdentity = parseRitualRouteIdentity(routeId);
  const { ritualId, publicRitual, publicDoc } = await loadPublicRitual(routeId);
  if (publicRitual && publicDoc)
    return (
      <Box>
        <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
          {publicRitual.ritual.title}
        </Typography>
        <Suspense fallback={<div>Loading ritual...</div>}>
          <DocRender doc={publicDoc} />
        </Suspense>
      </Box>
    );
  return (
    <Suspense fallback={<div>Loading ritual...</div>}>
      <PrivateRitualReader
        resolvedRitualId={ritualId}
        routeAlias={
          routeIdentity?.kind === "legacy-objectid"
            ? routeIdentity.legacyId
            : null
        }
      />
    </Suspense>
  );
}
