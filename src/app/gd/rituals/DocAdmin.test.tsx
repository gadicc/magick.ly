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
import { persistRitualRecovery, readRitualRecovery } from "@/doc/drafts";
import DocAdmin from "./DocAdmin";

const mock = vi.hoisted(() => ({
  actor: "000000000000000000000001",
  call: vi.fn(),
  push: vi.fn(),
  global: false,
  rows: {} as Record<string, Record<string, unknown>[]>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("gongo-client-react", () => {
  const db = {
    call: mock.call,
    collection: (name: string) => ({
      find: (query: Record<string, unknown> = {}) => ({
        toArraySync: () => {
          const rows =
            name === "users"
              ? [{ _id: mock.actor, admin: mock.global }]
              : (mock.rows[name] ?? []);
          return rows.filter((row: Record<string, unknown>) =>
            Object.entries(query).every(([key, value]) =>
              typeof value === "object"
                ? row[key] !== undefined
                : row[key] === value,
            ),
          );
        },
      }),
      _update: vi.fn(),
    }),
  };
  return {
    db,
    useGongoUserId: () => mock.actor,
    useGongoSub: () => {},
    useGongoOne: (
      query: (database: typeof db) => { toArraySync(): unknown[] },
    ) => query(db).toArraySync()[0],
    useGongoLive: (
      query: (database: typeof db) => { toArraySync(): unknown[] },
    ) => query(db).toArraySync(),
  };
});
const templeId = "000000000000000000000040";
const docId = "000000000000000000000010";
const success = {
  ok: true,
  docId,
  revisionId: "000000000000000000000020",
  updatedAt: 100,
  replayed: false,
};
beforeEach(() => {
  localStorage.clear();
  mock.call.mockReset();
  mock.push.mockReset();
  mock.global = false;
  mock.rows = {
    temples: [{ _id: templeId, name: "Synthetic temple" }],
    templeMemberships: [{ userId: mock.actor, templeId, admin: true }],
    userGroups: [],
  };
  mock.call.mockResolvedValue(success);
});
afterEach(cleanup);
async function fill() {
  render(<DocAdmin />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "New ritual" },
  });
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Visibility" }));
  fireEvent.click(
    await screen.findByRole("option", { name: "Synthetic temple" }),
  );
}

it("creates with a server scope command and navigates only after acknowledgement", async () => {
  let resolve!: (value: unknown) => void;
  mock.call.mockImplementation(
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
  const request = mock.call.mock.calls[0][1];
  expect(request).toMatchObject({
    version: 1,
    kind: "create",
    expectedActorId: mock.actor,
    title: "New ritual",
    source: "",
    scope: { kind: "temple", templeId, minGrade: 2 },
  });
  expect(request).not.toHaveProperty("userId");
  expect(readRitualRecovery(localStorage, mock.actor)[0]).toMatchObject({
    request,
  });
  expect(mock.push).not.toHaveBeenCalled();
  await act(async () => resolve(success));
  expect(mock.push).toHaveBeenCalledWith(`/doc/${docId}/edit`);
  expect(readRitualRecovery(localStorage, mock.actor)[0]).toMatchObject({
    createdDocId: docId,
  });
});

it("retries an uncertain create with the same request ID across remounts", async () => {
  mock.call
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValue(success);
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByText("Disconnected");
  const request = mock.call.mock.calls[0][1];
  cleanup();
  render(<DocAdmin />);
  await screen.findByRole("button", { name: "Retry creation" });
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "New ritual",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry creation" }));
  await waitFor(() => expect(mock.push).toHaveBeenCalledOnce());
  expect(mock.call.mock.calls[1][1]).toEqual(request);
});

it.each(["ACCOUNT_CHANGED", "FORBIDDEN"])(
  "keeps a %s request immutable and does not risk duplicate creation",
  async (code) => {
    mock.call.mockResolvedValue({
      ok: false,
      code,
      message: "Switch back to the draft owner",
    });
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Switch back to the draft owner");
    expect(readRitualRecovery(localStorage, mock.actor)[0]).toMatchObject({
      request: mock.call.mock.calls[0][1],
    });
    expect(
      screen.getByRole("button", { name: "Retry creation" }),
    ).toBeDefined();
    expect(mock.push).not.toHaveBeenCalled();
  },
);

it("offers public creation only to global admins", async () => {
  render(<DocAdmin />);
  await act(async () => {});
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Visibility" }));
  expect(screen.queryByRole("option", { name: "Public" })).toBeNull();
  cleanup();
  mock.global = true;
  render(<DocAdmin />);
  await act(async () => {});
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Visibility" }));
  expect(await screen.findByRole("option", { name: "Public" })).toBeDefined();
});

it("restores an uncertain legacy creation only on explicit choice and preserves the original evidence", async () => {
  const raw = {
    _id: docId,
    userId: mock.actor,
    templeId,
    title: "Earlier creation",
    __pendingInsert: true,
    __pendingSince: 1,
  };
  persistRitualRecovery(localStorage, {
    kind: "legacy",
    id: "legacy-doc",
    ownerId: mock.actor,
    docId,
    collection: "docs",
    raw,
    updatedAt: 1,
  });
  persistRitualRecovery(localStorage, {
    kind: "legacy",
    id: "legacy-source",
    ownerId: mock.actor,
    docId,
    collection: "docRevisions",
    raw: { text: "p Retained source", docId },
    updatedAt: 2,
  });
  render(<DocAdmin />);
  const recover = await screen.findByRole("combobox", {
    name: "Recover retained ritual",
  });
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  expect(mock.call).not.toHaveBeenCalled();
  fireEvent.mouseDown(recover);
  fireEvent.click(
    await screen.findByRole("option", { name: "Earlier creation" }),
  );
  expect(
    await screen.findByText(/This earlier creation may already exist/),
  ).toBeDefined();
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "Earlier creation",
  );
  expect(
    (screen.getByLabelText("Recovered source") as HTMLInputElement).value,
  ).toBe("p Retained source");
  expect(mock.call).not.toHaveBeenCalled();
  expect(readRitualRecovery(localStorage, mock.actor)).toContainEqual(
    expect.objectContaining({ id: "legacy-doc", raw }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(mock.call).toHaveBeenCalledOnce());
  expect(mock.call.mock.calls[0][1]).toMatchObject({
    kind: "create",
    title: "Earlier creation",
    source: "p Retained source",
    scope: { kind: "temple", templeId, minGrade: 0 },
  });
});
