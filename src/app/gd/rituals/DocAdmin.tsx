"use client";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import {
  db,
  useGongoLive,
  useGongoOne,
  useGongoSub,
  useGongoUserId,
} from "gongo-client-react";
import { useRouter } from "next/navigation";
import React from "react";
import {
  boundedRitualRpc,
  clientRitualId,
  downloadRitualRecovery,
  persistRitualRecovery,
  preservePendingRitualChanges,
  type RitualCreationDraft,
  type RitualRecovery,
  readRitualRecovery,
  ritualWriteResult,
} from "@/doc/drafts";
import type { RitualWriteRequest } from "@/doc/writes";
import { createUuidV7 } from "@/lib/ids";

export default function DocAdmin() {
  const userId = useGongoUserId();
  return typeof userId === "string" ? (
    <CreationForm key={userId} userId={userId} />
  ) : null;
}

function CreationForm({ userId }: { userId: string }) {
  const router = useRouter();
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId }),
  );
  useGongoSub(
    "userTemplesAndMemberships",
    {},
    { minInterval: 2000, maxInterval: 5000 },
  );
  useGongoSub("userGroups");
  useGongoSub(user?.admin === true && "templesForAdmins");
  const memberships = useGongoLive((db) =>
    db.collection("templeMemberships").find({ userId, admin: true }),
  );
  const temples = useGongoLive((db) => db.collection("temples").find());
  const groups = useGongoLive((db) => db.collection("userGroups").find());
  const [form, setForm] = React.useState<RitualCreationDraft>(() => ({
    kind: "creation",
    id: createUuidV7(),
    ownerId: userId,
    docId: null,
    title: "",
    scopeKey: "",
    minGrade: 0,
    source: "",
    updatedAt: Date.now(),
  }));
  const formRef = React.useRef(form);
  const [retained, setRetained] = React.useState<RitualRecovery[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const rpc = React.useMemo(
    () => boundedRitualRpc((name, payload) => db.call(name, { ...payload })),
    [],
  );
  const keep = React.useCallback((next: RitualCreationDraft) => {
    formRef.current = next;
    setForm(next);
    persistRitualRecovery(window.localStorage, next);
  }, []);
  React.useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        await preservePendingRitualChanges(db, window.localStorage);
        if (disposed) return;
        const recovered = readRitualRecovery(window.localStorage, userId);
        setRetained(recovered);
        const last = recovered.find(
          (item): item is RitualCreationDraft => item.kind === "creation",
        );
        if (last && !last.createdDocId)
          keep({ ...last, id: createUuidV7(), updatedAt: Date.now() });
      } catch {
        if (!disposed)
          setError(
            "Could not preserve local recovery. Download pending changes before leaving this tab.",
          );
      }
    })();
    return () => {
      disposed = true;
    };
  }, [userId, keep]);
  const change = (patch: Partial<RitualCreationDraft>) => {
    try {
      keep({ ...formRef.current, ...patch, updatedAt: Date.now() });
    } catch {
      setError(
        "Local draft storage is unavailable. Keep this tab open and download recovery.",
      );
    }
  };
  const permittedTemples = temples.filter(
    (temple) =>
      user?.admin === true ||
      memberships.some((membership) => membership.templeId === temple._id),
  );
  const permittedGroups = groups.filter(
    (group) =>
      user?.admin === true ||
      (Array.isArray(user?.groupAdminIds) &&
        user.groupAdminIds.includes(group._id)),
  );
  const hasScope =
    user?.admin === true ||
    permittedTemples.length > 0 ||
    permittedGroups.length > 0;
  const pendingCreates = retained.filter(
    (item) =>
      item.kind === "legacy" &&
      item.collection === "docs" &&
      item.raw.__pendingInsert,
  );
  const exportRecovery = () => {
    let records = retained;
    try {
      records = readRitualRecovery(window.localStorage, userId);
    } catch {
      /* Keep in-memory recovery available when storage is blocked. */
    }
    downloadRitualRecovery({
      form: formRef.current,
      retained: records,
      pending: ["docs", "docRevisions"].flatMap((name) =>
        db
          .collection(name)
          .find(
            { __pendingSince: { $exists: true } },
            { includePendingDeletes: true },
          )
          .toArraySync()
          .filter((item) => clientRitualId(item.userId) === userId)
          .map((raw) => ({ collection: name, raw })),
      ),
    });
  };
  const recover = (id: string) => {
    const item = retained.find((entry) => entry.id === id);
    if (!item || item.kind !== "legacy" || item.collection !== "docs") return;
    const revision = retained.find(
      (entry) =>
        entry.kind === "legacy" &&
        entry.collection === "docRevisions" &&
        entry.docId === item.docId &&
        typeof entry.raw.text === "string",
    );
    const source = revision?.kind === "legacy" ? String(revision.raw.text) : "";
    const templeId = clientRitualId(item.raw.templeId);
    const groupId = clientRitualId(item.raw.groupId);
    const invalidScope =
      (item.raw.templeId != null && !templeId) ||
      (item.raw.groupId != null && !groupId) ||
      (templeId && groupId);
    const scopeKey = invalidScope
      ? ""
      : templeId
        ? `temple:${templeId}`
        : groupId
          ? `group:${groupId}`
          : "public";
    try {
      keep({
        kind: "creation",
        id: createUuidV7(),
        ownerId: userId,
        docId: null,
        title: typeof item.raw.title === "string" ? item.raw.title : "",
        source,
        scopeKey,
        minGrade: typeof item.raw.minGrade === "number" ? item.raw.minGrade : 0,
        updatedAt: Date.now(),
      });
      const detail = invalidScope
        ? "The retained scope is invalid or mixed. Choose the intended visibility before creating."
        : source
          ? "Recovered source. Review its scope and text before creating."
          : "Recovered metadata; no pending source was found. The original compiled data remains in your recovery download.";
      setError(
        `This earlier creation may already exist. Check the ritual list before creating a new copy. ${detail}`,
      );
    } catch {
      setError(
        "Could not preserve this recovered draft. Download recovery before proceeding.",
      );
    }
  };
  const create = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = formRef.current;
      const [kind, scopeId] = current.scopeKey.split(":");
      const scope =
        kind === "public"
          ? { kind: "public" as const }
          : kind === "group"
            ? { kind: "group" as const, groupId: scopeId }
            : {
                kind: "temple" as const,
                templeId: scopeId,
                minGrade: current.minGrade,
              };
      const request =
        current.request ??
        ({
          version: 1,
          expectedActorId: userId,
          operationId: createUuidV7(),
          kind: "create",
          scope,
          title: current.title,
          source: current.source,
        } satisfies RitualWriteRequest);
      keep({ ...current, request });
      if (request.expectedActorId !== userId)
        throw new Error(
          "Switch back to the owner of this retained creation request.",
        );
      const result = ritualWriteResult(
        await rpc("ritualWrite", request),
        request,
      );
      if (result.ok) {
        keep({
          ...formRef.current,
          createdDocId: result.docId,
          updatedAt: Date.now(),
        });
        router.push(`/doc/${result.docId}/edit`);
      } else {
        setError(result.message);
        // Other failures may follow an earlier unknown commit; retain its operation.
        if (
          result.code === "INVALID_SOURCE" ||
          result.code === "INVALID_REQUEST"
        )
          keep({
            ...formRef.current,
            id: createUuidV7(),
            request: undefined,
            updatedAt: Date.now(),
          });
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Creation could not be confirmed. Retry the same retained request.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  if (!hasScope && retained.length === 0 && !error) return null;
  return (
    <Box sx={{ my: 2 }}>
      <Typography variant="h6">Create ritual</Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {form.request && (
        <Alert severity="info">
          An unconfirmed creation request is retained. Retry it to avoid
          creating a duplicate.
        </Alert>
      )}
      <Button onClick={exportRecovery}>Download recovery</Button>
      {pendingCreates.length > 0 && (
        <TextField
          select
          label="Recover retained ritual"
          value=""
          onChange={(event) => recover(event.target.value)}
          size="small"
        >
          <MenuItem value="">Choose a retained ritual</MenuItem>
          {pendingCreates.map((item) => (
            <MenuItem value={item.id} key={item.id}>
              {item.kind === "legacy" && typeof item.raw.title === "string"
                ? item.raw.title
                : "Untitled retained ritual"}
            </MenuItem>
          ))}
        </TextField>
      )}
      <form onSubmit={create}>
        <TextField
          label="Title"
          size="small"
          value={form.title}
          disabled={busy || !!form.request}
          onChange={(event) => change({ title: event.target.value })}
        />{" "}
        <TextField
          select
          label="Visibility"
          size="small"
          value={form.scopeKey}
          disabled={busy || !!form.request}
          onChange={(event) => change({ scopeKey: event.target.value })}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">Choose visibility</MenuItem>
          {user?.admin === true && <MenuItem value="public">Public</MenuItem>}
          {permittedTemples.map((temple) => (
            <MenuItem value={`temple:${temple._id}`} key={temple._id}>
              {String(temple.name ?? "Temple")}
            </MenuItem>
          ))}
          {permittedGroups.map((group) => (
            <MenuItem value={`group:${group._id}`} key={group._id}>
              {String(group.name ?? "Group")}
            </MenuItem>
          ))}
        </TextField>
        {form.scopeKey.startsWith("temple:") && (
          <TextField
            label="Min Grade"
            size="small"
            type="number"
            value={form.minGrade}
            disabled={busy || !!form.request}
            onChange={(event) =>
              change({ minGrade: Number(event.target.value) })
            }
            sx={{ width: 100 }}
          />
        )}
        {form.source && (
          <TextField
            label="Recovered source"
            multiline
            minRows={4}
            fullWidth
            value={form.source}
            disabled={busy || !!form.request}
            onChange={(event) => change({ source: event.target.value })}
          />
        )}
        <Button
          type="submit"
          disabled={busy || !form.title.trim() || !form.scopeKey}
        >
          {form.request ? "Retry creation" : "Create"}
        </Button>
      </form>
    </Box>
  );
}
