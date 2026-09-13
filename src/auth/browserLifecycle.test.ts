import { describe, expect, it, vi } from "vitest";
import { createUuidV7 } from "../lib/ids";
import {
  createSqlBrowserLifecycle,
  type SqlBrowserLifecycleDependencies,
} from "./browserLifecycle";

vi.mock("./client", () => ({ authClient: {} }));
vi.mock("../offline/browserRuntime", () => ({
  getBrowserOfflineRuntime: vi.fn(),
}));
vi.mock("../study/client", () => ({
  activateStudyAccount: vi.fn(),
  prepareStudySignOut: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<SqlBrowserLifecycleDependencies> = {}) {
  const dependencies: SqlBrowserLifecycleDependencies = {
    refreshPrivateAccount: vi.fn(async () => null),
    activateStudy: vi.fn(async () => {}),
    prepareStudySignOut: vi.fn(async () => {}),
    preparePrivateSignOut: vi.fn(async () => true),
    signOutAuth: vi.fn(async () => true),
    replace: vi.fn(),
    ...overrides,
  };
  return {
    dependencies,
    lifecycle: createSqlBrowserLifecycle(dependencies),
  };
}

describe("SQL browser identity lifecycle", () => {
  it("fences both local runtimes synchronously and ignores a delayed activation", async () => {
    const owner = createUuidV7();
    const refresh = deferred<string | null>();
    const studyCleanup = deferred<void>();
    const privateCleanup = deferred<boolean>();
    const f = fixture({
      refreshPrivateAccount: vi.fn(() => refresh.promise),
      prepareStudySignOut: vi.fn(() => studyCleanup.promise),
      preparePrivateSignOut: vi.fn(() => privateCleanup.promise),
    });

    const activating = f.lifecycle.refreshVerifiedAccount();
    const signingOut = f.lifecycle.signOut();
    expect(f.dependencies.prepareStudySignOut).toHaveBeenCalledOnce();
    expect(f.dependencies.preparePrivateSignOut).toHaveBeenCalledOnce();
    expect(f.dependencies.signOutAuth).not.toHaveBeenCalled();

    refresh.resolve(owner);
    await expect(activating).resolves.toBe(false);
    expect(f.dependencies.activateStudy).not.toHaveBeenCalled();
    studyCleanup.resolve();
    privateCleanup.resolve(true);
    await expect(signingOut).resolves.toEqual({ ok: true });
    expect(f.dependencies.signOutAuth).toHaveBeenCalledOnce();
    expect(f.dependencies.replace).toHaveBeenCalledWith("/");
  });

  it("keeps views fenced and permits a cleanup retry before auth sign-out", async () => {
    const f = fixture({
      preparePrivateSignOut: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    });
    await expect(f.lifecycle.signOut()).resolves.toEqual({
      ok: false,
      code: "LOCAL_CLEANUP_FAILED",
    });
    expect(f.dependencies.signOutAuth).not.toHaveBeenCalled();
    await expect(f.lifecycle.refreshVerifiedAccount()).resolves.toBe(false);

    await expect(f.lifecycle.signOut()).resolves.toEqual({ ok: true });
    expect(f.dependencies.signOutAuth).toHaveBeenCalledOnce();
    expect(f.dependencies.replace).toHaveBeenCalledOnce();
  });

  it("still fences private state when study cleanup throws synchronously", async () => {
    const privateCleanup = vi.fn(async () => true);
    const f = fixture({
      prepareStudySignOut: vi.fn(() => {
        throw new Error("Study storage construction failed");
      }),
      preparePrivateSignOut: privateCleanup,
    });
    await expect(f.lifecycle.signOut()).resolves.toEqual({
      ok: false,
      code: "LOCAL_CLEANUP_FAILED",
    });
    expect(privateCleanup).toHaveBeenCalledOnce();
    expect(f.dependencies.signOutAuth).not.toHaveBeenCalled();
  });

  it("does not navigate or un-fence state when server sign-out fails", async () => {
    const f = fixture({ signOutAuth: vi.fn(async () => false) });
    await expect(f.lifecycle.signOut()).resolves.toEqual({
      ok: false,
      code: "AUTH_SIGNOUT_FAILED",
    });
    expect(f.dependencies.replace).not.toHaveBeenCalled();
    await expect(f.lifecycle.refreshVerifiedAccount()).resolves.toBe(false);
  });

  it("only activates the latest verified account response", async () => {
    const oldOwner = createUuidV7();
    const currentOwner = createUuidV7();
    const old = deferred<string | null>();
    const current = deferred<string | null>();
    const f = fixture({
      refreshPrivateAccount: vi
        .fn<() => Promise<string | null>>()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise),
    });
    const oldAttempt = f.lifecycle.refreshVerifiedAccount();
    const currentAttempt = f.lifecycle.refreshVerifiedAccount();
    current.resolve(currentOwner);
    await expect(currentAttempt).resolves.toBe(true);
    old.resolve(oldOwner);
    await expect(oldAttempt).resolves.toBe(false);
    expect(f.dependencies.activateStudy).toHaveBeenCalledOnce();
    expect(f.dependencies.activateStudy).toHaveBeenCalledWith(currentOwner);
  });
});
