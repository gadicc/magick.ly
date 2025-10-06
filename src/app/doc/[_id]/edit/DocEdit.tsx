"use client";
import { StreamLanguage } from "@codemirror/language";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { Diagnostic, setDiagnostics } from "@codemirror/lint";
import { Close, ErrorOutline, Save } from "@mui/icons-material";
import { Badge, IconButton, Tooltip } from "@mui/material";
import { EditorView, Prec, useCodeMirror } from "@uiw/react-codemirror";
import Split from "@uiw/react-split";
import {
  db,
  GongoClientDocument,
  useGongoOne,
  useGongoSub,
  useGongoUserId,
} from "gongo-client-react";
import pugLex from "pug-lexer";
import pugParse from "pug-parser";
import React from "react";
import { toJrt } from "@/doc/prepare";
import { DocNode, DocRevision } from "@/schemas";
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
      <ErrorOutline sx={{ verticalAlign: "middle" }} />
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

let timeout;
export default function DocEdit({
  params: { _id },
}: {
  params: { _id: string };
}) {
  useGongoSub("doc", { _id });
  useGongoSub("docRevisions", { docId: _id });
  const userId = useGongoUserId();

  const _dbDoc = useGongoOne((db) => db.collection("docs").find({ _id }));
  const [dbDoc, setDbDoc] = React.useState(_dbDoc);
  const dbDocRevision = useGongoOne((db) =>
    db.collection("docRevisions").find({ _id: dbDoc?.docRevisionId }),
  );
  const [initialValue, setInitialValue] = React.useState<string | null>(null);

  // We want the reactivity for first load, but never again.
  React.useEffect(() => {
    if (_dbDoc && !dbDoc) setDbDoc(_dbDoc);
    if (initialValue === null && !_dbDoc?.docRevisionId) {
      console.log("no docRevisionId, setting initialValue to ''");
      setInitialValue("");
    }
  }, [_dbDoc, dbDoc, initialValue]);
  React.useEffect(() => {
    if (dbDocRevision && (initialValue === null || initialValue === "")) {
      console.log(
        "Revision loaded, setting initialValue to dbDocRevision.text",
      );
      console.log(dbDocRevision);
      setInitialValue(dbDocRevision.text);
    }
  }, [dbDocRevision, initialValue]);

  const [doc, setDoc] = React.useState<DocNode>({ type: "root", children: [] });
  const [error, setError] = React.useState<Error | null>(null);
  const [lastSavedValue, setLastSavedValue] = React.useState("");
  const viewRef = React.useRef<EditorView | undefined>(undefined);
  const windowDocRef = React.useRef<Partial<ScriptProps>>({});
  if (window !== undefined) {
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

  const isDirty = windowDocRef.current.value !== lastSavedValue;

  const onChange = React.useCallback((value, viewUpdate) => {
    windowDocRef.current.value = value;
    // console.log("value", value);
    // console.log("viewUpdate", viewUpdate);
    // setDocSrc(value);

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(async () => {
      const { transformed, sourceMap } = await transformAndMapShortcuts(value);
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
  }, []);
  windowDocRef.current.onChange = onChange;

  const save = React.useCallback(() => {
    if (!isDirty) return;

    const text = viewRef.current?.state.doc.toString();
    if (!text) {
      console.log("nothing to save, text is empty");
      return;
    }

    if (!userId) {
      alert("no userId");
      return;
    }
    console.log("save");
    // console.log(dbDoc);

    const lastRevision = db
      .collection("docRevisions")
      .find({ docId: _id, userId })
      .sort("updatedAt", -1)
      .limit(1)
      .toArraySync()[0] as DocRevision;
    // console.log({ lastRevision });

    let docRevisionId = lastRevision?._id;
    if (
      !lastRevision ||
      (lastRevision.updatedAt &&
        lastRevision.updatedAt.getTime() < new Date().getTime() - 1000 * 60 * 5)
    ) {
      const newRevision = {
        docId: _id,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        text,
        __ObjectIDs: ["docId", "userId"],
      };
      // console.log(newRevision);
      // TODO, gongo returned doc should not have optionalId
      const insertedDoc = db.collection("docRevisions").insert(newRevision);
      docRevisionId = insertedDoc._id as string;
    } else {
      db.collection("docRevisions").update(
        { _id: lastRevision._id },
        { $set: { text, updatedAt: new Date() } },
      );
      // console.log("lastRevision", lastRevision);
      // console.log({ $set: { text, updatedAt: new Date() } });
      // console.log(result);
    }

    db.collection("docs").update(
      { _id },
      {
        $set: {
          doc: JSON.parse(
            JSON.stringify(doc, (key, value) => {
              // DocRender adds ref to html nodes, which we don't want to save.
              if (key === "ref") return undefined;
              return value;
            }),
          ),
          docRevisionId,
          updatedAt: new Date(),
        },
      },
    );
    (function () {
      const doc = db.collection("docs").findOne(_id) as GongoClientDocument;
      if (doc && doc.__ObjectIDs && !doc.__ObjectIDs.includes("docRevisionId"))
        doc.__ObjectIDs.push("docRevisionId");
    })();

    setLastSavedValue(text);
  }, [_id, userId, doc, isDirty]);

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

  /*
  React.useEffect(() => {
    console.log("state", state);
  }, [state]);
  */
  React.useEffect(() => {
    if (view) {
      // console.log("view", view);
      viewRef.current = view;
      if (initialValue) {
        setLastSavedValue(initialValue);
        view.dispatch({
          changes: {
            from: 0,
            insert: initialValue,
          },
        });
      }
    }
  }, [view, initialValue]);

  const editorRef = React.useCallback(
    (node) => {
      setContainer(node);
    },
    [setContainer],
  );

  if (initialValue === null) return <div>Loading or not found...</div>;

  return (
    <div style={{ height: "calc(100vh - 64px)", overflow: "hidden" }}>
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
          <Tooltip title="Save (Ctrl+S)">
            <IconButton
              sx={{
                position: "absolute",
                right: 10,
                top: 10,
                color: "#aaa",
                opacity: isDirty ? 1 : 0.2,
              }}
              onClick={save}
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
