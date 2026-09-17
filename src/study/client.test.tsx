/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyQuiz from "../app/study/[_id]/StudyQuiz";
import { fetchDueCards } from "./scheduling";
import type { StudyCard, StudySet } from "./sets";

const A = "01993000-0000-7000-8000-000000000001";
const B = "01993000-0000-7000-8000-000000000002";
const databaseHarness = vi.hoisted(() => ({
  factory: undefined as IDBFactory | undefined,
  name: "",
}));

vi.mock("./storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    StudyDatabase: class StudyTestDatabase extends actual.StudyDatabase {
      constructor(_name?: string) {
        if (!databaseHarness.factory)
          throw new Error("Study test IndexedDB is not initialized.");
        super(databaseHarness.name, {
          indexedDB: databaseHarness.factory,
          IDBKeyRange,
        });
      }
    },
  };
});

class TestBroadcastChannel {
  static readonly peers = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  constructor(readonly name: string) {
    const peers = TestBroadcastChannel.peers.get(name) ?? new Set();
    peers.add(this);
    TestBroadcastChannel.peers.set(name, peers);
  }

  postMessage(value: unknown) {
    for (const peer of TestBroadcastChannel.peers.get(this.name) ?? []) {
      if (peer !== this)
        queueMicrotask(() => peer.onmessage?.({ data: value } as MessageEvent));
    }
  }

  close() {
    TestBroadcastChannel.peers.get(this.name)?.delete(this);
  }
}

let studyClient: typeof import("./client");
let studyStorage: typeof import("./storage");

beforeEach(async () => {
  vi.resetModules();
  TestBroadcastChannel.peers.clear();
  databaseHarness.factory = new IDBFactory();
  databaseHarness.name = `study-client-${crypto.randomUUID()}`;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: databaseHarness.factory,
  });
  Object.defineProperty(globalThis, "IDBKeyRange", {
    configurable: true,
    value: IDBKeyRange,
  });
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  studyClient = await import("./client");
  studyStorage = await import("./storage");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const cards: StudyCard[] = [
  {
    id: "one",
    question: "Question one",
    answer: "A",
    answers: ["A", "B"],
  },
  {
    id: "two",
    question: "Question two",
    answer: "B",
    answers: ["A", "B"],
  },
];
const set = {
  id: "synthetic",
  data: { one: {}, two: {} },
  question: "question",
  answer: "answer",
  answers: ["A", "B"],
  gdGrade: "0=0",
  Question: ({ question }: { question: string }) => <div>{question}</div>,
  generateCards: () => cards,
} as unknown as StudySet;

