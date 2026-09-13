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
  refresh: vi.fn(async () => false),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mock.pathname,
}));
vi.mock("@/offline/browserRuntime", () => ({
  getBrowserOfflineRuntime: () => mock.getRuntime(),
}));
vi.mock("@/offline/ritualDownload", () => ({
  refreshOfflineRitual: () => mock.refresh(),
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

function privateRuntime() {
  let view:
    | {
        available(): void;
        hide(
          reason: "change",
          options: { retainUncapturedDraft: boolean },
        ): void;
      }
    | undefined;
  const operation = { signal: new AbortController().signal };
  const runtime = {
    start: vi.fn(async () => {}),
    refreshVerifiedAccount: vi.fn(async () => false),
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
      state: {
        phase: "ready",
        generation: 1,
        account: { ownerId: OWNER, epoch: EPOCH },
      },
      register: vi.fn((candidate) => {
        view = candidate;
        return {
          begin: () => operation,
          beginPermissionCheck: () => null,
          dispose: vi.fn(),
        };
      }),
      commit: vi.fn((_operation, apply) => apply()),
      finish: vi.fn(),
      objectURL: vi.fn(),
    },
  };
  return {
    runtime,
    get view() {
      return view;
    },
  };
}

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
