// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { creationPublicationHandoffKey } from "@/offline/ritualPublicationHandoff";
import SqlDocAdmin from "./SqlDocAdmin";

const ids = vi.hoisted(() => ({
  actor: "01995000-0000-7000-8000-000000000001",
  otherActor: "01995000-0000-7000-8000-000000000005",
  epoch: "01995000-0000-7000-8000-000000000006",
  otherEpoch: "01995000-0000-7000-8000-000000000007",
  temple: "01995000-0000-7000-8000-000000000002",
  ritual: "01995000-0000-7000-8000-000000000003",
  revision: "01995000-0000-7000-8000-000000000004",
}));
const mock = vi.hoisted(() => ({
  options: vi.fn(),
  write: vi.fn(),
  push: vi.fn(),
  start: vi.fn(),
  stateListener: null as null | ((state: typeof runtimeState) => void),
}));

let runtimeState = {
  phase: "ready" as "ready" | "locked",
  generation: 1,
  account: { ownerId: ids.actor, epoch: ids.epoch } as {
    ownerId: string;
    epoch: string;
  } | null,
  cleanupPending: false,
  recovery: { pending: 0, saving: 0, failed: 0 },
};
const runtime = {
  start: (...args: unknown[]) => mock.start(...args),
  coordinator: {
    get state() {
      return runtimeState;
    },
  },
  subscribeState(listener: (state: typeof runtimeState) => void) {
    mock.stateListener = listener;
    listener(runtimeState);
    return () => {
      if (mock.stateListener === listener) mock.stateListener = null;
    };
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mock.push }),
}));
vi.mock("@/doc/sqlEditorClient", () => ({
  fetchSqlRitualCreationOptions: (...args: unknown[]) => mock.options(...args),
  sendSqlRitualWrite: (...args: unknown[]) => mock.write(...args),
}));
vi.mock("@/offline/browserRuntime", () => ({
  getBrowserOfflineRuntime: () => runtime,
}));

const options = {
  version: 1,
  ownerId: ids.actor,
  public: false,
  groups: [],
  temples: [{ id: ids.temple, name: "Synthetic temple" }],
};
const success = {
  ok: true,
  replayed: false,
  ritualId: ids.ritual,
  revisionId: ids.revision,
  version: 1,
  updatedAt: "2026-09-13T12:00:00.000Z",
};
const key = `magickli:ritual-create:v2:${ids.actor}`;

