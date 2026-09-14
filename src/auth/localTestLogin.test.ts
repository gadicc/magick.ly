import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.hoisted(() => vi.fn());
const insertValues = vi.hoisted(() => vi.fn());
const onConflictDoUpdate = vi.hoisted(() => vi.fn());
const ready = vi.hoisted(() => vi.fn(async () => true));

const tx = vi.hoisted(() => ({
  insert: vi.fn(() => ({ values: insertValues })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: selectLimit })),
    })),
  })),
}));

vi.mock("@/auth/cutoverReadiness", () => ({
  sqlAuthCutoverReady: ready,
}));
vi.mock("@/db/neonFull", () => ({
  db: { transaction: vi.fn((callback) => callback(tx)) },
}));

const {
  MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED,
  MAGICKLI_LOCAL_TEST_IDENTITIES,
  provisionMagickliLocalTestIdentity,
} = await import("./localTestLogin");

describe("Magickli local developer identities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ready.mockReset();
    ready.mockResolvedValue(true);
    selectLimit.mockReset();
    selectLimit
      .mockResolvedValueOnce([
        {
          email: MAGICKLI_LOCAL_TEST_IDENTITIES.admin.email,
          id: MAGICKLI_LOCAL_TEST_IDENTITIES.admin.id,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "019a0000-0000-7000-8000-000000000099",
          userId: MAGICKLI_LOCAL_TEST_IDENTITIES.admin.id,
        },
      ]);
    insertValues.mockReturnValue({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValue(undefined);
  });

  it("rotates only the exact preseeded admin credential", async () => {
    const identity = MAGICKLI_LOCAL_TEST_IDENTITIES.admin;
    await provisionMagickliLocalTestIdentity({
      identity,
      key: "admin",
      password: "process-local-password",
      passwordHash: "hashed-password",
    });

    expect(insertValues).toHaveBeenCalledWith({
      accountId: identity.id,
      password: "hashed-password",
      providerId: "credential",
      updatedAt: expect.any(Date),
      userId: identity.id,
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: {
          password: "hashed-password",
          updatedAt: expect.any(Date),
        },
      }),
    );
    expect(onConflictDoUpdate.mock.calls[0][0].set).not.toHaveProperty(
      "userId",
    );
  });

  it("requires cutover readiness before changing credentials", async () => {
    ready.mockResolvedValue(false);
    await expect(
      provisionMagickliLocalTestIdentity({
        identity: MAGICKLI_LOCAL_TEST_IDENTITIES.creator,
        key: "creator",
        password: "process-local-password",
        passwordHash: "hashed-password",
      }),
    ).rejects.toThrow(MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    [
      "mismatched",
      [
        {
          email: "another@local-acceptance.test",
          id: MAGICKLI_LOCAL_TEST_IDENTITIES.creator.id,
        },
      ],
    ],
  ])("refuses a %s seeded identity without writing", async (_name, rows) => {
    selectLimit.mockReset();
    selectLimit.mockResolvedValueOnce(rows);
    await expect(
      provisionMagickliLocalTestIdentity({
        identity: MAGICKLI_LOCAL_TEST_IDENTITIES.creator,
        key: "creator",
        password: "process-local-password",
        passwordHash: "hashed-password",
      }),
    ).rejects.toThrow(MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("refuses a credential owned by another user without writing", async () => {
    const identity = MAGICKLI_LOCAL_TEST_IDENTITIES.reader;
    selectLimit.mockReset();
    selectLimit
      .mockResolvedValueOnce([{ email: identity.email, id: identity.id }])
      .mockResolvedValueOnce([
        {
          id: "019a0000-0000-7000-8000-000000000099",
          userId: MAGICKLI_LOCAL_TEST_IDENTITIES.creator.id,
        },
      ]);
    await expect(
      provisionMagickliLocalTestIdentity({
        identity,
        key: "reader",
        password: "process-local-password",
        passwordHash: "hashed-password",
      }),
    ).rejects.toThrow(MAGICKLI_LOCAL_TEST_FIXTURE_SETUP_REQUIRED);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
