import { Box, Typography } from "@mui/material";
import { connection } from "next/server";
import { Suspense } from "react";
import { parseRitualRouteIdentity } from "@/doc/ritualRouteIdentity";
import {
  publicSqlRitualReader,
  resolveSqlRitualRouteId,
} from "@/doc/sqlRuntime";
import type { DocNode } from "@/schemas";
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

/** SQL-public content may render anonymously; every other route gets the Dexie shell. */
export default async function DocPage({
  params,
}: {
  params: Promise<{ _id: string }>;
}) {
  await connection();
  const routeId = (await params)._id;
  const routeIdentity = parseRitualRouteIdentity(routeId);
  const ritualId = await resolveSqlRitualRouteId(routeId).catch(() => null);
  const publicRitual = ritualId
    ? await publicSqlRitualReader.getRendered(ritualId).catch(() => null)
    : null;
  const publicDoc = publicRitual
    ? parsePublicDoc(publicRitual.contentJson)
    : null;
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