describe("study client identity and continuity", () => {
  it("keeps a first cached account pending until fresh activation", async () => {
    vi.stubGlobal("fetch", vi.fn());

    function ScopeHarness() {
      const runtime = studyClient.useStudyList(A);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    render(<ScopeHarness />);
    await screen.findByText("hidden");
    expect(fetch).not.toHaveBeenCalled();
    const before = new studyStorage.StudyDatabase("magickli-study");
    expect(await before.device.get("active")).toBeUndefined();
    before.close();

    await act(async () => studyClient.activateStudyAccount(A));
    await screen.findByText(`account:${A}`);
    const after = new studyStorage.StudyDatabase("magickli-study");
    expect(await after.device.get("active")).toMatchObject({
      explicitlySignedOut: false,
      lastAccountId: A,
    });
    after.close();
  });

  it("shows only a matching last verified account during an offline cold start", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.stubGlobal("fetch", vi.fn());
    const seedDb = new studyStorage.StudyDatabase("magickli-study");
    const seed = new studyStorage.StudyRepository(seedDb, {
      broadcast: false,
    });
    await seed.markAccountActive(A);
    seed.close();

    function ScopeHarness({ accountId }: { accountId: string }) {
      const runtime = studyClient.useStudyList(accountId);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    const view = render(<ScopeHarness accountId={A} />);
    await screen.findByText(`account:${A}`);
    expect(fetch).not.toHaveBeenCalled();

    view.rerender(<ScopeHarness accountId={B} />);
    await screen.findByText("hidden");
    const observer = new studyStorage.StudyDatabase("magickli-study");
    expect(await observer.device.get("active")).toMatchObject({
      explicitlySignedOut: false,
      lastAccountId: A,
    });
    observer.close();
  });

  it("keeps a cached account fenced after explicit sign-out", async () => {
    await studyClient.activateStudyAccount(A);
    await studyClient.prepareStudySignOut();

    function ScopeHarness() {
      const runtime = studyClient.useStudyList(A);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    render(<ScopeHarness />);
    await screen.findByText("hidden");
    const observer = new studyStorage.StudyDatabase("magickli-study");
    expect(await observer.device.get("active")).toMatchObject({
      explicitlySignedOut: true,
      lastAccountId: A,
    });
    observer.close();
  });

  it("asks once per page whether a signed-out device is still anonymous", async () => {
    const seedDb = new studyStorage.StudyDatabase("magickli-study");
    const seed = new studyStorage.StudyRepository(seedDb, {
      broadcast: false,
    });
    await seed.markSignedOut();
    seed.close();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ user: null, admin: false }, { status: 401 }),
      ),
    );

    function ScopeHarness() {
      const runtime = studyClient.useStudyList(null);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    const first = render(<ScopeHarness />);
    await screen.findByText(/^anonymous:/);
    first.unmount();
    render(<ScopeHarness />);
    await screen.findByText(/^anonymous:/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps the live quiz mounted while a local review refreshes its snapshot", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    await studyClient.activateStudyAccount(A);

    function StudyHarness() {
      const runtime = studyClient.useStudySet(A, "synthetic", ["one", "two"]);
      if (runtime.loading || !runtime.snapshot) return <div>Loading</div>;
      return (
        <StudyQuiz
          set={set}
          cards={fetchDueCards(cards, runtime.snapshot)}
          mode="supermemo"
          setMode={vi.fn()}
          onReview={runtime.review}
          syncWarning={runtime.error}
        />
      );
    }

    render(<StudyHarness />);
    await screen.findByText("Question one");
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "A" }).style.background).toBe(
        "green",
      ),
    );
    expect(screen.queryByText("Loading")).toBeNull();
    await waitFor(() => expect(screen.getByText("Question two")).toBeTruthy());
    expect(screen.getByText("1 / 1")).toBeTruthy();
  });

  it("does not let a delayed identity lookup reopen account state after sign-out", async () => {
    let resolveSession: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSession = resolve;
          }),
      ),
    );

    function ScopeHarness() {
      const runtime = studyClient.useStudyList(null);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    render(<ScopeHarness />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => studyClient.prepareStudySignOut());
    await screen.findByText(/^anonymous:/);

    await act(async () => {
      resolveSession(Response.json({ user: { id: A } }));
      await Promise.resolve();
    });
    const observer = new studyStorage.StudyDatabase("magickli-study");
    expect(await observer.device.get("active")).toMatchObject({
      explicitlySignedOut: true,
    });
    expect(
      (await observer.device.get("active"))?.lastAccountId,
    ).toBeUndefined();
    observer.close();
  });

  it("hides an account scope and aborts its network request on cross-tab sign-out", async () => {
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          }),
      ),
    );
    await studyClient.activateStudyAccount(A);

    function ScopeHarness() {
      const runtime = studyClient.useStudyList(A);
      return <div>{runtime.scope?.key ?? "hidden"}</div>;
    }

    render(<ScopeHarness />);
    await screen.findByText(`account:${A}`);
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const otherDb = new studyStorage.StudyDatabase("magickli-study");
    const otherTab = new studyStorage.StudyRepository(otherDb);
    await act(async () => otherTab.markSignedOut());
    await waitFor(() => expect(screen.getByText("hidden")).toBeTruthy());
    expect(aborted).toBe(true);
    expect(await otherTab.lastLocalAccountId()).toBeNull();

    await act(async () => studyClient.activateStudyAccount(A));
    await screen.findByText(`account:${A}`);
    expect(await otherDb.device.get("active")).toMatchObject({
      explicitlySignedOut: false,
      lastAccountId: A,
    });
    await act(async () => studyClient.prepareStudySignOut());
    otherTab.close();
  });

  it("keeps a delayed activation behind a synchronous sign-out fence", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = studyStorage.StudyRepository.prototype.markAccountActive;
    vi.spyOn(
      studyStorage.StudyRepository.prototype,
      "markAccountActive",
    ).mockImplementation(async function (accountId) {
      await blocked;
      return original.call(this, accountId);
    });

    const activation = studyClient.activateStudyAccount(A);
    await Promise.resolve();
    const signOut = studyClient.prepareStudySignOut();
    release();
    await Promise.all([activation, signOut]);

    const observer = new studyStorage.StudyDatabase("magickli-study");
    expect(await observer.device.get("active")).toMatchObject({
      explicitlySignedOut: true,
      lastAccountId: A,
    });
    observer.close();
  });
});