beforeEach(() => {
  localStorage.clear();
  runtimeState = {
    phase: "ready",
    generation: 1,
    account: { ownerId: ids.actor, epoch: ids.epoch },
    cleanupPending: false,
    recovery: { pending: 0, saving: 0, failed: 0 },
  };
  mock.stateListener = null;
  mock.start.mockReset().mockResolvedValue(undefined);
  mock.options.mockReset().mockResolvedValue(options);
  mock.write.mockReset().mockResolvedValue(success);
  mock.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function fill() {
  render(<SqlDocAdmin />);
  fireEvent.change(await screen.findByLabelText("Title"), {
    target: { value: "New ritual" },
  });
  fireEvent.change(screen.getByLabelText("Ritual source"), {
    target: { value: "p Exact source" },
  });
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Visibility" }));
  fireEvent.click(
    await screen.findByRole("option", { name: "Synthetic temple" }),
  );
}

function emitState(next: typeof runtimeState) {
  runtimeState = next;
  mock.stateListener?.(next);
}

it("retains an exact SQL-v2 create before sending and navigates only after acknowledgement", async () => {
  let resolve!: (value: unknown) => void;
  mock.write.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await fill();
  fireEvent.change(screen.getByLabelText("Min Grade"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const request = mock.write.mock.calls[0][0];
  expect(request).toMatchObject({
    version: 2,
    kind: "create",
    expectedActorId: ids.actor,
    scope: { kind: "temple", templeId: ids.temple, minGrade: 2 },
    title: "New ritual",
    source: "p Exact source",
  });
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(request);
  expect(mock.push).not.toHaveBeenCalled();
  await act(async () => resolve(success));
  expect(mock.push).toHaveBeenCalledWith(`/doc/${ids.ritual}/edit`);
  expect(localStorage.getItem(key)).toBeNull();
  expect(
    JSON.parse(
      localStorage.getItem(
        creationPublicationHandoffKey(ids.actor, ids.ritual),
      ) ?? "null",
    ),
  ).toMatchObject({
    write: request,
    result: success,
    publication: {
      operationId: request.operationId,
      ritualId: ids.ritual,
      expectedRevisionId: ids.revision,
      expectedVersion: 1,
    },
  });
});

it("retries an uncertain create with the same retained operation after remount", async () => {
  mock.write.mockResolvedValueOnce(null).mockResolvedValueOnce(success);
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText(/save result could not be confirmed/i);
  const request = mock.write.mock.calls[0][0];
  cleanup();
  render(<SqlDocAdmin />);
  await screen.findByRole("button", { name: "Retry creation" });
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "New ritual",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry creation" }));
  await waitFor(() => expect(mock.push).toHaveBeenCalledOnce());
  expect(mock.write.mock.calls[1][0]).toEqual(request);
});

it("does not write when browser storage cannot retain the immutable request", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(
    await screen.findByText(/exact creation request could not be retained/i),
  ).toBeDefined();
  expect(mock.write).not.toHaveBeenCalled();
});

it("keeps the exact create request when the acknowledged publication handoff cannot be retained", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (keyName, value) {
      if (keyName.startsWith("magickli:ritual-publication:"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return setItem.call(this, keyName, value);
    },
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(
    await screen.findByText(/publication could not be retained/i),
  ).toBeDefined();
  expect(mock.push).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual(
    mock.write.mock.calls[0][0],
  );
});

it("shows only scope choices returned by the fresh SQL options endpoint", async () => {
  render(<SqlDocAdmin />);
  await screen.findByLabelText("Title");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Visibility" }));
  expect(screen.queryByRole("option", { name: "Public" })).toBeNull();
  expect(
    await screen.findByRole("option", { name: "Synthetic temple" }),
  ).toBeDefined();
});

it("does not overwrite malformed retained creation evidence", async () => {
  localStorage.setItem(key, '{"version":2,"private":"evidence"}');
  render(<SqlDocAdmin />);
  expect(
    await screen.findByText(/retained creation request is unavailable/i),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Download retained request" }),
  ).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Create" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(localStorage.getItem(key)).toBe('{"version":2,"private":"evidence"}');
  expect(mock.write).not.toHaveBeenCalled();
});

it("hides creation options and source immediately when the account lifecycle locks", async () => {
  await fill();
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Exact source");
  act(() =>
    emitState({
      ...runtimeState,
      phase: "locked",
      generation: 2,
    }),
  );
  expect(screen.queryByLabelText("Ritual source")).toBeNull();
  expect(screen.queryByText("Synthetic temple")).toBeNull();
});

it("restores an unsubmitted form after fresh authorization for the same owner", async () => {
  await fill();
  fireEvent.change(screen.getByLabelText("Min Grade"), {
    target: { value: "3" },
  });
  act(() =>
    emitState({
      ...runtimeState,
      phase: "locked",
      generation: 2,
    }),
  );
  expect(screen.queryByLabelText("Ritual source")).toBeNull();

  act(() =>
    emitState({
      ...runtimeState,
      phase: "ready",
      generation: 3,
      account: { ownerId: ids.actor, epoch: ids.otherEpoch },
    }),
  );

  expect(
    ((await screen.findByLabelText("Title")) as HTMLInputElement).value,
  ).toBe("New ritual");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("p Exact source");
  expect((screen.getByLabelText("Min Grade") as HTMLInputElement).value).toBe(
    "3",
  );
  expect(screen.getByRole("combobox", { name: "Visibility" }).textContent).toBe(
    "Synthetic temple",
  );
});

it("does not reveal an unsubmitted form to a different owner", async () => {
  mock.options.mockResolvedValueOnce(options).mockResolvedValueOnce({
    ...options,
    ownerId: ids.otherActor,
    public: true,
    temples: [],
  });
  await fill();
  act(() =>
    emitState({
      ...runtimeState,
      phase: "locked",
      generation: 2,
    }),
  );
  act(() =>
    emitState({
      ...runtimeState,
      phase: "ready",
      generation: 3,
      account: { ownerId: ids.otherActor, epoch: ids.otherEpoch },
    }),
  );

  expect(
    ((await screen.findByLabelText("Title")) as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("");
  expect(screen.queryByDisplayValue("New ritual")).toBeNull();
  expect(screen.queryByDisplayValue("p Exact source")).toBeNull();
});

it("discards an unsubmitted form when its selected scope is revoked", async () => {
  mock.options
    .mockResolvedValueOnce(options)
    .mockResolvedValueOnce({ ...options, public: true, temples: [] });
  await fill();
  act(() =>
    emitState({
      ...runtimeState,
      phase: "locked",
      generation: 2,
    }),
  );
  act(() =>
    emitState({
      ...runtimeState,
      phase: "ready",
      generation: 3,
      account: { ownerId: ids.actor, epoch: ids.otherEpoch },
    }),
  );

  expect(
    ((await screen.findByLabelText("Title")) as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Ritual source") as HTMLTextAreaElement).value,
  ).toBe("");
  expect(screen.queryByLabelText("Min Grade")).toBeNull();
});

it("does not reveal a delayed options response after the lifecycle locks", async () => {
  let resolve!: (value: unknown) => void;
  mock.options.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<SqlDocAdmin />);
  await waitFor(() => expect(mock.options).toHaveBeenCalledOnce());
  act(() =>
    emitState({
      ...runtimeState,
      phase: "locked",
      generation: 2,
    }),
  );
  await act(async () => resolve(options));
  expect(screen.queryByLabelText("Ritual source")).toBeNull();
  expect(screen.queryByText("Synthetic temple")).toBeNull();
});

it("ignores an old create acknowledgement after an account switch", async () => {
  let resolve!: (value: unknown) => void;
  mock.write.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(mock.write).toHaveBeenCalledOnce());
  act(() =>
    emitState({
      ...runtimeState,
      generation: 2,
      account: { ownerId: ids.otherActor, epoch: ids.otherEpoch },
    }),
  );
  await act(async () => resolve(success));
  expect(mock.push).not.toHaveBeenCalled();
  expect(
    localStorage.getItem(creationPublicationHandoffKey(ids.actor, ids.ritual)),
  ).toBeNull();
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(screen.queryByLabelText("Ritual source")).toBeNull();
});
