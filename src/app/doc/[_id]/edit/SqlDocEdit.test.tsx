// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { formatRitualFileLocator } from "@/files/ritualFileLocator";
import { LockedRecoveryQueue } from "@/offline/recovery";
import {
  createCreationPublicationHandoff,
  creationPublicationHandoffKey,
  retainCreationPublicationHandoff,
} from "@/offline/ritualPublicationHandoff";
import SqlDocEdit from "./SqlDocEdit";

const ids = vi.hoisted(() => ({
  owner: "01995100-0000-7000-8000-000000000001",
  epoch: "01995100-0000-7000-8000-000000000002",
  ritualA: "01995100-0000-7000-8000-000000000003",
  ritualB: "01995100-0000-7000-8000-000000000004",
  revision: "01995100-0000-7000-8000-000000000005",
  nextRevision: "01995100-0000-7000-8000-000000000006",
  claim: "01995100-0000-7000-8000-000000000007",
  createOperation: "01995100-0000-7000-8000-000000000009",
  bundle: "01995100-0000-7000-8000-000000000010",
  attachment: "01995100-0000-7000-8000-000000000011",
  file: "01995100-0000-7000-8000-000000000012",
  renewedPublication: "01995100-0000-7000-8000-000000000013",
}));
const mock = vi.hoisted(() => ({
  register: vi.fn(),
  registered: null as null | {
    captureRecovery?: () => { persist(): Promise<void> } | null;
    hide(reason: string, options: { retainUncapturedDraft: boolean }): void;
    available(): void;
  },
  source: vi.fn(),
  drafts: vi.fn(),
  pending: vi.fn(),
  publication: vi.fn(),
  expiredPublication: vi.fn(),
  preserve: vi.fn(),
  enqueue: vi.fn(),
  resume: vi.fn(),
  claim: vi.fn(),
  settle: vi.fn(),
  enqueuePublication: vi.fn(),
  resumePublication: vi.fn(),
  claimPublication: vi.fn(),
  settlePublication: vi.fn(),
  renewPublication: vi.fn(),
  exportDraft: vi.fn(),
  send: vi.fn(),
  sendPublication: vi.fn(),
  sync: vi.fn(),
  diagnostics: vi.fn(),
  transform: vi.fn(),
  download: vi.fn(),
  commitAllowed: true,
  deferEditorView: false,
  releaseEditorView: null as null | (() => void),
  readEditorValue: null as null | (() => string),
}));

let recoveryQueue = new LockedRecoveryQueue();

const account = { ownerId: ids.owner, epoch: ids.epoch };
type RuntimeState = {
  phase: "checking" | "ready";
  generation: number;
  account: typeof account;
};
let runtimeState: RuntimeState = {
  phase: "ready",
  generation: 1,
  account,
};
const runtimeStateListeners = new Set<(state: RuntimeState) => void>();

