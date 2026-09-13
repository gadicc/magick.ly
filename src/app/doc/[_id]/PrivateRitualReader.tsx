"use client";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { usePathname } from "next/navigation";
import React from "react";
import {
  parseRitualRouteIdentity,
  ritualRouteIdFromPath,
} from "@/doc/ritualRouteIdentity";
import { getBrowserOfflineRuntime } from "@/offline/browserRuntime";
import type { OfflineOperation } from "@/offline/lifecycle";
import { refreshOfflineRitual } from "@/offline/ritualDownload";
import type { RitualBundle } from "@/offline/storage";
import type { DocNode } from "@/schemas";
import DocRender from "./DocRender";

type ReaderState =
  | {
      routeKey: string;
      kind: "loading" | "locked" | "unavailable";
      title: null;
      doc: null;
    }
  | { routeKey: string; kind: "ready"; title: string; doc: DocNode };

function currentRouteId(routerPathname: string): string | null {
  return (
    ritualRouteIdFromPath(routerPathname) ??
    (typeof window === "undefined"
      ? null
      : ritualRouteIdFromPath(window.location.pathname))
  );
}

function renderBundle(
  bundle: RitualBundle,
  urls: ReadonlyMap<string, string>,
): DocNode | null {
  try {
    const doc: unknown = JSON.parse(bundle.renderedJson);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    for (const occurrence of bundle.occurrences) {
      let node = doc as Record<string, unknown>;
      for (const index of occurrence.path) {
        const children = node.children;
        if (!Array.isArray(children) || !children[index]) return null;
        node = children[index] as Record<string, unknown>;
      }
      const url = urls.get(occurrence.assetKey);
      if (node.src !== occurrence.src || !url) return null;
      node.src = url + occurrence.displayFragment;
    }
    return doc as DocNode;
  } catch {
    return null;
  }
}

