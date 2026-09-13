import type { EditorView } from "@uiw/react-codemirror";

export interface ScriptProps {
  onChange: (value: string, viewUpdate?: unknown) => void;
  value: string;
  transformed: string;
  run: (script: string) => void;
  view: EditorView;
}
