import { beforeEach, describe, expect, it, vi } from "vitest";
import { IngestionError } from "../ingestPdf";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ access: vi.fn(), ingestPdf: vi.fn() }));
vi.mock("../access", () => ({ trainingAccess: mocks.access }));
vi.mock("../ingestPdf", () => ({
  ingestPdf: mocks.ingestPdf,
  IngestionError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

function request(entries: (File | string)[]) {
  const form = new FormData();
  for (const entry of entries) form.append("filepond", entry);
  return new Request("https://example.test/chat/train/upload", {
    method: "POST",
    body: form,
  });
}

const pdf = () =>
  new File(["%PDF-1.7"], "ritual.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(200);
  mocks.ingestPdf.mockResolvedValue({ sourceId: "source", chunks: 3 });
});

describe("training upload route", () => {
  it("rejects a cross-origin upload before checking credentials", async () => {
    const req = request([pdf()]);
    req.headers.set("origin", "https://another-site.test");
    expect((await POST(req)).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.ingestPdf).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "rejects unauthorized requests with %s before reading files",
    async (status) => {
      mocks.access.mockResolvedValue(status);
      const req = request([pdf()]);
      const read = vi.spyOn(req, "formData");
      expect((await POST(req)).status).toBe(status);
      expect(read).not.toHaveBeenCalled();
      expect(mocks.ingestPdf).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "finds the actual file with optional FilePond metadata: %s",
    async (metadata) => {
      const response = await POST(request(metadata ? ["{}", pdf()] : [pdf()]));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        sourceId: "source",
        chunks: 3,
      });
      expect(mocks.ingestPdf).toHaveBeenCalledOnce();
      expect(mocks.ingestPdf.mock.calls[0][0].name).toBe("ritual.pdf");
    },
  );

  it.each([[], ["{}"], [pdf(), pdf()]])(
    "rejects missing or multiple files",
    async (...entries) => {
      expect((await POST(request(entries))).status).toBe(400);
      expect(mocks.ingestPdf).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed multipart data", async () => {
    const response = await POST(
      new Request("https://example.test/chat/train/upload", {
        method: "POST",
        body: "invalid form",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.ingestPdf).not.toHaveBeenCalled();
  });

  it("reports possible partial ingestion as failure, with a retry explanation", async () => {
    mocks.ingestPdf.mockRejectedValue(
      new IngestionError("Partial ingestion; retry the same PDF.", 502),
    );
    const response = await POST(request([pdf()]));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message: "Partial ingestion; retry the same PDF.",
    });
  });

  it("does not disclose unexpected internal errors", async () => {
    mocks.ingestPdf.mockRejectedValue(
      new Error("private connection information"),
    );
    const response = await POST(request([pdf()]));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
  });
});
