"use client";

import { StreamLanguage } from "@codemirror/language";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { Save } from "@mui/icons-material";
import {
  Alert,
  Badge,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { type EditorView, Prec, useCodeMirror } from "@uiw/react-codemirror";
import Split from "@uiw/react-split";
import pugLex from "pug-lexer";
import pugParse from "pug-parser";
import React from "react";
import { downloadRitualRecovery } from "@/doc/drafts";
import { toJrt } from "@/doc/prepare";
import {
  sendRitualPublication,
  sendSqlRitualWrite,
} from "@/doc/sqlEditorClient";
import {
  SQL_RITUAL_WRITE_MESSAGES,
  type SqlRitualWriteRequest,
  type SqlRitualWriteResult,
} from "@/doc/sqlWriteContract";
import { parseRitualFileLocator } from "@/files/ritualFileLocator";
import { createUuidV7 } from "@/lib/ids";
import { getBrowserOfflineRuntime } from "@/offline/browserRuntime";
import type { OfflineOperation } from "@/offline/lifecycle";
import { failedRitualPublication } from "@/offline/ritualPublicationContract";
import {
  clearCreationPublicationHandoff,
  creationPublicationHandoffKey,
  readCreationPublicationHandoff,
} from "@/offline/ritualPublicationHandoff";
import { syncOfflineRitualSource } from "@/offline/ritualSourceSync";
import type {
  DraftInput,
  OfflineDraft,
  PublicationOutboxBinding,
  SourceSnapshot,
} from "@/offline/storage";
import type { DocNode } from "@/schemas";
import DocRender from "../DocRender";
import { checkSrc } from "./checkSrc";
import SourceMapConsumer from "./SourceMapConsumer";
import scripts from "./scripts";
import { shortcutHighlighters, transformAndMapShortcuts } from "./shortcuts";

const extensions = [
  StreamLanguage.define(pug),
  ...shortcutHighlighters.map(Prec.highest),
];
const emptyDoc = (): DocNode => ({ type: "root", children: [] });

type Display =
  | { kind: "loading" | "locked" | "unavailable"; ritualId: string }
  | {
      kind: "ready";
      ritualId: string;
      title: string;
      draft: OfflineDraft;
      doc: DocNode;
    };

type ScriptHandle = {
  onChange(value: string, update?: unknown): void;
  value: string;
  transformed: string;
  run(script: string): void;
  view?: EditorView;
};

function toPos(value: string, line: number, column: number) {
  let position = 0;
  for (let index = 0; index < line - 1; index++)
    position = value.indexOf("\n", position) + 1;
  return position + column - 1;
}

function unavailableResult(): SqlRitualWriteResult {
  return {
    ok: false,
    code: "UNAVAILABLE",
    message: SQL_RITUAL_WRITE_MESSAGES.UNAVAILABLE,
    retryable: true,
  };
}
function samePublication(
  left: PublicationOutboxBinding | null,
  right: PublicationOutboxBinding,
) {
  return (
    left?.parentWriteOperationId === right.parentWriteOperationId &&
    left.request.operationId === right.request.operationId
  );
}

export default function SqlDocEdit({ ritualId }: { ritualId: string }) {
  const [display, setDisplay] = React.useState<Display>({
    kind: "loading",
    ritualId,
  });
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [publicationNotice, setPublicationNotice] = React.useState<{
    kind: "queued" | "completed" | "error";
    message: string;
  } | null>(null);
  const [assetLocator, setAssetLocator] = React.useState("");
  const runtimeRef = React.useRef<ReturnType<
    typeof getBrowserOfflineRuntime
  > | null>(null);
  const registrationRef = React.useRef<ReturnType<
    ReturnType<typeof getBrowserOfflineRuntime>["coordinator"]["register"]
  > | null>(null);
  const sourceRef = React.useRef<SourceSnapshot | null>(null);
  const titleRef = React.useRef("Ritual editor");
  const draftRef = React.useRef<OfflineDraft | null>(null);
  const pendingRef = React.useRef<Extract<
    SqlRitualWriteRequest,
    { kind: "save" }
  > | null>(null);
  const publicationRef = React.useRef<PublicationOutboxBinding | null>(null);
  const expiredPublicationRef = React.useRef<PublicationOutboxBinding | null>(
    null,
  );
  const [renewalAvailable, setRenewalAvailable] = React.useState(false);
  const savingRef = React.useRef(false);
  const exportingRef = React.useRef(false);
  const publishingRef = React.useRef(false);
  const visibleRef = React.useRef(false);
  const generation = React.useRef(0);
  const compilationGeneration = React.useRef(0);
  const viewRef = React.useRef<EditorView | undefined>(undefined);
  const compileTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const scriptRef = React.useRef<ScriptHandle | null>(null);
  const syncRef = React.useRef<() => Promise<void>>(async () => {});
  const publishRef = React.useRef<() => Promise<void>>(async () => {});

  const showScriptHandle = React.useCallback((source: string) => {
    const handle = scriptRef.current;
    if (!handle) return;
    handle.value = source;
    handle.transformed = "";
    handle.view = viewRef.current;
    (window as Window & { doc?: Partial<ScriptHandle> }).doc = handle;
  }, []);

  const hideScriptHandle = React.useCallback(() => {
    const handle = scriptRef.current;
    if (!handle) return;
    const scriptingWindow = window as Window & { doc?: Partial<ScriptHandle> };
    if (scriptingWindow.doc === handle) delete scriptingWindow.doc;
    handle.value = "";
    handle.transformed = "";
    handle.view = undefined;
  }, []);

  const updateDraft = React.useCallback((draft: OfflineDraft) => {
    draftRef.current = draft;
    setDisplay((current) =>
      current.kind === "ready" ? { ...current, draft } : current,
    );
  }, []);

  const preserveWithRuntime = React.useCallback(
    async (
      runtime: ReturnType<typeof getBrowserOfflineRuntime>,
      captured: OfflineDraft,
    ) => {
      const input: DraftInput = {
        ownerId: captured.ownerId,
        ritualId: captured.ritualId,
        id: captured.id,
        source: captured.source,
        savedSource: captured.savedSource,
        expectedRevisionId: captured.expectedRevisionId,
        expectedVersion: captured.expectedVersion,
        updatedAtMs: captured.updatedAtMs,
      };
      const stored = await runtime.repository.preserveDraft(
        input,
        captured.localVersion,
      );
      const persisted: OfflineDraft = {
        ...captured,
        id: stored.id,
        localVersion: stored.localVersion,
        conflictOf: stored.conflict ? captured.id : captured.conflictOf,
      };
      const current = draftRef.current;
      if (
        current?.id === captured.id &&
        current.source === captured.source &&
        current.updatedAtMs === captured.updatedAtMs
      )
        updateDraft({ ...current, ...persisted });
      return persisted;
    },
    [updateDraft],
  );

  const persist = React.useCallback(
    async (captured: OfflineDraft) => {
      const runtime = runtimeRef.current;
      if (!runtime) throw new Error("Offline ritual storage is unavailable");
      return preserveWithRuntime(runtime, captured);
    },
    [preserveWithRuntime],
  );

  const compile = React.useCallback((value: string) => {
    const currentGeneration = generation.current;
    const currentCompilation = ++compilationGeneration.current;
    clearTimeout(compileTimer.current);
    compileTimer.current = setTimeout(async () => {
      let consumer: Awaited<InstanceType<typeof SourceMapConsumer>> | undefined;
      try {
        const { transformed, sourceMap } =
          await transformAndMapShortcuts(value);
        if (
          !visibleRef.current ||
          generation.current !== currentGeneration ||
          compilationGeneration.current !== currentCompilation
        )
          return;
        // @ts-expect-error The installed source-map consumer accepts this generated map.
        consumer = await new SourceMapConsumer(sourceMap);
        if (
          !visibleRef.current ||
          generation.current !== currentGeneration ||
          compilationGeneration.current !== currentCompilation
        )
          return;
        if (scriptRef.current) scriptRef.current.transformed = transformed;
        const parsed = pugParse(pugLex(transformed), { src: transformed });
        const diagnostics = checkSrc(parsed, consumer).map((item) => ({
          ...item,
          from: toPos(value, item.from.line, item.from.column),
          to: toPos(value, item.to.line, item.to.column),
        }));
        const view = viewRef.current;
        view?.dispatch(setDiagnostics(view.state, diagnostics));
        const doc = toJrt(parsed) as unknown as DocNode;
        setDisplay((current) =>
          current.kind === "ready" ? { ...current, doc } : current,
        );
        setError(null);
      } catch (failure) {
        if (
          !visibleRef.current ||
          generation.current !== currentGeneration ||
          compilationGeneration.current !== currentCompilation
        )
          return;
        const message =
          failure instanceof Error ? failure.message : "Invalid source";
        const match = message.match(
          /^Pug:(?<line>\d+):(?<column>\d+)\n(?<inline>[\s\S]+?)\n\n(?<message>.+)$/,
        );
        if (match?.groups && consumer) {
          const original = consumer.originalPositionFor({
            line: Number(match.groups.line),
            column: Number(match.groups.column),
          });
          const position = toPos(
            value,
            original.line ?? Number(match.groups.line),
            original.column ?? Number(match.groups.column),
          );
          const diagnostics: Diagnostic[] = [
            {
              from: position,
              to: position,
              message: match.groups.message,
              severity: "error",
            },
          ];
          const view = viewRef.current;
          view?.dispatch(setDiagnostics(view.state, diagnostics));
        } else setError(message);
      } finally {
        consumer?.destroy();
      }
    }, 300);
  }, []);

  const onChange = React.useCallback(
    (value: string) => {
      if (!visibleRef.current) return;
      const current = draftRef.current;
      if (!current) return;
      if (scriptRef.current) scriptRef.current.value = value;
      const next = { ...current, source: value, updatedAtMs: Date.now() };
      updateDraft(next);
      clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        void persist(next).catch(() =>
          setError(
            "Local draft storage is unavailable. Keep this tab open and download recovery.",
          ),
        );
      }, 500);
      compile(value);
    },
    [compile, persist, updateDraft],
  );

  const { setContainer, view } = useCodeMirror({
    theme: "dark",
    extensions,
    onChange,
    height: "100%",
    width: "100%",
  });
  viewRef.current = view;

  const load = React.useCallback(
    async (operation: OfflineOperation) => {
      const runtime = runtimeRef.current;
      const account = runtime?.coordinator.state.account;
      if (!runtime || !account) return;
      try {
        const heldSource = sourceRef.current;
        const source =
          (heldSource?.ownerId === account.ownerId &&
          heldSource.ritualId === ritualId
            ? heldSource
            : null) ??
          (await runtime.repository.readInstalledSource(account, ritualId));
        if (!source || operation.signal.aborted) return;
        let handoffWarning: string | null = null;
        try {
          const handoffKey = creationPublicationHandoffKey(
            account.ownerId,
            ritualId,
          );
          const serialized = localStorage.getItem(handoffKey);
          const handoff = readCreationPublicationHandoff(
            localStorage,
            account.ownerId,
            ritualId,
          );
          if (serialized && !handoff)
            handoffWarning =
              "The retained creation publication is invalid. Preserve browser recovery and retry from the creation page.";
          if (handoff) {
            await runtime.repository.enqueuePublication(
              account,
              handoff.value.write,
              handoff.value.result,
              handoff.value.publication,
            );
            clearCreationPublicationHandoff(
              localStorage,
              handoff.value,
              handoff.serialized,
            );
          }
        } catch {
          handoffWarning =
            "The acknowledged creation is saved, but its publication could not be moved into durable offline storage. Retry when browser storage is available.";
        }
        const [storedDrafts, pending, publication, expiredPublication] =
          await Promise.all([
            runtime.repository.listDrafts(account, ritualId),
            runtime.repository.readRetriableSave(account, ritualId),
            runtime.repository.readRetriablePublication(account, ritualId),
            runtime.repository.readExpiredPublication(account, ritualId),
          ]);
        if (!storedDrafts || operation.signal.aborted) return;
        sourceRef.current = source;
        titleRef.current = source.title;
        pendingRef.current = pending;
        publicationRef.current = publication;
        expiredPublicationRef.current = expiredPublication;
        const heldDraft = draftRef.current;
        let draft =
          (heldDraft?.ownerId === account.ownerId &&
          heldDraft.ritualId === ritualId
            ? heldDraft
            : null) ??
          (pending
            ? storedDrafts.find(
                (candidate) =>
                  candidate.expectedRevisionId === pending.expectedRevisionId &&
                  candidate.expectedVersion === pending.expectedVersion &&
                  candidate.source === pending.source,
              )
            : null) ??
          storedDrafts.find(
            (candidate) => candidate.source !== candidate.savedSource,
          ) ??
          storedDrafts.find(
            (candidate) =>
              candidate.expectedRevisionId === source.revisionId &&
              candidate.expectedVersion === source.parentVersion,
          ) ??
          null;
        if (!draft && pending) {
          const input: DraftInput = {
            ownerId: account.ownerId,
            ritualId,
            id: createUuidV7(),
            source: pending.source,
            savedSource:
              pending.expectedRevisionId === source.revisionId &&
              pending.expectedVersion === source.parentVersion
                ? source.source
                : pending.source,
            expectedRevisionId: pending.expectedRevisionId,
            expectedVersion: pending.expectedVersion,
            updatedAtMs: Date.now(),
          };
          const stored = await runtime.repository.preserveDraft(input, null);
          draft = {
            ...input,
            id: stored.id,
            localVersion: stored.localVersion,
            conflictOf: null,
          };
        }
        if (!draft) {
          const input: DraftInput = {
            ownerId: account.ownerId,
            ritualId,
            id: createUuidV7(),
            source: source.source,
            savedSource: source.source,
            expectedRevisionId: source.revisionId,
            expectedVersion: source.parentVersion,
            updatedAtMs: Date.now(),
          };
          const stored = await runtime.repository.preserveDraft(input, null);
          draft = {
            ...input,
            id: stored.id,
            localVersion: stored.localVersion,
            conflictOf: null,
          };
        }
        runtime.coordinator.commit(operation, () => {
          visibleRef.current = true;
          draftRef.current = draft;
          setDisplay({
            kind: "ready",
            ritualId,
            title: source.title,
            draft,
            doc: emptyDoc(),
          });
          setError(
            handoffWarning ??
              (draft.expectedRevisionId !== source.revisionId ||
              draft.expectedVersion !== source.parentVersion
                ? "This retained draft is based on an earlier revision. Keep it for recovery and merge it with the current source before saving."
                : null),
          );
          setPublicationNotice(
            publication
              ? {
                  kind: "queued",
                  message:
                    "The saved version is queued for publication and can be retried with the same request ID.",
                }
              : expiredPublication
                ? {
                    kind: "error",
                    message:
                      "The previous publication attempt expired. Start a new attempt for this unchanged saved version.",
                  }
                : null,
          );
          setRenewalAvailable(expiredPublication !== null);
          showScriptHandle(draft.source);
          queueMicrotask(() => {
            const currentView = viewRef.current;
            if (!visibleRef.current || !currentView) return;
            currentView.dispatch({
              changes: {
                from: 0,
                to: currentView.state.doc.length,
                insert: draft.source,
              },
            });
          });
          if (publication)
            queueMicrotask(() => {
              void publishRef.current();
            });
        });
      } catch {
        if (!visibleRef.current) setDisplay({ kind: "unavailable", ritualId });
      } finally {
        runtime.coordinator.finish(operation);
      }
    },
    [ritualId, showScriptHandle],
  );

  React.useEffect(() => {
    let disposed = false;
    let runtime: ReturnType<typeof getBrowserOfflineRuntime>;
    try {
      runtime = getBrowserOfflineRuntime();
      runtimeRef.current = runtime;
    } catch {
      setDisplay({ kind: "unavailable", ritualId });
      return;
    }
    let registration: ReturnType<typeof runtime.coordinator.register> | null =
      null;
    const sync = async () => {
      if (!registration || disposed) return;
      const result = await syncOfflineRitualSource(
        runtime,
        registration,
        ritualId,
        fetch,
        (installed) => {
          if (disposed || installed.snapshot.ritualId !== ritualId) return;
          sourceRef.current = installed.snapshot;
          titleRef.current = installed.snapshot.title;
        },
      );
      if (!result && !disposed && !visibleRef.current)
        setDisplay({ kind: "unavailable", ritualId });
    };
    syncRef.current = sync;
    void (async () => {
      try {
        await runtime.start();
        if (disposed) return;
        await runtime.refreshVerifiedAccount();
        if (disposed) return;
        registration = runtime.coordinator.register({
          ritualId,
          capability: "source",
          captureRecovery: () => {
            const captured = draftRef.current;
            if (!captured || captured.source === captured.savedSource)
              return null;
            const recovery = structuredClone(captured);
            return {
              persist: async () => {
                await preserveWithRuntime(runtime, recovery);
              },
            };
          },
          hide: () => {
            visibleRef.current = false;
            generation.current++;
            compilationGeneration.current++;
            clearTimeout(compileTimer.current);
            clearTimeout(persistTimer.current);
            setDisplay({ kind: "locked", ritualId });
            setError(null);
            setPublicationNotice(null);
            setAssetLocator("");
            hideScriptHandle();
            const currentView = viewRef.current;
            currentView?.dispatch({
              changes: {
                from: 0,
                to: currentView.state.doc.length,
                insert: "",
              },
            });
            sourceRef.current = null;
            titleRef.current = "Ritual editor";
            draftRef.current = null;
            pendingRef.current = null;
            publicationRef.current = null;
            expiredPublicationRef.current = null;
            setRenewalAvailable(false);
          },
          available: () => {
            const operation = registration?.begin();
            if (operation) void load(operation);
          },
        });
        registrationRef.current = registration;
        await sync();
      } catch {
        if (!disposed) setDisplay({ kind: "unavailable", ritualId });
      }
    })();
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      visibleRef.current = false;
      generation.current++;
      compilationGeneration.current++;
      clearTimeout(compileTimer.current);
      clearTimeout(persistTimer.current);
      window.removeEventListener("online", online);
      registration?.dispose();
      registrationRef.current = null;
      syncRef.current = async () => {};
      hideScriptHandle();
      runtimeRef.current = null;
    };
  }, [hideScriptHandle, load, preserveWithRuntime, ritualId]);

  React.useEffect(() => {
    const handle: ScriptHandle = {
      value: draftRef.current?.source ?? "",
      transformed: "",
      view,
      onChange,
      run(name) {
        if (!visibleRef.current || !handle.view) return;
        const script = scripts[name];
        if (!script) throw new Error(`Script ${name} not found in scripts.ts`);
        script(handle as never);
      },
    };
    scriptRef.current = handle;
    const scriptingWindow = window as Window & { doc?: Partial<ScriptHandle> };
    if (visibleRef.current) showScriptHandle(draftRef.current?.source ?? "");
    return () => {
      if (scriptingWindow.doc === handle) delete scriptingWindow.doc;
      if (scriptRef.current === handle) scriptRef.current = null;
      handle.value = "";
      handle.transformed = "";
      handle.view = undefined;
    };
  }, [onChange, showScriptHandle, view]);

  const publish = React.useCallback(async () => {
    const runtime = runtimeRef.current;
    const registration = registrationRef.current;
    const account = runtime?.coordinator.state.account;
    const binding = publicationRef.current;
    const request = binding?.request;
    if (!runtime || !account || !binding || !request || publishingRef.current)
      return;
    if (
      request.expectedActorId !== account.ownerId ||
      request.ritualId !== ritualId
    )
      return;
    const operation = registration?.begin();
    if (!operation) {
      setPublicationNotice({
        kind: "error",
        message: "Ritual source is locked. Reconnect before publishing.",
      });
      return;
    }
    publishingRef.current = true;
    setPublishing(true);
    setPublicationNotice({
      kind: "queued",
      message: "Publishing the saved version for download...",
    });
    try {
      await runtime.repository.resumeAuthenticatedPublication(account, binding);
      if (operation.signal.aborted) return;
      const claim = await runtime.repository.claimPublication(account, binding);
      if (!claim)
        throw new Error(
          "The retained publication is currently unavailable. Reconnect and retry.",
        );
      const result =
        (await sendRitualPublication(request, operation.signal)) ??
        failedRitualPublication("UNAVAILABLE");
      const settled = await runtime.repository.settlePublication(claim, result);
      if (!settled)
        throw new Error(
          "The publication result could not be retained safely. Retry the same request.",
        );
      if (result.ok) {
        runtime.coordinator.commit(operation, () => {
          if (samePublication(publicationRef.current, binding)) {
            publicationRef.current = null;
            expiredPublicationRef.current = null;
            setRenewalAvailable(false);
            setPublicationNotice({
              kind: "completed",
              message:
                "Published for download. Open the ritual reader to download it for offline use.",
            });
          }
        });
        return;
      }
      const mayRetry =
        result.retryable ||
        result.code === "AUTH_REQUIRED" ||
        result.code === "ACTOR_CHANGED";
      runtime.coordinator.commit(operation, () => {
        if (samePublication(publicationRef.current, binding)) {
          if (!mayRetry) publicationRef.current = null;
          if (result.code === "EXPIRED") {
            expiredPublicationRef.current = binding;
            setRenewalAvailable(true);
          } else if (!mayRetry) {
            expiredPublicationRef.current = null;
            setRenewalAvailable(false);
          }
          setPublicationNotice({
            kind: mayRetry ? "queued" : "error",
            message:
              result.code === "EXPIRED"
                ? "This publication attempt expired. Start a new attempt for this unchanged saved version."
                : result.message,
          });
        }
      });
    } catch (failure) {
      runtime.coordinator.commit(operation, () => {
        if (samePublication(publicationRef.current, binding))
          setPublicationNotice({
            kind: "error",
            message:
              failure instanceof Error
                ? failure.message
                : "The retained publication is unavailable. Retry the same request.",
          });
      });
    } finally {
      runtime.coordinator.finish(operation);
      publishingRef.current = false;
      setPublishing(false);
      if (
        publicationRef.current &&
        !samePublication(publicationRef.current, binding)
      )
        queueMicrotask(() => {
          void publishRef.current();
        });
    }
  }, [ritualId]);
  publishRef.current = publish;

  const renewPublication = React.useCallback(async () => {
    const runtime = runtimeRef.current;
    const registration = registrationRef.current;
    const account = runtime?.coordinator.state.account;
    const binding = expiredPublicationRef.current;
    const source = sourceRef.current;
    if (!runtime || !account || !binding || !source || publishingRef.current)
      return;
    const request = binding.request;
    if (
      request.expectedActorId !== account.ownerId ||
      request.ritualId !== ritualId ||
      source.ownerId !== account.ownerId ||
      source.ritualId !== ritualId ||
      source.revisionId !== request.expectedRevisionId ||
      source.parentVersion !== request.expectedVersion
    ) {
      setPublicationNotice({
        kind: "error",
        message:
          "This saved version is no longer current. Reload the source before starting another publication attempt.",
      });
      return;
    }
    const operation = registration?.begin();
    if (!operation) {
      setPublicationNotice({
        kind: "error",
        message:
          "Ritual source is locked. Reconnect before starting another publication attempt.",
      });
      return;
    }
    publishingRef.current = true;
    setPublishing(true);
    setPublicationNotice({
      kind: "queued",
      message: "Preparing a new publication attempt...",
    });
    let publishRenewed = false;
    try {
      const renewed = await runtime.repository.renewExpiredPublication(
        account,
        binding,
      );
      if (operation.signal.aborted) return;
      if (
        !renewed ||
        renewed.parentWriteOperationId !== binding.parentWriteOperationId ||
        renewed.request.operationId === binding.request.operationId ||
        renewed.request.expectedActorId !== request.expectedActorId ||
        renewed.request.ritualId !== request.ritualId ||
        renewed.request.expectedRevisionId !== request.expectedRevisionId ||
        renewed.request.expectedVersion !== request.expectedVersion
      )
        throw new Error(
          "The expired attempt could not be renewed for the current saved version. Refresh source access and retry, or ask an administrator to publish it.",
        );
      runtime.coordinator.commit(operation, () => {
        if (
          samePublication(expiredPublicationRef.current, binding) &&
          publicationRef.current === null
        ) {
          expiredPublicationRef.current = null;
          setRenewalAvailable(false);
          publicationRef.current = renewed;
          setPublicationNotice({
            kind: "queued",
            message:
              "The new publication attempt is retained and ready to send.",
          });
          publishRenewed = true;
        }
      });
    } catch (failure) {
      runtime.coordinator.commit(operation, () => {
        if (samePublication(expiredPublicationRef.current, binding))
          setPublicationNotice({
            kind: "error",
            message:
              failure instanceof Error
                ? failure.message
                : "The expired attempt could not be renewed. Refresh source access and retry, or ask an administrator to publish it.",
          });
      });
    } finally {
      runtime.coordinator.finish(operation);
      publishingRef.current = false;
      setPublishing(false);
      if (publishRenewed)
        queueMicrotask(() => {
          void publishRef.current();
        });
    }
  }, [ritualId]);

  const save = React.useCallback(async () => {
    const runtime = runtimeRef.current;
    const registration = registrationRef.current;
    const account = runtime?.coordinator.state.account;
    const current = draftRef.current;
    if (!runtime || !account || !current || savingRef.current) return;
    if (current.source === current.savedSource && !pendingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const operation = registration?.begin();
    if (!operation) {
      savingRef.current = false;
      setSaving(false);
      setError("Ritual source is locked. Reconnect before saving.");
      return;
    }
    let publishAfterSave = false;
    try {
      await persist(current);
      if (operation.signal.aborted) return;
      const request =
        pendingRef.current ??
        ({
          version: 2,
          kind: "save",
          operationId: createUuidV7(),
          expectedActorId: account.ownerId,
          ritualId,
          expectedRevisionId: current.expectedRevisionId,
          expectedVersion: current.expectedVersion,
          source: current.source,
        } satisfies Extract<SqlRitualWriteRequest, { kind: "save" }>);
      pendingRef.current = request;
      await runtime.repository.enqueueSave(account, request);
      await runtime.repository.resumeAuthenticatedSave(
        account,
        ritualId,
        request.operationId,
      );
      const claim = await runtime.repository.claimSave(
        account,
        ritualId,
        request.operationId,
      );
      if (!claim)
        throw new Error("The retained save is currently unavailable.");
      const result =
        (await sendSqlRitualWrite(request, operation.signal)) ??
        unavailableResult();
      const settled = await runtime.repository.settleSave(claim, result);
      if (!settled)
        throw new Error("The save result could not be retained safely.");
      if (!result.ok) {
        runtime.coordinator.commit(operation, () => {
          setError(result.message);
          if (
            !result.retryable &&
            result.code !== "NOT_AUTHENTICATED" &&
            result.code !== "ACCOUNT_CHANGED" &&
            pendingRef.current?.operationId === request.operationId
          )
            pendingRef.current = null;
        });
        return;
      }
      let updated: OfflineDraft | null = null;
      runtime.coordinator.commit(operation, () => {
        const latest = draftRef.current;
        if (
          !latest ||
          latest.ownerId !== account.ownerId ||
          latest.ritualId !== ritualId ||
          pendingRef.current?.operationId !== request.operationId
        )
          return;
        pendingRef.current = null;
        updated = {
          ...latest,
          savedSource: request.source,
          expectedRevisionId: result.revisionId,
          expectedVersion: result.version,
          updatedAtMs: Date.now(),
        };
        sourceRef.current = {
          ownerId: account.ownerId,
          ritualId,
          revisionId: result.revisionId,
          parentVersion: result.version,
          title: titleRef.current,
          source: request.source,
        };
        updateDraft(updated);
      });
      if (!updated) return;
      await preserveWithRuntime(runtime, updated);
      if (operation.signal.aborted) return;
      const publication = await runtime.repository.readRetriablePublication(
        account,
        ritualId,
      );
      runtime.coordinator.commit(operation, () => {
        publicationRef.current = publication;
        expiredPublicationRef.current = null;
        setRenewalAvailable(false);
        setPublicationNotice(
          publication
            ? {
                kind: "queued",
                message: "The saved version is queued for publication.",
              }
            : {
                kind: "error",
                message:
                  "The ritual was saved, but its publication request is unavailable. Reconnect to recover it from durable storage.",
              },
        );
        publishAfterSave = publication !== null;
      });
      if (operation.signal.aborted) return;
      try {
        await syncRef.current();
      } catch {
        // The source save is acknowledged; online refresh remains independently retryable.
      }
    } catch (failure) {
      runtime.coordinator.commit(operation, () =>
        setError(
          failure instanceof Error
            ? failure.message
            : SQL_RITUAL_WRITE_MESSAGES.UNAVAILABLE,
        ),
      );
    } finally {
      runtime.coordinator.finish(operation);
      savingRef.current = false;
      setSaving(false);
      if (publishAfterSave)
        queueMicrotask(() => {
          void publishRef.current();
        });
    }
  }, [persist, preserveWithRuntime, ritualId, updateDraft]);

  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "s" && event.ctrlKey) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [save]);

  const downloadRecovery = async () => {
    const runtime = runtimeRef.current;
    const registration = registrationRef.current;
    const account = runtime?.coordinator.state.account;
    const current = draftRef.current;
    if (
      !runtime ||
      !account ||
      !current ||
      current.ownerId !== account.ownerId ||
      current.ritualId !== ritualId ||
      exportingRef.current
    )
      return;
    const operation = registration?.begin();
    if (!operation) {
      setError("Ritual source is locked. Reconnect before exporting recovery.");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    try {
      const preserved = await preserveWithRuntime(
        runtime,
        structuredClone(current),
      );
      if (operation.signal.aborted) return;
      const exported = await runtime.repository.exportDraft(
        account,
        ritualId,
        preserved.id,
      );
      if (!exported) {
        runtime.coordinator.commit(operation, () =>
          setError(
            "Ritual recovery is locked. Reconnect with source access before exporting.",
          ),
        );
        return;
      }
      runtime.coordinator.commit(operation, () => {
        if (
          exported.ownerId === account.ownerId &&
          exported.ritualId === ritualId
        )
          downloadRitualRecovery({ draft: exported });
      });
    } catch {
      runtime.coordinator.commit(operation, () =>
        setError(
          "Ritual recovery could not be exported safely. Reconnect and retry.",
        ),
      );
    } finally {
      runtime.coordinator.finish(operation);
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const insertAsset = () => {
    const locator = parseRitualFileLocator(assetLocator);
    if (!locator || locator.ritualId !== ritualId) {
      setError(
        "Paste the exact source reference for an image attached to this ritual.",
      );
      return;
    }
    const current = draftRef.current;
    if (!current || !visibleRef.current) return;
    const currentView = viewRef.current;
    if (!currentView) {
      setError("The source editor is unavailable. Retry after it loads.");
      return;
    }
    const separator =
      current.source.endsWith("\n") || !current.source ? "" : "\n";
    const next = `${current.source}${separator}img(src=${JSON.stringify(assetLocator)})\n`;
    currentView.dispatch({
      changes: { from: 0, to: currentView.state.doc.length, insert: next },
    });
    setAssetLocator("");
  };

  const currentDisplay =
    display.ritualId === ritualId
      ? display
      : ({ kind: "loading", ritualId } as const);
  const dirty =
    currentDisplay.kind === "ready" &&
    currentDisplay.draft.source !== currentDisplay.draft.savedSource;
  if (currentDisplay.kind !== "ready")
    return (
      <div style={{ padding: 16 }}>
        {currentDisplay.kind === "loading" ? (
          <div>Loading ritual source...</div>
        ) : (
          <Alert severity="info">
            Ritual source is locked or unavailable. Connect and retry with the
            authorized account.
          </Alert>
        )}
        {error && <Alert severity="warning">{error}</Alert>}
      </div>
    );

  return (
    <div style={{ height: "calc(100vh - 64px)", overflow: "auto" }}>
      <Typography variant="h5" component="h1" sx={{ px: 1, pt: 1 }}>
        {currentDisplay.title}
      </Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {publicationNotice && (
        <Alert
          severity={
            publicationNotice.kind === "completed"
              ? "success"
              : publicationNotice.kind === "queued"
                ? "info"
                : "warning"
          }
        >
          {publicationNotice.message}
        </Alert>
      )}
      {publicationRef.current && (
        <Button onClick={() => void publish()} disabled={saving || publishing}>
          {publishing ? "Publishing saved version..." : "Retry publication"}
        </Button>
      )}
      {renewalAvailable && (
        <Button
          onClick={() => void renewPublication()}
          disabled={saving || publishing}
        >
          {publishing
            ? "Preparing publication attempt..."
            : "Start new publication attempt"}
        </Button>
      )}
      {pendingRef.current && (
        <Alert severity="info">
          Retry keeps the exact retained save request and operation ID.
        </Alert>
      )}
      <Button onClick={() => void downloadRecovery()} disabled={exporting}>
        {exporting ? "Preparing recovery..." : "Download recovery"}
      </Button>
      <Button href="/upload">Attach image</Button>
      <TextField
        size="small"
        label="Attached image source reference"
        value={assetLocator}
        disabled={saving}
        onChange={(event) => setAssetLocator(event.target.value)}
      />
      <Button onClick={insertAsset} disabled={saving || !assetLocator}>
        Insert image
      </Button>
      <Split>
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
          <div
            ref={setContainer}
            style={{ height: "100%", width: "100%", overflow: "auto" }}
          />
          <Tooltip title={pendingRef.current ? "Retry pending save" : "Save"}>
            <IconButton
              aria-label={
                pendingRef.current ? "Retry pending save" : "Save ritual"
              }
              disabled={saving || (!dirty && !pendingRef.current)}
              onClick={() => void save()}
              sx={{ position: "absolute", right: 10, top: 10, color: "#aaa" }}
            >
              <Badge color={dirty ? "error" : "success"} variant="dot">
                <Save />
              </Badge>
            </IconButton>
          </Tooltip>
        </div>
        <div
          style={{
            width: 720,
            minWidth: 100,
            height: "100%",
            overflow: "auto",
          }}
        >
          <DocRender doc={currentDisplay.doc} wrapWithErrorBoundary={true} />
        </div>
      </Split>
    </div>
  );
}
