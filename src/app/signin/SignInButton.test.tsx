// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignInButton from "./SignInButton";

const mocks = vi.hoisted(() => ({
  recoveryState: "checking" as "checking" | "ready" | "failed",
  signIn: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/auth/client", () => ({
  authClient: { signIn: { social: mocks.signIn } },
}));
vi.mock("../clientProviders", () => ({
  useLegacyRecoveryGate: () => ({
    state: mocks.recoveryState,
    retry: vi.fn(),
  }),
}));

afterEach(() => {
  mocks.recoveryState = "checking";
  vi.clearAllMocks();
});

describe("SQL sign-in gate", () => {
  it("cannot invoke Better Auth until legacy recovery is verified", async () => {
    const view = render(<SignInButton callbackURL="/study" />);
    const blocked = screen.getByRole("button", {
      name: "Continue with Google",
    });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(blocked);
    expect(mocks.signIn).not.toHaveBeenCalled();

    mocks.recoveryState = "ready";
    view.rerender(<SignInButton callbackURL="/study" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() =>
      expect(mocks.signIn).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/study",
      }),
    );
  });
});
