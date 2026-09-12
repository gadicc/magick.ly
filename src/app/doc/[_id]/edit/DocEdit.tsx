"use client";
import { StreamLanguage } from "@codemirror/language";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { Diagnostic, setDiagnostics } from "@codemirror/lint";
import { Close, ErrorOutlined, Save } from "@mui/icons-material";
import { Alert, Badge, Button, IconButton, Tooltip } from "@mui/material";
import { EditorView, Prec, useCodeMirror } from "@uiw/react-codemirror";
import Split from "@uiw/react-split";
import { db, useGongoUserId } from "gongo-client-react";
import pugLex from "pug-lexer";
import pugParse from "pug-parser";
import React from "react";
import {
  boundedRitualRpc,
  clientRitualId,
  downloadRitualRecovery,
  loadRitualSnapshot,
  newRitualDraft,
  persistRitualRecovery,
  preservePendingRitualChanges,
  type RitualDraft,
  type RitualRecovery,
  type RitualSnapshot,
  readRitualRecovery,
  submitRitualDraft,
} from "@/doc/drafts";
import { toJrt } from "@/doc/prepare";
import { DocNode } from "@/schemas";
import DocRender from "../DocRender";
import { checkSrc } from "./checkSrc";
import SourceMapConsumer from "./SourceMapConsumer";
import scripts from "./scripts";
import { shortcutHighlighters, transformAndMapShortcuts } from "./shortcuts";

const extensions = [
  StreamLanguage.define(pug),
  ...shortcutHighlighters.map(Prec.highest),
];

function ShowError({
  error,
  setError,
}: {
  error: Error | null;
  setError: (error: Error | null) => void;
}) {
  return (
    <div
      style={{
        display: error ? "block" : "none",
        position: "absolute",
        left: 25,
        bottom: 15,
        borderRadius: 5,
        background: "#ff5555",
        padding: "2px 5px 2px 10px",
        fontWeight: 500,
        color: "white",
        boxShadow: "0px 5px 5px rgba(0, 0, 0, 0.25)",
      }}
    >
      <ErrorOutlined sx={{ verticalAlign: "middle" }} />
      <span style={{ verticalAlign: "middle", padding: "0 5px 0 10px" }}>
        {error?.message}
      </span>
      <IconButton
        sx={{ verticalAlign: "middle" }}
        onClick={() => setError(null)}
      >
        <Close />
      </IconButton>
    </div>
  );
}

function toPos(value: string, line: number, column: number) {
  let pos = 0;
  for (let i = 0; i < line - 1; i++) {
    pos = value.indexOf("\n", pos) + 1;
  }
  return pos + column - 1;
}

export type ScriptProps = {
  onChange: (value: string, viewUpdate?: unknown) => void;
  value: string;
  transformed: string;
  run: (script: string) => void;
  view: EditorView;
};

export default function DocEdit({
  params: { _id },
}: {
  params: { _id: string };
}) {
  const userId = useGongoUserId();
  const docId = clientRitualId(_id) ?? _id;
  return (
    <RitualEditor
      key={`${userId ?? "anonymous"}:${docId}`}
      _id={docId}
      userId={typeof userId === "string" ? userId : null}
    />
  );
}

