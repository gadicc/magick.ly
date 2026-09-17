// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let authClientModule: typeof import("./client");
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(null));
  vi.stubGlobal("fetch", fetchMock);
  authClientModule = await import("./client");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps an anonymous session settled while Better Auth refetches it", async () => {
  const { authClient, useSession } = authClientModule;
  const rendered: string[] = [];
  function SessionHarness() {
    const session = useSession();
    const state = session.isPending
      ? "pending"
      : session.data
        ? "signed-in"
        : "anonymous";
    rendered.push(state);
    return <div>{state}</div>;
  }

  render(<SessionHarness />);
  await screen.findByText("anonymous");
  expect(rendered[0]).toBe("pending");
  const settledRenders = rendered.length;

  let finishRefetch!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefetch = resolve;
      }),
  );
  // The same refetch path runs on focus, reconnect and cross-tab changes.
  act(() => authClient.$store.notify("$sessionSignal"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(authClient.$store.atoms.session.get()).toMatchObject({
    data: null,
    isPending: true,
  });
  expect(screen.getByText("anonymous")).toBeTruthy();

  await act(async () => finishRefetch(Response.json(null)));
  await waitFor(() =>
    expect(authClient.$store.atoms.session.get().isPending).toBe(false),
  );
  expect(rendered.slice(settledRenders)).not.toContain("pending");
  expect(screen.getByText("anonymous")).toBeTruthy();
});