function emitRuntimePhase(phase: RuntimeState["phase"]) {
  runtimeState = { ...runtimeState, phase };
  for (const listener of runtimeStateListeners) listener(runtimeState);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
const runtime = {
  start: vi.fn().mockResolvedValue(undefined),
  refreshVerifiedAccount: vi.fn().mockResolvedValue(true),
  subscribeState: vi.fn((listener: (state: RuntimeState) => void) => {
    runtimeStateListeners.add(listener);
    listener(runtimeState);
    return () => runtimeStateListeners.delete(listener);
  }),
  repository: {
    readInstalledSource: (...args: unknown[]) => mock.source(...args),
    listDrafts: (...args: unknown[]) => mock.drafts(...args),
    readRetriableSave: (...args: unknown[]) => mock.pending(...args),
    readRetriablePublication: (...args: unknown[]) => mock.publication(...args),
    readExpiredPublication: (...args: unknown[]) =>
      mock.expiredPublication(...args),
    preserveDraft: (...args: unknown[]) => mock.preserve(...args),
    enqueueSave: (...args: unknown[]) => mock.enqueue(...args),
    resumeAuthenticatedSave: (...args: unknown[]) => mock.resume(...args),
    claimSave: (...args: unknown[]) => mock.claim(...args),
    settleSave: (...args: unknown[]) => mock.settle(...args),
    enqueuePublication: (...args: unknown[]) =>
      mock.enqueuePublication(...args),
    resumeAuthenticatedPublication: (...args: unknown[]) =>
      mock.resumePublication(...args),
    claimPublication: (...args: unknown[]) => mock.claimPublication(...args),
    settlePublication: (...args: unknown[]) => mock.settlePublication(...args),
    renewExpiredPublication: (...args: unknown[]) =>
      mock.renewPublication(...args),
    exportDraft: (...args: unknown[]) => mock.exportDraft(...args),
  },
  coordinator: {
    get state() {
      return runtimeState;
    },
    register: (...args: unknown[]) => mock.register(...args),
    commit: vi.fn((_operation: unknown, work: () => void) => {
      if (!mock.commitAllowed) return false;
      work();
      return true;
    }),
    finish: vi.fn(),
  },
};

vi.mock("@/offline/browserRuntime", () => ({
  getBrowserOfflineRuntime: () => runtime,
}));
vi.mock("@/offline/ritualSourceSync", () => ({
  syncOfflineRitualSource: (...args: unknown[]) => mock.sync(...args),
}));
vi.mock("@/doc/sqlEditorClient", () => ({
  sendSqlRitualWrite: (...args: unknown[]) => mock.send(...args),
  sendRitualPublication: (...args: unknown[]) => mock.sendPublication(...args),
}));
vi.mock("@/doc/drafts", () => ({
  downloadRitualRecovery: (...args: unknown[]) => mock.download(...args),
}));
vi.mock("@uiw/react-codemirror", async () => {
  const { useCallback, useEffect, useMemo, useRef, useState } = await import(
    "react"
  );
  return {
    Prec: { highest: (value: unknown) => value },
    useCodeMirror: ({ onChange }: { onChange(value: string): void }) => {
      const change = useRef(onChange);
      change.current = onChange;
      const container = useRef<HTMLElement | null>(null);
      const textarea = useRef<HTMLTextAreaElement | null>(null);
      const editor = useMemo(() => {
        let value = "";
        const result = {
          state: {
            doc: {
              get length() {
                return value.length;
              },
              toString: () => value,
            },
          },
          dispatch: (update?: { changes?: { insert: string } }) => {
            if (!update?.changes) return;
            value = update.changes.insert;
            if (textarea.current) textarea.current.value = value;
            change.current(value);
          },
        };
        return result;
      }, []);
      const [view, setView] = useState<typeof editor | undefined>();
      const activate = useCallback(() => {
        setView(editor);
        const node = container.current;
        if (node && !textarea.current) {
          const input = document.createElement("textarea");
          input.setAttribute("aria-label", "Ritual source");
          input.value = editor.state.doc.toString();
          input.oninput = () =>
            editor.dispatch({ changes: { insert: input.value } });
          node.replaceChildren(input);
          textarea.current = input;
        }
      }, [editor]);
      useEffect(() => {
        mock.releaseEditorView = activate;
        mock.readEditorValue = () => editor.state.doc.toString();
        return () => {
          if (mock.releaseEditorView === activate)
            mock.releaseEditorView = null;
          mock.readEditorValue = null;
        };
      }, [activate, editor]);
      const setContainer = useCallback(
        (node: HTMLElement | null) => {
          container.current = node;
          if (!node) {
            textarea.current = null;
            return;
          }
          if (view) activate();
          else if (!mock.deferEditorView) activate();
        },
        [activate, view],
      );
      return { view, setContainer };
    },
  };
});
vi.mock("@uiw/react-split", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@codemirror/lint", () => ({
  setDiagnostics: (...args: unknown[]) => mock.diagnostics(...args),
}));
vi.mock("../DocRender", () => ({
  default: ({ doc }: { doc: unknown }) => (
    <output aria-label="Preview">{JSON.stringify(doc)}</output>
  ),
}));
vi.mock("./scripts", () => ({ default: {} }));
vi.mock("./checkSrc", () => ({ checkSrc: () => [] }));
vi.mock("./SourceMapConsumer", () => ({
  default: class {
    originalPositionFor(value: unknown) {
      return value;
    }
    destroy() {}
  },
}));
vi.mock("./shortcuts", () => ({
  shortcutHighlighters: [],
  transformAndMapShortcuts: (...args: unknown[]) => mock.transform(...args),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  recoveryQueue = new LockedRecoveryQueue();
  runtimeState = { phase: "ready", generation: 1, account };
  runtimeStateListeners.clear();
  mock.commitAllowed = true;
  mock.deferEditorView = false;
  mock.releaseEditorView = null;
  mock.readEditorValue = null;
  mock.registered = null;
  runtime.start.mockResolvedValue(undefined);
  runtime.refreshVerifiedAccount.mockResolvedValue(true);
  mock.source.mockImplementation((_account, ritualId) =>
    Promise.resolve({
      ownerId: ids.owner,
      ritualId,
      revisionId: ids.revision,
      parentVersion: 4,
      title: ritualId === ids.ritualA ? "Protected A" : "Protected B",
      source: `p Source ${ritualId === ids.ritualA ? "A" : "B"}`,
    }),
  );
  mock.drafts.mockResolvedValue([]);
  mock.pending.mockResolvedValue(null);
  mock.publication.mockResolvedValue(null);
  mock.expiredPublication.mockResolvedValue(null);
  mock.preserve.mockResolvedValue({
    id: "01995100-0000-7000-8000-000000000008",
    localVersion: 1,
    conflict: false,
  });
  mock.enqueue.mockResolvedValue(undefined);
  mock.resume.mockResolvedValue(false);
  mock.claim.mockResolvedValue({
    account,
    ritualId: ids.ritualA,
    operationId: "01995100-0000-7000-8000-000000000009",
    claimId: ids.claim,
    payloadJson: "{}",
  });
  mock.settle.mockResolvedValue(true);
  mock.enqueuePublication.mockResolvedValue(undefined);
  mock.resumePublication.mockResolvedValue(false);
  mock.claimPublication.mockImplementation((_account, binding) =>
    Promise.resolve({ ...binding, account, claimId: ids.claim }),
  );
  mock.settlePublication.mockResolvedValue(true);
  mock.renewPublication.mockImplementation((_account, binding) =>
    Promise.resolve({
      ...binding,
      request: {
        ...binding.request,
        operationId: ids.renewedPublication,
      },
    }),
  );
  mock.exportDraft.mockImplementation((_account, ritualId, draftId) => {
    const input = mock.preserve.mock.calls.at(-1)?.[0];
    return Promise.resolve(
      input
        ? {
            ...input,
            ritualId,
            id: draftId,
            localVersion: 1,
            conflictOf: null,
          }
        : null,
    );
  });
  mock.send.mockResolvedValue(null);
  mock.sendPublication.mockResolvedValue(null);
  mock.sync.mockResolvedValue(null);
  mock.transform.mockImplementation(async (value: string) => ({
    transformed: value,
    sourceMap: {},
  }));
  mock.register.mockImplementation((view) => {
    mock.registered = view;
    const registration = {
      begin: () => ({ signal: new AbortController().signal }),
      beginPermissionCheck: () => ({
        account,
        signal: new AbortController().signal,
      }),
      dispose: vi.fn(() => {
        const recovery = view.captureRecovery?.();
        if (recovery) recoveryQueue.add(recovery);
        view.hide("unmount", { retainUncapturedDraft: false });
      }),
    };
    queueMicrotask(() => view.available());
    return registration;
  });
});
afterEach(() => {
  cleanup();
  delete (window as Window & { doc?: unknown }).doc;
});

it("runs one initial source check when account activation becomes ready", async () => {
  runtimeState = { ...runtimeState, phase: "checking" };
  mock.sync.mockImplementation(async () => {
    mock.registered?.hide("change", { retainUncapturedDraft: false });
    return null;
  });
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();
  expect(mock.sync).not.toHaveBeenCalled();

  await act(async () => emitRuntimePhase("ready"));
  expect(
    await screen.findByText(/Ritual source is locked or unavailable/i),
  ).toBeDefined();
  expect(mock.sync).toHaveBeenCalledOnce();

  await act(async () => emitRuntimePhase("ready"));
  expect(mock.sync).toHaveBeenCalledOnce();
});

it("retries when registration refresh interrupts source sync before permission acceptance", async () => {
  mock.sync
    .mockImplementationOnce(async (...args: unknown[]) => {
      const onInterrupted = args[5] as () => void;
      onInterrupted();
      return null;
    })
    .mockResolvedValueOnce(null);
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();

  await waitFor(() => expect(mock.sync).toHaveBeenCalledTimes(2));
  await act(async () => emitRuntimePhase("ready"));
  expect(mock.sync).toHaveBeenCalledTimes(2);
});

it("retains already gated source when a readiness-triggered refresh rejects", async () => {
  const sync = deferred<null>();
  mock.sync.mockReturnValue(sync.promise);
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();
  expect(mock.sync).toHaveBeenCalledOnce();

  await act(async () => sync.reject(new Error("sanitized provider failure")));
  expect(screen.getByText("Protected A")).toBeDefined();
  expect(screen.getByLabelText("Ritual source")).toBeDefined();
});

it("hydrates and compiles an authorized source when the editor view is delayed", async () => {
  mock.deferEditorView = true;
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();
  expect(screen.queryByLabelText("Ritual source")).toBeNull();

  act(() => mock.releaseEditorView?.());
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  expect(source.value).toBe("p Source A");
  await waitFor(() =>
    expect(screen.getByLabelText("Preview").textContent).toContain("Source A"),
  );
  expect(mock.transform).toHaveBeenCalledWith("p Source A");

  await act(
    async () => await new Promise((resolve) => window.setTimeout(resolve, 550)),
  );
  expect(mock.preserve).toHaveBeenCalledOnce();
});

it("never creates a delayed view with locked source and hydrates only the regrant", async () => {
  mock.deferEditorView = true;
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();

  act(() => {
    mock.registered?.hide("expiry", { retainUncapturedDraft: false });
    mock.releaseEditorView?.();
  });
  expect(mock.readEditorValue?.()).toBe("");
  expect(screen.queryByLabelText("Ritual source")).toBeNull();

  mock.source.mockResolvedValue({
    ownerId: ids.owner,
    ritualId: ids.ritualA,
    revisionId: ids.nextRevision,
    parentVersion: 5,
    title: "Protected regrant",
    source: "p Source regrant",
  });
  act(() => mock.registered?.available());

  expect(await screen.findByText("Protected regrant")).toBeDefined();
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  expect(source.value).toBe("p Source regrant");
  expect(source.value).not.toContain("Source A");
  expect(mock.readEditorValue?.()).toBe("p Source regrant");
  await waitFor(() =>
    expect(screen.getByLabelText("Preview").textContent).toContain(
      "Source regrant",
    ),
  );
});

it("retries an active source check invalidated by account activation without looping on its own change", async () => {
  const first = deferred<null>();
  const second = deferred<null>();
  mock.sync
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();
  expect(mock.sync).toHaveBeenCalledOnce();

  act(() => {
    emitRuntimePhase("checking");
    mock.registered?.hide("account", { retainUncapturedDraft: false });
  });
  await act(async () => first.resolve(null));
  expect(mock.sync).toHaveBeenCalledOnce();

  await act(async () => emitRuntimePhase("ready"));
  await waitFor(() => expect(mock.sync).toHaveBeenCalledTimes(2));
  act(() => {
    emitRuntimePhase("checking");
    mock.registered?.hide("change", { retainUncapturedDraft: false });
    emitRuntimePhase("ready");
  });
  await act(async () => second.resolve(null));
  expect(mock.sync).toHaveBeenCalledTimes(2);
});

it("clears source, title, preview, and script access when the capability locks", async () => {
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(await screen.findByText("Protected A")).toBeDefined();
  const source = screen.getByLabelText("Ritual source") as HTMLTextAreaElement;
  expect(source.value).toBe("p Source A");
  fireEvent.input(source, { target: { value: "p Unsaved A" } });
  const recovery = mock.registered?.captureRecovery?.();
  expect(recovery).not.toBeNull();
  act(() => mock.registered?.hide("expiry", { retainUncapturedDraft: false }));
  expect(screen.queryByText("Protected A")).toBeNull();
  expect(screen.queryByLabelText("Ritual source")).toBeNull();
  expect(screen.queryByLabelText("Preview")).toBeNull();
  expect((window as Window & { doc?: unknown }).doc).toBeUndefined();
  await recovery?.persist();
  expect(mock.preserve).toHaveBeenCalledWith(
    expect.objectContaining({ source: "p Unsaved A" }),
    expect.any(Number),
  );
});

it("keeps an inserted attachment in CodeMirror and in the following edit", async () => {
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  const locator = formatRitualFileLocator({
    ritualId: ids.ritualA,
    attachmentId: ids.attachment,
    fileId: ids.file,
  });
  fireEvent.change(screen.getByLabelText("Attached image source reference"), {
    target: { value: locator },
  });
  fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
  expect(source.value).toContain(`img(src=${JSON.stringify(locator)})`);

  fireEvent.input(source, { target: { value: `${source.value}p Tail` } });
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  await waitFor(() => expect(mock.send).toHaveBeenCalledOnce());
  expect(mock.send.mock.calls[0][0].source).toContain(
    `img(src=${JSON.stringify(locator)})\np Tail`,
  );
});

it("ignores an older compilation that finishes after the latest source", async () => {
  const first = deferred<{ transformed: string; sourceMap: object }>();
  mock.transform.mockImplementation((value: string) =>
    value === "p First"
      ? first.promise
      : Promise.resolve({ transformed: value, sourceMap: {} }),
  );
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  fireEvent.input(source, { target: { value: "p First" } });
  await act(
    async () => await new Promise((resolve) => window.setTimeout(resolve, 350)),
  );
  fireEvent.input(source, { target: { value: "p Second" } });
  await act(
    async () => await new Promise((resolve) => window.setTimeout(resolve, 350)),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Preview").textContent).toContain("Second"),
  );
  await act(async () => {
    first.resolve({ transformed: "p First", sourceMap: {} });
    await first.promise;
  });
  expect(screen.getByLabelText("Preview").textContent).toContain("Second");
  expect(screen.getByLabelText("Preview").textContent).not.toContain("First");
});

it("persists a captured debounce-window edit after the editor unmounts", async () => {
  const rendered = render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  fireEvent.input(source, { target: { value: "p Unsaved before navigation" } });
  rendered.unmount();
  await waitFor(() =>
    expect(mock.preserve).toHaveBeenCalledWith(
      expect.objectContaining({ source: "p Unsaved before navigation" }),
      expect.any(Number),
    ),
  );
  expect(recoveryQueue.state.failed).toBe(0);
  expect(recoveryQueue.state.pending).toBe(0);
});

it("does not export source after the capability is revoked during the guarded read", async () => {
  const exported = deferred<null>();
  mock.exportDraft.mockReturnValue(exported.promise);
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  await screen.findByLabelText("Ritual source");
  fireEvent.click(screen.getByRole("button", { name: "Download recovery" }));
  await waitFor(() => expect(mock.exportDraft).toHaveBeenCalledOnce());
  act(() => {
    mock.commitAllowed = false;
    mock.registered?.hide("expiry", { retainUncapturedDraft: false });
  });
  await act(async () => exported.resolve(null));
  expect(mock.download).not.toHaveBeenCalled();
});

it("preserves the current unsaved source before a gated recovery export", async () => {
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  fireEvent.input(source, { target: { value: "p Unsaved export" } });
  fireEvent.click(screen.getByRole("button", { name: "Download recovery" }));
  await waitFor(() => expect(mock.download).toHaveBeenCalledOnce());
  expect(mock.exportDraft).toHaveBeenCalledWith(
    account,
    ids.ritualA,
    expect.any(String),
  );
  expect(mock.download).toHaveBeenCalledWith({
    draft: expect.objectContaining({
      ownerId: ids.owner,
      ritualId: ids.ritualA,
      source: "p Unsaved export",
    }),
  });
});

it("does not render route A while route B resolves", async () => {
  const rendered = render(
    <SqlDocEdit key={ids.ritualA} ritualId={ids.ritualA} />,
  );
  expect(await screen.findByText("Protected A")).toBeDefined();
  rendered.rerender(<SqlDocEdit key={ids.ritualB} ritualId={ids.ritualB} />);
  expect(screen.queryByText("Protected A")).toBeNull();
  expect(await screen.findByText("Protected B")).toBeDefined();
});

it("retries an unknown save with the same exact CAS request", async () => {
  mock.send.mockResolvedValueOnce(null).mockResolvedValueOnce({
    ok: true,
    replayed: true,
    ritualId: ids.ritualA,
    revisionId: ids.nextRevision,
    version: 5,
    updatedAt: "2026-09-13T12:00:00.000Z",
  });
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  fireEvent.input(source, { target: { value: "p Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  await screen.findByRole("button", { name: "Retry pending save" });
  const request = mock.send.mock.calls[0][0];
  expect(request).toMatchObject({
    version: 2,
    kind: "save",
    expectedActorId: ids.owner,
    ritualId: ids.ritualA,
    expectedRevisionId: ids.revision,
    expectedVersion: 4,
    source: "p Changed",
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry pending save" }));
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(2));
  expect(mock.send.mock.calls[1][0]).toEqual(request);
  expect(mock.settle).toHaveBeenCalledTimes(2);
});

it("publishes an acknowledged save with its original write identity without claiming an offline download", async () => {
  mock.send.mockResolvedValue({
    ok: true,
    replayed: false,
    ritualId: ids.ritualA,
    revisionId: ids.nextRevision,
    version: 5,
    updatedAt: "2026-09-13T12:00:00.000Z",
  });
  mock.publication.mockImplementation(() => {
    const write = mock.send.mock.calls[0]?.[0];
    return Promise.resolve(
      write
        ? {
            parentWriteOperationId: write.operationId,
            request: {
              version: 1,
              operationId: write.operationId,
              expectedActorId: ids.owner,
              ritualId: ids.ritualA,
              expectedRevisionId: ids.nextRevision,
              expectedVersion: 5,
            },
          }
        : null,
    );
  });
  mock.sendPublication.mockImplementation((request) =>
    Promise.resolve({
      ok: true,
      state: "completed",
      replayed: false,
      receipt: {
        operationId: request.operationId,
        bundleId: ids.bundle,
        ritualId: request.ritualId,
        publishedAtMs: 1,
      },
    }),
  );
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  fireEvent.input(source, { target: { value: "p Published" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  expect(await screen.findByText(/published for download/i)).toBeDefined();
  const write = mock.send.mock.calls[0][0];
  expect(mock.sendPublication).toHaveBeenCalledWith(
    expect.objectContaining({
      operationId: write.operationId,
      expectedActorId: ids.owner,
      ritualId: ids.ritualA,
      expectedRevisionId: ids.nextRevision,
      expectedVersion: 5,
    }),
    expect.any(AbortSignal),
  );
  expect(screen.queryByText(/offline ready/i)).toBeNull();
});

it("waits for the post-save source refresh before publishing", async () => {
  const refreshed = deferred<null>();
  mock.sync.mockResolvedValueOnce(null).mockReturnValueOnce(refreshed.promise);
  mock.send.mockResolvedValue({
    ok: true,
    replayed: false,
    ritualId: ids.ritualA,
    revisionId: ids.nextRevision,
    version: 5,
    updatedAt: "2026-09-13T12:00:00.000Z",
  });
  mock.publication.mockImplementation(() => {
    const write = mock.send.mock.calls[0]?.[0];
    return Promise.resolve(
      write
        ? {
            parentWriteOperationId: write.operationId,
            request: {
              version: 1,
              operationId: write.operationId,
              expectedActorId: ids.owner,
              ritualId: ids.ritualA,
              expectedRevisionId: ids.nextRevision,
              expectedVersion: 5,
            },
          }
        : null,
    );
  });
  mock.sendPublication.mockResolvedValue({
    ok: true,
    state: "completed",
    replayed: false,
    receipt: {
      operationId: ids.createOperation,
      bundleId: ids.bundle,
      ritualId: ids.ritualA,
      publishedAtMs: 1,
    },
  });

  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  await waitFor(() => expect(mock.sync).toHaveBeenCalledOnce());
  fireEvent.input(source, { target: { value: "p Ordered" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));

  await waitFor(() => expect(mock.sync).toHaveBeenCalledTimes(2));
  expect(mock.sendPublication).not.toHaveBeenCalled();
  await act(async () => refreshed.resolve(null));
  await waitFor(() => expect(mock.sendPublication).toHaveBeenCalledOnce());
});

it("retains the publication retry when the post-save refresh rejects", async () => {
  mock.sync
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("sanitized refresh failure"));
  mock.send.mockResolvedValue({
    ok: true,
    replayed: false,
    ritualId: ids.ritualA,
    revisionId: ids.nextRevision,
    version: 5,
    updatedAt: "2026-09-13T12:00:00.000Z",
  });
  mock.publication.mockImplementation(() => {
    const write = mock.send.mock.calls[0]?.[0];
    return Promise.resolve(
      write
        ? {
            parentWriteOperationId: write.operationId,
            request: {
              version: 1,
              operationId: write.operationId,
              expectedActorId: ids.owner,
              ritualId: ids.ritualA,
              expectedRevisionId: ids.nextRevision,
              expectedVersion: 5,
            },
          }
        : null,
    );
  });
  mock.sendPublication
    .mockResolvedValueOnce(null)
    .mockImplementationOnce((request) =>
      Promise.resolve({
        ok: true,
        state: "completed",
        replayed: false,
        receipt: {
          operationId: request.operationId,
          bundleId: ids.bundle,
          ritualId: request.ritualId,
          publishedAtMs: 1,
        },
      }),
    );

  render(<SqlDocEdit ritualId={ids.ritualA} />);
  const source = (await screen.findByLabelText(
    "Ritual source",
  )) as HTMLTextAreaElement;
  await waitFor(() => expect(mock.sync).toHaveBeenCalledOnce());
  fireEvent.input(source, { target: { value: "p Retryable" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));

  const retry = await screen.findByRole("button", {
    name: "Retry publication",
  });
  expect(mock.sync).toHaveBeenCalledTimes(2);
  expect(mock.sendPublication).toHaveBeenCalledOnce();
  const retainedRequest = mock.sendPublication.mock.calls[0][0];

  fireEvent.click(retry);
  await screen.findByText(/published for download/i);
  expect(mock.sendPublication).toHaveBeenCalledTimes(2);
  expect(mock.sendPublication.mock.calls[1][0]).toEqual(retainedRequest);
});

it("offers explicit renewal only after an exact expired publication result", async () => {
  const request = {
    version: 1 as const,
    operationId: ids.createOperation,
    expectedActorId: ids.owner,
    ritualId: ids.ritualA,
    expectedRevisionId: ids.revision,
    expectedVersion: 4,
  };
  const publication = {
    parentWriteOperationId: ids.createOperation,
    request,
  };
  mock.publication.mockResolvedValue(publication);
  mock.sendPublication.mockResolvedValue({
    ok: false,
    code: "EXPIRED",
    message:
      "This publication attempt expired. Start a new attempt for the current saved version.",
    retryable: false,
  });
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  expect(
    await screen.findByText(/start a new attempt for this unchanged/i),
  ).toBeDefined();
  expect(
    screen.queryByRole("button", { name: "Retry publication" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Start new publication attempt" }),
  ).toBeDefined();
  expect(mock.settlePublication).toHaveBeenCalledWith(
    expect.objectContaining(publication),
    expect.objectContaining({ code: "EXPIRED", retryable: false }),
  );
});

it("renews a persisted expired publication and sends the durable replacement identity", async () => {
  const expired = {
    parentWriteOperationId: ids.createOperation,
    request: {
      version: 1 as const,
      operationId: ids.createOperation,
      expectedActorId: ids.owner,
      ritualId: ids.ritualA,
      expectedRevisionId: ids.revision,
      expectedVersion: 4,
    },
  };
  const renewed = {
    ...expired,
    request: {
      ...expired.request,
      operationId: ids.renewedPublication,
    },
  };
  mock.expiredPublication.mockResolvedValue(expired);
  mock.renewPublication.mockResolvedValue(renewed);
  mock.sendPublication.mockImplementation((request) =>
    Promise.resolve({
      ok: true,
      state: "completed",
      replayed: false,
      receipt: {
        operationId: request.operationId,
        bundleId: ids.bundle,
        ritualId: request.ritualId,
        publishedAtMs: 1,
      },
    }),
  );

  render(<SqlDocEdit ritualId={ids.ritualA} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Start new publication attempt",
    }),
  );

  await screen.findByText(/published for download/i);
  expect(mock.renewPublication).toHaveBeenCalledWith(account, expired);
  expect(mock.sendPublication).toHaveBeenCalledWith(
    renewed.request,
    expect.any(AbortSignal),
  );
});

it("moves an acknowledged create handoff into the gated outbox before publication", async () => {
  const write = {
    version: 2 as const,
    operationId: ids.createOperation,
    expectedActorId: ids.owner,
    kind: "create" as const,
    scope: { kind: "public" as const },
    title: "Created ritual",
    source: "p Created",
  };
  const result = {
    ok: true as const,
    replayed: false,
    ritualId: ids.ritualA,
    revisionId: ids.revision,
    version: 1,
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
  const handoff = createCreationPublicationHandoff(write, result)!;
  retainCreationPublicationHandoff(localStorage, handoff);
  mock.publication.mockResolvedValue({
    parentWriteOperationId: handoff.write.operationId,
    request: handoff.publication,
  });
  render(<SqlDocEdit ritualId={ids.ritualA} />);
  await screen.findByText("Protected A");
  await waitFor(() =>
    expect(mock.enqueuePublication).toHaveBeenCalledWith(
      account,
      write,
      result,
      handoff.publication,
    ),
  );
  expect(
    localStorage.getItem(creationPublicationHandoffKey(ids.owner, ids.ritualA)),
  ).toBeNull();
});