function RitualEditor({ _id, userId }: { _id: string; userId: string | null }) {
  const [initialValue, setInitialValue] = React.useState<string | null>(null);
  const [doc, setDoc] = React.useState<DocNode>({ type: "root", children: [] });
  const [error, setError] = React.useState<Error | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [lastSavedValue, setLastSavedValue] = React.useState("");
  const [draft, setDraft] = React.useState<RitualDraft | null>(null);
  const draftRef = React.useRef<RitualDraft | null>(null);
  const [recoveries, setRecoveries] = React.useState<RitualRecovery[]>([]);
  const [selectedRecovery, setSelectedRecovery] = React.useState("");
  const [latest, setLatest] = React.useState<RitualSnapshot | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const loadGeneration = React.useRef(0);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const rpc = React.useMemo(
    () => boundedRitualRpc((name, input) => db.call(name, { ...input })),
    [],
  );
  const keepDraft = React.useCallback((value: RitualDraft) => {
    draftRef.current = value;
    setDraft(value);
    persistRitualRecovery(window.localStorage, value);
  }, []);
  const load = React.useCallback(
    async (recover = true) => {
      if (!userId) return;
      const generation = ++loadGeneration.current;
      setLatest(null);
      setRequestError(null);
      try {
        if (draftRef.current)
          persistRitualRecovery(window.localStorage, draftRef.current);
        await preservePendingRitualChanges(db, window.localStorage);
        if (loadGeneration.current !== generation) return;
        const retained = readRitualRecovery(window.localStorage, userId, _id);
        setRecoveries(retained);
        const previous = retained.find(
          (item): item is RitualDraft => item.kind === "draft",
        );
        const recovered =
          recover &&
          previous &&
          (previous.source !== previous.savedSource || previous.request)
            ? previous
            : undefined;
        let snapshot: RitualSnapshot;
        try {
          snapshot = await loadRitualSnapshot(rpc, _id);
          if (loadGeneration.current !== generation) return;
          setLatest(snapshot);
        } catch (failure) {
          if (loadGeneration.current !== generation) return;
          if (!recovered) throw failure;
          snapshot = {
            docId: _id,
            source: recovered.savedSource,
            revisionId: recovered.baseRevisionId,
            updatedAt: recovered.baseUpdatedAt,
          };
          setRequestError(
            "Working from your retained draft. Connect to confirm the current server version before saving.",
          );
        }
        const next = newRitualDraft(userId, snapshot, recovered);
        keepDraft(next);
        setInitialValue(next.source);
        setLastSavedValue(next.savedSource);
        if (
          recovered &&
          (recovered.baseRevisionId !== snapshot.revisionId ||
            recovered.baseUpdatedAt !== snapshot.updatedAt)
        )
          setRequestError(
            "Your recovered draft is based on an older version. Load the server source and review your retained source before saving.",
          );
      } catch (failure) {
        if (loadGeneration.current !== generation) return;
        setRequestError(
          failure instanceof Error
            ? failure.message
            : "Could not load or preserve the ritual draft.",
        );
      }
    },
    [userId, _id, rpc, keepDraft],
  );
  React.useEffect(() => {
    void load();
    return () => {
      ++loadGeneration.current;
      clearTimeout(timeoutRef.current);
    };
  }, [load]);
  const viewRef = React.useRef<EditorView | undefined>(undefined);
  const windowDocRef = React.useRef<Partial<ScriptProps>>({});
  if (typeof window !== "undefined") {
    // @ts-expect-error: it's ok
    window.doc = windowDocRef.current;
  }
  windowDocRef.current.run = function run(scriptName: string) {
    const script = scripts[scriptName];
    if (!script) {
      console.log(Object.keys(scripts).join(", "));
      throw new Error(`Script ${scriptName} not found in scripts.ts`);
    }
    script(windowDocRef.current as ScriptProps);
  };
  windowDocRef.current.view = viewRef.current;

  const isDirty = draft?.source !== lastSavedValue;

  const onChange = React.useCallback(
    (value, viewUpdate) => {
      windowDocRef.current.value = value;
      if (draftRef.current) {
        try {
          keepDraft({
            ...draftRef.current,
            source: value,
            updatedAt: Date.now(),
          });
        } catch {
          setRequestError(
            "Local draft storage is unavailable. Keep this tab open and download your recovery before leaving.",
          );
        }
      }
      // console.log("value", value);
      // console.log("viewUpdate", viewUpdate);
      // setDocSrc(value);

      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(async () => {
        const { transformed, sourceMap } =
          await transformAndMapShortcuts(value);
        windowDocRef.current.transformed = transformed;

        // @ts-expect-error: it's ok
        const consumer = await new SourceMapConsumer(sourceMap);

        try {
          const lexed = pugLex(transformed);
          const parsed = pugParse(lexed, { src: transformed });
          // console.log(parsed);
          const errors = checkSrc(parsed, consumer).map((e) => ({
            ...e,
            from: toPos(value, e.from.line, e.from.column),
            to: toPos(value, e.to.line, e.to.column),
          }));
          // console.log("errors", errors);
          const view = viewRef.current;
          view?.dispatch(setDiagnostics(view.state, errors));

          const jrt = toJrt(parsed) as unknown as DocNode;
          setDoc(jrt);
          setError(null);
        } catch (error) {
          // console.log(error);
          const match = error.message.match(
            /^Pug:(?<line>\d+):(?<column>\d+)\n(?<inline>[\s\S]+?)\n\n(?<message>.+)$/,
          );
          if (match) {
            const { message, type: _type } = match.groups;
            let line = Number(match.groups.line);
            let column = Number(match.groups.column);
            const orig = consumer.originalPositionFor({ line, column });
            if (orig.line !== null) line = orig.line;
            if (orig.column !== null) column = orig.column;
            const pos = toPos(value, line, column);
            const diagnostics: Diagnostic[] = [
              {
                from: pos,
                to: pos,
                message,
                severity: "error" as const,
                // source: type,
              },
            ];
            const view = viewRef.current;
            view?.dispatch(setDiagnostics(view.state, diagnostics));
          } else {
            setError(error);
          }
        }
      }, 300);
    },
    [keepDraft],
  );
  windowDocRef.current.onChange = onChange;

  const save = React.useCallback(async () => {
    const current = draftRef.current;
    if (
      !current ||
      !userId ||
      savingRef.current ||
      (!isDirty && !current.request)
    )
      return;
    savingRef.current = true;
    setIsSaving(true);
    setRequestError(null);
    try {
      const result = await submitRitualDraft(
        current,
        rpc,
        keepDraft,
        () => draftRef.current ?? current,
      );
      if (!result.ok) setRequestError(result.message);
      else setLastSavedValue(draftRef.current?.savedSource ?? current.source);
    } catch (failure) {
      setRequestError(
        failure instanceof Error
          ? failure.message
          : "Save could not be confirmed. Retry the same pending request.",
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [isDirty, userId, rpc, keepDraft]);

  const exportRecovery = () => {
    if (!userId) return;
    const pending = ["docs", "docRevisions"].flatMap((name) =>
      db
        .collection(name)
        .find(
          { __pendingSince: { $exists: true } },
          { includePendingDeletes: true },
        )
        .toArraySync()
        .filter(
          (item) =>
            clientRitualId(item.userId) === userId &&
            clientRitualId(name === "docs" ? item._id : item.docId) === _id,
        )
        .map((raw) => ({ collection: name, raw })),
    );
    let retained = recoveries;
    try {
      retained = readRitualRecovery(window.localStorage, userId, _id);
    } catch {
      /* The in-memory draft remains downloadable if storage is unavailable. */
    }
    downloadRitualRecovery({ draft: draftRef.current, retained, pending });
  };
  const recoverySource = (item: RitualRecovery) =>
    item.kind === "draft"
      ? item.source
      : item.kind === "legacy" &&
          item.collection === "docRevisions" &&
          typeof item.raw.text === "string"
        ? item.raw.text
        : null;
  const selected = recoveries.find((item) => item.id === selectedRecovery);
  const restore = () => {
    if (!selected || !latest || !userId) return;
    const source = recoverySource(selected);
    if (source === null) return;
    try {
      if (draftRef.current)
        persistRitualRecovery(window.localStorage, draftRef.current);
      const next = { ...newRitualDraft(userId, latest), source };
      keepDraft(next);
      setInitialValue(source);
      setLastSavedValue(next.savedSource);
      setRequestError(null);
    } catch {
      setRequestError(
        "Could not preserve recovery. Download your source before continuing.",
      );
    }
  };

  const handleKeyDown = React.useCallback(
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "s" && event.ctrlKey) {
        event.preventDefault();
        save();
      }
    },
    [save],
  );

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // state, setState - no longer used
  const { setContainer, view } = useCodeMirror({
    theme: "dark",
    extensions,
    onChange,
    height: "100%",
    width: "100%",
  });

  React.useEffect(() => {
    viewRef.current = view;
    windowDocRef.current.view = view;
    if (view && initialValue !== null) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: initialValue },
      });
    }
  }, [view, initialValue]);

  const editorRef = React.useCallback(
    (node) => {
      setContainer(node);
    },
    [setContainer],
  );

  if (!userId) return <Alert severity="info">Sign in to edit rituals.</Alert>;
  const recoveryBar = (
    <div style={{ padding: "8px 12px" }}>
      {requestError && <Alert severity="warning">{requestError}</Alert>}
      {draft?.request && (
        <Alert severity="info">
          A pending save is retained. Retry sends that same saved request; newer
          typing stays in your draft.
        </Alert>
      )}
      <Button onClick={exportRecovery}>Download recovery</Button>
      <Button onClick={() => void load(false)} disabled={isSaving}>
        Load latest server source
      </Button>
      {recoveries.length > 0 && (
        <details>
          <summary>
            Retained drafts and legacy changes ({recoveries.length})
          </summary>
          <p>
            Review recovered text against the latest server source. Using it
            starts a new draft; earlier recovery copies remain stored.
          </p>
          <select
            aria-label="Recovered source"
            value={selectedRecovery}
            onChange={(event) => setSelectedRecovery(event.target.value)}
          >
            <option value="">Choose a retained source</option>
            {recoveries
              .filter((item) => recoverySource(item) !== null)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.updatedAt).toLocaleString()} —{" "}
                  {item.kind === "legacy" ? "legacy edit" : "editor draft"}
                </option>
              ))}
          </select>
          <Button onClick={restore} disabled={!selected || !latest || isSaving}>
            Use recovered source on latest version
          </Button>
          {selected && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 180,
                overflow: "auto",
              }}
            >
              {recoverySource(selected)}
            </pre>
          )}
        </details>
      )}
    </div>
  );
  if (initialValue === null)
    return (
      <>
        {recoveryBar}
        <div>Loading or unavailable...</div>
      </>
    );

  return (
    <div style={{ height: "calc(100vh - 64px)", overflow: "auto" }}>
      {recoveryBar}
      <Split>
        <div
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            ref={editorRef}
            style={{ height: "100%", width: "100%", overflow: "auto" }}
          />
          <ShowError error={error} setError={setError} />
          <Tooltip
            title={
              draft?.request ? "Retry pending save (Ctrl+S)" : "Save (Ctrl+S)"
            }
          >
            <IconButton
              sx={{
                position: "absolute",
                right: 10,
                top: 10,
                color: "#aaa",
                opacity: isDirty ? 1 : 0.2,
              }}
              aria-label={draft?.request ? "Retry pending save" : "Save ritual"}
              disabled={isSaving || (!isDirty && !draft?.request)}
              onClick={() => void save()}
            >
              <Badge
                color={isDirty ? "error" : "success"}
                variant="dot"
                // invisible={!isDirty}
              >
                <Save />
              </Badge>
            </IconButton>
          </Tooltip>
        </div>
        <div
          style={{
            // width: "30%",
            width: 720,
            minWidth: 100,
            height: "100%",
            overflow: "auto",
          }}
        >
          <DocRender doc={doc} wrapWithErrorBoundary={true} />
        </div>
      </Split>
    </div>
  );
}
