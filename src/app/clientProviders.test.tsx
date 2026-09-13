// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientProviders from "./clientProviders";

const mocks = vi.hoisted(() => ({
  fence: vi.fn(),
  refresh: vi.fn(async () => true),
  serwist: vi.fn(() => vi.fn()),
}));

vi.mock("@/db", () => ({ fenceLegacyNetworkForSql: mocks.fence }));
vi.mock("@/auth/browserLifecycle", () => ({
  sqlBrowserLifecycle: { refreshVerifiedAccount: mocks.refresh },
}));
vi.mock("@/auth/client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));
vi.mock("@/serwistStuff", () => ({ default: mocks.serwist }));
vi.mock("@/asyncConfirm", () => ({ ConfirmDialog: () => null }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("global legacy recovery gate", () => {
  it("keeps public content visible, blocks identity, and retries failed storage", async () => {
    mocks.fence
      .mockImplementationOnce(() => {
        throw new Error("Browser storage unavailable");
      })
      .mockResolvedValueOnce({ quarantinedRows: 0 });
    render(
      <ClientProviders>
        <main>Public ritual content</main>
      </ClientProviders>,
    );

    expect(screen.getByText("Public ritual content")).toBeTruthy();
    await screen.findByText(/Old browser storage could not be verified/);
    expect(mocks.refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry recovery" }));
    await waitFor(() => expect(mocks.fence).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByText(/Old browser storage could not be verified/),
      ).toBeNull(),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("Public ritual content")).toBeTruthy();
  });
});
