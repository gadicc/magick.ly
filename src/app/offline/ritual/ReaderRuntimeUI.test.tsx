// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PrivateRitualReader from "../../doc/[_id]/PrivateRitualReader";
import OfflineRitualCatalog from "./OfflineRitualCatalog";

const A = "019947c5-abcd-7000-8000-000000000001";
const B = "019947c5-abcd-7000-8000-000000000002";
const OWNER = "019947c5-abcd-7000-8000-000000000003";
const EPOCH = "019947c5-abcd-7000-8000-000000000004";
const mock = vi.hoisted(() => ({
  pathname: "/doc/019947c5-abcd-7000-8000-000000000001",
  getRuntime: vi.fn(),
  refresh: vi.fn(async (..._args: unknown[]) => false),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mock.pathname,
}));
vi.mock("@/offline/browserRuntime", () => ({
  getBrowserOfflineRuntime: () => mock.getRuntime(),
}));
vi.mock("@/offline/ritualDownload", () => ({
  refreshOfflineRitual: (...args: unknown[]) => mock.refresh(...args),
}));
vi.mock("@/app/doc/[_id]/DocRender", () => ({
  default: () => <output>Rendered ritual</output>,
}));

afterEach(cleanup);
beforeEach(() => {
  mock.pathname = `/doc/${A}`;
  mock.getRuntime.mockReset();
  mock.refresh.mockReset().mockResolvedValue(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function privateRuntime(initialPhase: "checking" | "ready" = "ready") {
  let view:
    | {
        available(): void;
        hide(
          reason: "account" | "change",
          options: { retainUncapturedDraft: boolean },
        ): void;
      }
    | undefined;
  const operation = { signal: new AbortController().signal };
  const dispose = vi.fn();
  type State = {
    phase: "checking" | "ready";
    generation: number;
    account: { ownerId: string; epoch: string };
  };
  let state: State = {
    phase: initialPhase,
    generation: 1,
    account: { ownerId: OWNER, epoch: EPOCH },
  };
  const listeners = new Set<(state: State) => void>();
  const runtime = {
    start: vi.fn(async () => {}),
    refreshVerifiedAccount: vi.fn(async () => false),
    subscribeState: vi.fn((listener: (state: State) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }),
    repository: {
      readBundle: vi.fn(async (_account, ritualId) =>
        ritualId === A
          ? {
              title: "Ritual A",
              renderedJson: '{"type":"root","children":[]}',
              assets: [],
              occurrences: [],
            }
          : null,
      ),
      readAsset: vi.fn(),
      resolveDownloadedRitualAlias: vi.fn(),
    },
    coordinator: {
      get state() {
        return state;
      },
      register: vi.fn((candidate) => {
        view = candidate;
        return {
          begin: () => operation,
          beginPermissionCheck: () => null,
          dispose,
        };
      }),
      commit: vi.fn((_operation, apply) => apply()),
      finish: vi.fn(),
      objectURL: vi.fn(),
    },
  };
  return {
    runtime,
    dispose,
    emitPhase(phase: State["phase"]) {
      state = { ...state, phase };
      for (const listener of listeners) listener(state);
    },
    get view() {
      return view;
    },
  };
}

it("runs one initial online permission check when an in-flight account activation becomes ready", async () => {
  const fixture = privateRuntime("checking");
  mock.getRuntime.mockReturnValue(fixture.runtime);
  mock.refresh.mockImplementation(async () => {
    fixture.view?.hide("change", { retainUncapturedDraft: false });
    return true;
  });
  render(<PrivateRitualReader resolvedRitualId={A} />);
  await waitFor(() => expect(fixture.view).toBeDefined());
  expect(mock.refresh).not.toHaveBeenCalled();

  await act(async () => fixture.emitPhase("ready"));
  expect(await screen.findByText(/unavailable on this device/i)).toBeTruthy();
  expect(mock.refresh).toHaveBeenCalledOnce();

  await act(async () => fixture.emitPhase("ready"));
  expect(mock.refresh).toHaveBeenCalledOnce();
});

it("retries when registration refresh interrupts the check before permission acceptance", async () => {
  const fixture = privateRuntime();
  mock.getRuntime.mockReturnValue(fixture.runtime);
  mock.refresh
    .mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[3] as { onInterrupted(): void };
      options.onInterrupted();
      return false;
    })
    .mockResolvedValueOnce(true);
  render(<PrivateRitualReader resolvedRitualId={A} />);

  await waitFor(() => expect(mock.refresh).toHaveBeenCalledTimes(2));
  await act(async () => fixture.emitPhase("ready"));
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("keeps the initial check pending while hidden and runs it after lifecycle resume", async () => {
  const fixture = privateRuntime();
  mock.getRuntime.mockReturnValue(fixture.runtime);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  try {
    render(<PrivateRitualReader resolvedRitualId={A} />);
    await waitFor(() => expect(fixture.view).toBeDefined());
    expect(mock.refresh).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => fixture.emitPhase("ready"));
    expect(mock.refresh).toHaveBeenCalledOnce();
  } finally {
    Reflect.deleteProperty(document, "visibilityState");
  }
});

it("coalesces online events during an active permission check", async () => {
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const fixture = privateRuntime();
  mock.getRuntime.mockReturnValue(fixture.runtime);
  mock.refresh
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<PrivateRitualReader resolvedRitualId={A} />);
  await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());

  act(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  expect(mock.refresh).toHaveBeenCalledOnce();
  await act(async () => first.resolve(false));
  await waitFor(() => expect(mock.refresh).toHaveBeenCalledTimes(2));

  await act(async () => second.resolve(false));
  await act(async () => fixture.emitPhase("ready"));
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("retries an active check invalidated by account activation without looping on its own change", async () => {
  const first = deferred<boolean>();
  const second = deferred<boolean>();
  const fixture = privateRuntime();
  mock.getRuntime.mockReturnValue(fixture.runtime);
  mock.refresh
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  render(<PrivateRitualReader resolvedRitualId={A} />);
  await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());

  act(() => {
    fixture.emitPhase("checking");
    fixture.view?.hide("account", { retainUncapturedDraft: false });
  });
  await act(async () => first.resolve(false));
  expect(mock.refresh).toHaveBeenCalledOnce();

  await act(async () => fixture.emitPhase("ready"));
  await waitFor(() => expect(mock.refresh).toHaveBeenCalledTimes(2));
  act(() => {
    fixture.emitPhase("checking");
    fixture.view?.hide("change", { retainUncapturedDraft: false });
    fixture.emitPhase("ready");
  });
  await act(async () => second.resolve(true));
  expect(mock.refresh).toHaveBeenCalledTimes(2);
});

it("disposes a queued initial check before a stale route can become ready", async () => {
  const fixture = privateRuntime("checking");
  mock.getRuntime.mockReturnValue(fixture.runtime);
  const rendered = render(<PrivateRitualReader resolvedRitualId={A} />);
  await waitFor(() => expect(fixture.view).toBeDefined());
  rendered.unmount();

  await act(async () => fixture.emitPhase("ready"));
  expect(mock.refresh).not.toHaveBeenCalled();
  expect(fixture.dispose).toHaveBeenCalledOnce();
});

it("hides a ready ritual synchronously when the route changes", async () => {
  const fixture = privateRuntime();
  mock.getRuntime.mockReturnValue(fixture.runtime);
  const rendered = render(<PrivateRitualReader resolvedRitualId={A} />);
  await waitFor(() => expect(fixture.view).toBeDefined());
  await act(async () => fixture.view?.available());
  expect(await screen.findByText("Ritual A")).toBeTruthy();

  mock.pathname = `/doc/${B}`;
  rendered.rerender(<PrivateRitualReader resolvedRitualId={B} />);
  expect(screen.queryByText("Ritual A")).toBeNull();
  await screen.findByText(/unavailable on this device/i);
});

it("shows a safe unavailable state when reader runtime creation fails", async () => {
  mock.getRuntime.mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  render(<PrivateRitualReader resolvedRitualId={A} />);
  expect(await screen.findByText(/unavailable on this device/i)).toBeTruthy();
});

it("handles initial null account state and catalog runtime creation failure", async () => {
  mock.getRuntime.mockReturnValueOnce({
    subscribeState: (listener: (state: { account: null }) => void) => {
      listener({ account: null });
      return () => {};
    },
    start: async () => {},
    coordinator: {},
    repository: {},
  });
  const rendered = render(<OfflineRitualCatalog />);
  expect(
    await screen.findByText(/No verified offline account is active/i),
  ).toBeTruthy();

  rendered.unmount();
  mock.getRuntime.mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  render(<OfflineRitualCatalog />);
  expect(
    await screen.findByText(/Downloaded rituals are unavailable/i),
  ).toBeTruthy();
});