export default function PrivateRitualReader({
  resolvedRitualId = null,
  routeAlias = null,
}: {
  resolvedRitualId?: string | null;
  routeAlias?: string | null;
}) {
  const routerPathname = usePathname();
  const routeId = currentRouteId(routerPathname);
  const validRoute = parseRitualRouteIdentity(routeId) !== null;
  const routeKey = JSON.stringify([routeId, resolvedRitualId, routeAlias]);
  const [ritual, setRitual] = React.useState<{
    routeKey: string;
    id: string | null;
  }>({ routeKey, id: null });
  const [state, setState] = React.useState<ReaderState>({
    routeKey,
    kind: "loading",
    title: null,
    doc: null,
  });
  const refreshRef = React.useRef<() => void>(() => {});
  const showingProtectedContent = React.useRef(false);

  React.useEffect(() => {
    const identity = parseRitualRouteIdentity(routeId);
    showingProtectedContent.current = false;
    setRitual({ routeKey, id: null });
    setState({ routeKey, kind: "loading", title: null, doc: null });
    if (!identity) {
      setState({ routeKey, kind: "unavailable", title: null, doc: null });
      return;
    }
    let disposed = false;
    let runtime: ReturnType<typeof getBrowserOfflineRuntime>;
    try {
      runtime = getBrowserOfflineRuntime();
    } catch {
      setState({ routeKey, kind: "unavailable", title: null, doc: null });
      return;
    }
    let loadSequence = 0;
    let refreshing = false;
    let id: string | null = null;
    let registration: ReturnType<typeof runtime.coordinator.register> | null =
      null;

    const load = async () => {
      const sequence = ++loadSequence;
      const account = runtime.coordinator.state.account;
      const operation: OfflineOperation | null = registration?.begin() ?? null;
      if (!account || !operation || !id) return;
      try {
        const bundle = await runtime.repository.readBundle(account, id);
        if (!bundle || operation.signal.aborted) return;
        const urls = new Map<string, string>();
        for (const asset of bundle.assets) {
          const blob = await runtime.repository.readAsset(
            account,
            id,
            asset.key,
          );
          if (!blob || operation.signal.aborted) return;
          const url = runtime.coordinator.objectURL(operation, blob);
          if (!url) return;
          urls.set(asset.key, url);
        }
        const doc = renderBundle(bundle, urls);
        if (!doc) return;
        runtime.coordinator.commit(operation, () => {
          if (!disposed && sequence === loadSequence) {
            showingProtectedContent.current = true;
            setState({ routeKey, kind: "ready", title: bundle.title, doc });
          }
        });
      } catch {
        if (!disposed && !showingProtectedContent.current)
          setState({ routeKey, kind: "unavailable", title: null, doc: null });
      } finally {
        runtime.coordinator.finish(operation);
      }
    };

    const refresh = async () => {
      if (refreshing || disposed || !registration || !id) return;
      refreshing = true;
      try {
        await refreshOfflineRitual(runtime, registration, id, {
          ...(identity.kind === "legacy-objectid"
            ? { routeAlias: identity.legacyId }
            : {}),
        });
      } catch {
        // Account/epoch changes and storage failures are ordinary closed states.
      } finally {
        refreshing = false;
        if (
          !disposed &&
          runtime.coordinator.state.phase === "ready" &&
          !showingProtectedContent.current
        )
          setState({ routeKey, kind: "unavailable", title: null, doc: null });
      }
    };
    refreshRef.current = () => void refresh();
    const online = () => void refresh();
    window.addEventListener("online", online);
    void (async () => {
      try {
        await runtime.start();
        if (disposed) return;
        await runtime.refreshVerifiedAccount();
        if (disposed) return;
        if (identity.kind === "canonical") id = identity.ritualId;
        else if (
          routeAlias === identity.legacyId &&
          parseRitualRouteIdentity(resolvedRitualId)?.kind === "canonical"
        )
          id = resolvedRitualId;
        else {
          const account = runtime.coordinator.state.account;
          id = account
            ? await runtime.repository.resolveDownloadedRitualAlias(
                account,
                identity.legacyId,
              )
            : null;
        }
        if (disposed) return;
        if (!id) {
          setRitual({ routeKey, id: null });
          setState({ routeKey, kind: "unavailable", title: null, doc: null });
          return;
        }
        setRitual({ routeKey, id });
        registration = runtime.coordinator.register({
          ritualId: id,
          capability: "read",
          hide: () => {
            loadSequence++;
            showingProtectedContent.current = false;
            if (!disposed)
              setState({ routeKey, kind: "locked", title: null, doc: null });
          },
          available: () => void load(),
        });
        await refresh();
      } catch {
        if (!disposed) {
          setRitual({ routeKey, id: null });
          setState({ routeKey, kind: "unavailable", title: null, doc: null });
        }
      }
    })();
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      window.removeEventListener("online", online);
      registration?.dispose();
    };
  }, [resolvedRitualId, routeAlias, routeId, routeKey]);

  const visibleState: ReaderState =
    state.routeKey === routeKey
      ? state
      : { routeKey, kind: "loading", title: null, doc: null };
  const ritualId = ritual.routeKey === routeKey ? ritual.id : null;

  if (visibleState.kind === "ready")
    return (
      <Box>
        <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
          {visibleState.title}
        </Typography>
        <DocRender doc={visibleState.doc} />
      </Box>
    );

  return (
    <Box sx={{ p: 2 }}>
      {visibleState.kind === "loading" ? (
        <CircularProgress aria-label="Loading ritual" />
      ) : (
        <Alert severity="info">
          {validRoute
            ? "This ritual is unavailable on this device. Connect and retry to check access."
            : "Open the original ritual link to use the offline reader."}
        </Alert>
      )}
      {ritualId && (
        <Button sx={{ mt: 2 }} onClick={() => refreshRef.current()}>
          Retry
        </Button>
      )}
      <Button sx={{ mt: 2, ml: ritualId ? 1 : 0 }} href="/offline/ritual">
        Downloaded rituals
      </Button>
    </Box>
  );
}
