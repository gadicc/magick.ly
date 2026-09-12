// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
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
import {
  newRitualDraft,
  persistRitualRecovery,
  readRitualRecovery,
} from "@/doc/drafts";
import DocEdit from "./DocEdit";

const mock = vi.hoisted(() => ({
  userId: "000000000000000000000001",
  call: vi.fn(),
  pending: [] as Record<string, unknown>[],
  transform: vi.fn(),
  consumer: vi.fn(),
  script: vi.fn(),
  diagnostics: vi.fn(),
  consumers: [] as {
    originalPositionFor: (value: unknown) => unknown;
    destroy: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("gongo-client-react", () => ({
  useGongoUserId: () => mock.userId,
  db: {
    call: mock.call,
    collection: (name: string) => ({
      find: () => ({
        toArraySync: () =>
          mock.pending.filter((row) =>
            name === "docRevisions" ? "text" in row : !("text" in row),
          ),
      }),
      _update: vi.fn(),
    }),
  },
}));
vi.mock("@uiw/react-codemirror", async () => {
  const { useRef, useMemo, useCallback } = await import("react");
  return {
    Prec: { highest: (value: unknown) => value },
    useCodeMirror: ({
      onChange,
    }: {
      onChange: (value: string, event?: unknown) => void;
    }) => {
      const change = useRef(onChange);
      change.current = onChange;
      const textarea = useRef<HTMLTextAreaElement | null>(null);
      const view = useMemo(() => {
        let value = "";
        return {
          state: {
            doc: {
              get length() {
                return value.length;
              },
              toString: () => value,
            },
          },
          dispatch: (update: { changes?: { insert: string } }) => {
            if (!update.changes) return;
            value = update.changes.insert;
            if (textarea.current) textarea.current.value = value;
            change.current(value, {});
          },
        };
      }, []);
      const setContainer = useCallback(
        (node: HTMLElement | null) => {
          if (!node) return;
          const input = document.createElement("textarea");
          input.setAttribute("aria-label", "Ritual source");
          input.value = view.state.doc.toString();
          input.oninput = () =>
            view.dispatch({ changes: { insert: input.value } });
          node.replaceChildren(input);
          textarea.current = input;
        },
        [view],
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
vi.mock("./scripts", () => ({
  default: { synthetic: (props: unknown) => mock.script(props) },
}));
vi.mock("./checkSrc", () => ({ checkSrc: () => [] }));
vi.mock("./SourceMapConsumer", () => ({
  default: class {
    constructor(map: unknown) {
      return mock.consumer(map);
    }
  },
}));
vi.mock("./shortcuts", () => ({
  shortcutHighlighters: [],
  transformAndMapShortcuts: (...args: unknown[]) => mock.transform(...args),
}));

const actor = "000000000000000000000001";
const docId = "000000000000000000000010";
const revisionId = "000000000000000000000020";
const success = {
  ok: true,
  docId,
  revisionId: "000000000000000000000021",
  updatedAt: 200,
  replayed: false,
};
let write: (request: object) => Promise<unknown>;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  mock.userId = actor;
  mock.pending = [];
  mock.call.mockReset();
  mock.transform.mockReset().mockImplementation(async (source: string) => ({
    transformed: source,
    sourceMap: { source },
  }));
  mock.consumers = [];
  mock.consumer.mockReset().mockImplementation(() => {
    const consumer = {
      originalPositionFor: (value: unknown) => value,
      destroy: vi.fn(),
    };
    mock.consumers.push(consumer);
    return consumer;
  });
  mock.script
    .mockReset()
    .mockImplementation(({ view }) =>
      view.dispatch({ changes: { insert: "p Scripted" } }),
    );
  mock.diagnostics.mockReset().mockReturnValue({});
  write = async () => success;
  mock.call.mockImplementation((name, request) => {
    if (name === "ritualWrite") return write(request);
    if (request.name === "doc")
      return Promise.resolve({
        results: [
          {
            coll: "docs",
            entries: [
              {
                _id: docId,
                docRevisionId: revisionId,
                __updatedAt: 100,
                canEdit: true,
              },
            ],
          },
        ],
      });
    return Promise.resolve({
      results: [
        {
          coll: "docRevisions",
          entries: [
            {
              _id: revisionId,
              docId,
              text: mock.userId === actor ? "p Original" : "p Other account",
            },
          ],
        },
      ],
    });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = () => render(<DocEdit params={{ _id: docId }} />);
const type = (source: string) =>
  fireEvent.input(screen.getByLabelText("Ritual source"), {
    target: { value: source },
  });

it("marks source saved only after acknowledgement and sends one request for duplicate save actions", async () => {
  let resolve!: (result: unknown) => void;
  write = () =>
    new Promise((done) => {
      resolve = done;
    });
  open();
  await screen.findByLabelText("Ritual source");
  type("p Edited");
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(
    mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
  ).toHaveLength(1);
  const retained = readRitualRecovery(localStorage, actor, docId)[0];
  expect(retained).toMatchObject({
    source: "p Edited",
    savedSource: "p Original",
    request: { expectedActorId: actor },
  });
  type("p Typed during request");
  await act(async () => resolve(success));
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Typed during request");
  expect(
    screen
      .getByRole("button", { name: "Save ritual" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(readRitualRecovery(localStorage, actor, docId)[0]).toMatchObject({
    source: "p Typed during request",
    savedSource: "p Edited",
    baseUpdatedAt: 200,
  });
});

it("retains a rejected source and allows a corrected request without silently marking it saved", async () => {
  write = async () => ({
    ok: false,
    code: "INVALID_SOURCE",
    message: "Fix source syntax",
  });
  open();
  await screen.findByLabelText("Ritual source");
  type("p Broken");
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  await screen.findByText("Fix source syntax");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Broken");
  expect(readRitualRecovery(localStorage, actor, docId)).toContainEqual(
    expect.objectContaining({
      request: expect.objectContaining({ source: "p Broken" }),
    }),
  );
  write = async () => success;
  type("p Corrected");
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Save ritual" })
        .hasAttribute("disabled"),
    ).toBe(true),
  );
  const requests = mock.call.mock.calls
    .filter(([name]) => name === "ritualWrite")
    .map(([, request]) => request);
  expect(requests[0].operationId).not.toBe(requests[1].operationId);
  expect(requests[1].source).toBe("p Corrected");
});

it("does not revive an older dirty record when the newest retained editor draft was saved", async () => {
  const snapshot = { docId, revisionId, updatedAt: 100, source: "p Original" };
  persistRitualRecovery(localStorage, {
    ...newRitualDraft(actor, snapshot),
    source: "p Old dirty",
    updatedAt: 1,
  });
  persistRitualRecovery(localStorage, {
    ...newRitualDraft(actor, snapshot),
    updatedAt: 2,
  });
  open();
  await screen.findByLabelText("Ritual source");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Original");
  expect(
    screen
      .getByRole("button", { name: "Save ritual" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("isolates editor source and retained recovery when the signed-in account changes", async () => {
  const rendered = open();
  await screen.findByLabelText("Ritual source");
  type("p Private draft A");
  mock.userId = "000000000000000000000002";
  rendered.rerender(<DocEdit params={{ _id: docId }} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
    ).toBe("p Other account"),
  );
  expect(
    screen.queryByText("Retained drafts and legacy changes (1)"),
  ).toBeNull();
  expect(readRitualRecovery(localStorage, actor, docId)[0]).toMatchObject({
    source: "p Private draft A",
  });
  expect(
    mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
  ).toHaveLength(0);
});

it("does not open or persist a source snapshot that resolves after unmount", async () => {
  let resolve!: (result: unknown) => void;
  mock.call.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const rendered = open();
  await waitFor(() => expect(mock.call).toHaveBeenCalledOnce());
  rendered.unmount();
  await act(async () =>
    resolve({
      results: [{ coll: "docs", entries: [{ _id: docId, canEdit: true }] }],
    }),
  );
  expect(readRitualRecovery(localStorage, actor, docId)).toEqual([]);
});

it("keeps legacy pending source out of automatic saves and restores it only through an explicit action", async () => {
  mock.pending = [
    {
      _id: revisionId,
      docId,
      userId: actor,
      text: "p Legacy unsent",
      __pendingSince: 50,
      __pendingInsert: true,
    },
  ];
  open();
  await screen.findByLabelText("Ritual source");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Original");
  const record = readRitualRecovery(localStorage, actor, docId).find(
    (item) => item.kind === "legacy",
  );
  expect(record).toMatchObject({
    raw: { text: "p Legacy unsent", __pendingInsert: true },
  });
  expect(
    mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByText(/Retained drafts and legacy changes/));
  fireEvent.change(screen.getByLabelText("Recovered source"), {
    target: { value: record?.id },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Use recovered source on latest version",
    }),
  );
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Legacy unsent");
  expect(
    mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save ritual" }));
  await waitFor(() =>
    expect(
      mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
    ).toHaveLength(1),
  );
  expect(
    mock.call.mock.calls.find(([name]) => name === "ritualWrite")?.[1],
  ).toMatchObject({
    source: "p Legacy unsent",
    expectedRevisionId: revisionId,
    expectedUpdatedAt: 100,
  });
});

it("offers the in-memory source as a recovery download if local storage fills up", async () => {
  open();
  await screen.findByLabelText("Ritual source");
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  const createObjectURL = vi.fn((_blob: Blob) => "blob:synthetic-recovery");
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  try {
    type("p Latest in-memory source");
    await screen.findByText(/Local draft storage is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Download recovery" }));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toMatchObject({
      draft: { ownerId: actor, source: "p Latest in-memory source" },
    });
    expect(click).toHaveBeenCalledOnce();
    expect(
      mock.call.mock.calls.filter(([name]) => name === "ritualWrite"),
    ).toHaveLength(0);
  } finally {
    storage.mockRestore();
    click.mockRestore();
  }
});

type ConsoleHandle = Partial<import("./DocEdit").ScriptProps>;
const consoleWindow = window as Window & { doc?: ConsoleHandle };
const currentSource = () =>
  (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const transformed = (source: string) => ({
  transformed: source,
  sourceMap: { source },
});
const previewContains = (value: string) =>
  waitFor(
    () => expect(screen.getByLabelText("Preview").textContent).toContain(value),
    { timeout: 2500 },
  );
const started = (value: string) =>
  waitFor(() => expect(mock.transform).toHaveBeenCalledWith(value), {
    timeout: 2500,
  });

it("keeps console scripting live, then empties the old handle and fences captured callbacks", async () => {
  const mounted = open();
  await screen.findByLabelText("Ritual source");
  const handle = consoleWindow.doc!,
    oldRun = handle.run!,
    oldChange = handle.onChange!;
  act(() => oldRun("synthetic"));
  expect(currentSource()).toBe("p Scripted");
  await previewContains("Scripted");
  expect(handle.transformed).toBe("p Scripted");
  expect(mock.script).toHaveBeenCalledOnce();
  mounted.unmount();
  expect(consoleWindow.doc).toBeUndefined();
  expect(Object.keys(handle)).toEqual([]);
  mock.userId = "000000000000000000000002";
  open();
  await screen.findByLabelText("Ritual source");
  act(() => {
    oldRun("synthetic");
    oldChange("p Stale callback");
  });
  expect(currentSource()).toBe("p Other account");
  expect(mock.script).toHaveBeenCalledOnce();
  expect(readRitualRecovery(localStorage, actor, docId)[0]).toMatchObject({
    kind: "draft",
    source: "p Scripted",
  });
  expect(readRitualRecovery(localStorage, mock.userId, docId)[0]).toMatchObject(
    { kind: "draft", source: "p Other account" },
  );
});

it("does not delete a replacement editor's global when an older mounted editor cleans up", async () => {
  const first = open();
  await screen.findByLabelText("Ritual source");
  const old = consoleWindow.doc!;
  const second = open();
  await waitFor(() =>
    expect(screen.getAllByLabelText("Ritual source")).toHaveLength(2),
  );
  const replacement = consoleWindow.doc!;
  expect(replacement).not.toBe(old);
  first.unmount();
  expect(Object.keys(old)).toEqual([]);
  expect(consoleWindow.doc).toBe(replacement);
  act(() => replacement.run!("synthetic"));
  expect(currentSource()).toBe("p Scripted");
  second.unmount();
  expect(consoleWindow.doc).toBeUndefined();
});

it("rehydrates a functioning console handle after StrictMode effect replay", async () => {
  const setups: {
    handle: ConsoleHandle;
    run: NonNullable<ConsoleHandle["run"]>;
    change: NonNullable<ConsoleHandle["onChange"]>;
  }[] = [];
  function ObserveSetup() {
    React.useEffect(() => {
      const handle = consoleWindow.doc!;
      setups.push({ handle, run: handle.run!, change: handle.onChange! });
    }, []);
    return <DocEdit params={{ _id: docId }} />;
  }
  const mounted = render(
    <React.StrictMode>
      <ObserveSetup />
    </React.StrictMode>,
  );
  await screen.findByLabelText("Ritual source");
  expect(setups).toHaveLength(2);
  expect(setups[0].handle).not.toBe(setups[1].handle);
  expect(Object.keys(setups[0].handle)).toEqual([]);
  const handle = consoleWindow.doc!;
  expect(handle).toBe(setups[1].handle);
  expect(handle.value).toBe("p Original");
  expect(handle.view).toBeDefined();
  act(() => {
    setups[0].run("synthetic");
    setups[0].change("p Retired replay");
  });
  expect(currentSource()).toBe("p Original");
  expect(mock.script).not.toHaveBeenCalled();
  act(() => handle.run!("synthetic"));
  expect(currentSource()).toBe("p Scripted");
  await previewContains("Scripted");
  expect(handle.transformed).toBe("p Scripted");
  expect(mock.script).toHaveBeenCalledOnce();
  mounted.unmount();
  expect(Object.keys(handle)).toEqual([]);
  expect(consoleWindow.doc).toBeUndefined();
});

it("clears the old account's handle without allowing its callbacks to affect the replacement", async () => {
  const mounted = open();
  await screen.findByLabelText("Ritual source");
  type("p Account A source");
  await previewContains("Account A source");
  const handle = consoleWindow.doc!,
    oldRun = handle.run!,
    oldChange = handle.onChange!;
  mock.userId = "000000000000000000000002";
  mounted.rerender(<DocEdit params={{ _id: docId }} />);
  await waitFor(() => expect(currentSource()).toBe("p Other account"));
  expect(consoleWindow.doc).not.toBe(handle);
  expect(Object.keys(handle)).toEqual([]);
  act(() => {
    oldRun("synthetic");
    oldChange("p Account A late write");
  });
  expect(mock.script).not.toHaveBeenCalled();
  expect(currentSource()).toBe("p Other account");
  expect(readRitualRecovery(localStorage, actor, docId)[0]).toMatchObject({
    kind: "draft",
    source: "p Account A source",
  });
});

it("ignores an older source transform that resolves after a newer source preview", async () => {
  const old = deferred<ReturnType<typeof transformed>>();
  mock.transform.mockImplementation((value: string) =>
    value === "p Slow old" ? old.promise : Promise.resolve(transformed(value)),
  );
  open();
  await screen.findByLabelText("Ritual source");
  type("p Slow old");
  await started("p Slow old");
  type("p Current");
  await previewContains("Current");
  const consumersBefore = mock.consumer.mock.calls.length;
  await act(async () => old.resolve(transformed("p Slow old")));
  expect(screen.getByLabelText("Preview").textContent).toContain("Current");
  expect(consoleWindow.doc!.value).toBe("p Current");
  expect(consoleWindow.doc!.transformed).toBe("p Current");
  expect(mock.consumer).toHaveBeenCalledTimes(consumersBefore);
});

it("destroys a stale source-map consumer without replacing newer diagnostics or preview", async () => {
  const old = deferred<{
    originalPositionFor: (value: unknown) => unknown;
    destroy: ReturnType<typeof vi.fn>;
  }>();
  const originalFactory = mock.consumer.getMockImplementation()!;
  mock.consumer.mockImplementation((map: { source: string }) =>
    map.source === "p Slow map" ? old.promise : originalFactory(map),
  );
  open();
  await screen.findByLabelText("Ritual source");
  type("p Slow map");
  await waitFor(
    () => expect(mock.consumer).toHaveBeenCalledWith({ source: "p Slow map" }),
    { timeout: 2500 },
  );
  type("p Current");
  await previewContains("Current");
  const diagnosticsBefore = mock.diagnostics.mock.calls.length;
  const stale = { originalPositionFor: vi.fn(), destroy: vi.fn() };
  await act(async () => old.resolve(stale));
  expect(stale.destroy).toHaveBeenCalledOnce();
  expect(stale.originalPositionFor).not.toHaveBeenCalled();
  expect(mock.diagnostics).toHaveBeenCalledTimes(diagnosticsBefore);
  expect(screen.getByLabelText("Preview").textContent).toContain("Current");
  expect(consoleWindow.doc!.transformed).toBe("p Current");
});

it.each(["resolve", "reject"] as const)(
  "does not repopulate a retired handle when a stalled transform later %ss",
  async (outcome) => {
    const old = deferred<ReturnType<typeof transformed>>();
    mock.transform.mockImplementation(() => old.promise);
    const mounted = open();
    await screen.findByLabelText("Ritual source");
    type("p Old pending");
    await started("p Old pending");
    const handle = consoleWindow.doc!;
    mounted.unmount();
    await act(async () =>
      outcome === "resolve"
        ? old.resolve(transformed("p Old pending"))
        : old.reject(new Error("Retired transform failed")),
    );
    expect(Object.keys(handle)).toEqual([]);
    expect(consoleWindow.doc).toBeUndefined();
    expect(mock.consumer).not.toHaveBeenCalled();
  },
);

it("destroys a consumer that is created after its editor unmounts", async () => {
  const pending = deferred<{ destroy: ReturnType<typeof vi.fn> }>();
  mock.consumer.mockImplementation(() => pending.promise);
  const mounted = open();
  await screen.findByLabelText("Ritual source");
  type("p Pending consumer");
  await waitFor(() => expect(mock.consumer).toHaveBeenCalledOnce(), {
    timeout: 2500,
  });
  const handle = consoleWindow.doc!,
    consumer = { destroy: vi.fn() };
  mounted.unmount();
  await act(async () => pending.resolve(consumer));
  expect(consumer.destroy).toHaveBeenCalledOnce();
  expect(Object.keys(handle)).toEqual([]);
  expect(consoleWindow.doc).toBeUndefined();
  expect(mock.diagnostics).not.toHaveBeenCalled();
});

it("destroys completed consumers after both successful compilation and parser failure", async () => {
  open();
  await screen.findByLabelText("Ritual source");
  type("p Valid");
  await previewContains("Valid");
  expect(mock.consumers).toHaveLength(1);
  expect(mock.consumers[0].destroy).toHaveBeenCalledOnce();
  type("p(");
  await waitFor(() => expect(mock.consumers).toHaveLength(2), {
    timeout: 2500,
  });
  expect(mock.consumers[1].destroy).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Preview").textContent).toContain("Valid");
});

it("reports a current transform rejection without an unhandled async callback", async () => {
  mock.transform.mockRejectedValue(new Error("Synthetic transform failure"));
  open();
  await screen.findByLabelText("Ritual source");
  type("p Current error");
  await screen.findByText("Synthetic transform failure");
  expect(mock.consumer).not.toHaveBeenCalled();
  expect(consoleWindow.doc!.value).toBe("p Current error");
});

it("reports a current source-map initialization rejection without overwriting the valid preview", async () => {
  open();
  await screen.findByLabelText("Ritual source");
  type("p Valid preview");
  await previewContains("Valid preview");
  mock.consumer.mockRejectedValueOnce(
    new Error("Synthetic map initialization failure"),
  );
  type("p Current source");
  await screen.findByText("Synthetic map initialization failure");
  expect(screen.getByLabelText("Preview").textContent).toContain(
    "Valid preview",
  );
  expect(consoleWindow.doc!.value).toBe("p Current source");
  expect(mock.consumers[0].destroy).toHaveBeenCalledOnce();
});

it("retires an older compile immediately when typing starts, before the new debounce runs", async () => {
  const old = deferred<ReturnType<typeof transformed>>();
  mock.transform.mockImplementation((source: string) =>
    source === "p Slow old"
      ? old.promise
      : Promise.resolve(transformed(source)),
  );
  open();
  await screen.findByLabelText("Ritual source");
  type("p Valid preview");
  await previewContains("Valid preview");
  type("p Slow old");
  await started("p Slow old");
  type("p New typing");
  await act(async () => old.resolve(transformed("p Slow old")));
  expect(screen.getByLabelText("Preview").textContent).toContain(
    "Valid preview",
  );
  expect(consoleWindow.doc!.value).toBe("p New typing");
  expect(consoleWindow.doc!.transformed).toBe("p Valid preview");
  await previewContains("New typing");
});
