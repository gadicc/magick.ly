// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRitualFileLocator } from "@/files/ritualFileLocator";
import { createUuidV7 } from "@/lib/ids";
import Upload, { uploadRitualImage } from "@/lib/upload";

const actorId = createUuidV7();
const ritualId = createUuidV7();
const operationId = createUuidV7();
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = createHash("sha256").update(bytes).digest("hex");

function image() {
  const file = new File([bytes], "synthetic.png", {
    type: "image/png",
    lastModified: 123,
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

function receipt() {
  return {
    operationId,
    actorId,
    ritualId,
    fileId: createUuidV7(),
    attachmentId: createUuidV7(),
    sha256,
    byteSize: bytes.byteLength,
    contentType: "image/png" as const,
    completedAtMs: Date.now(),
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("private ritual image upload", () => {
  it("initiates, uploads with the exact capability, then finalizes", async () => {
    const capability = {
      kind: "presigned-put" as const,
      url: "https://00000000000000000000000000000000.r2.cloudflarestorage.com/capability",
      headers: {
        "content-type": "image/png",
        "if-none-match": "*",
        "x-amz-checksum-sha256": "synthetic",
      },
      expiresAtMs: Date.now() + 60_000,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            state: "upload",
            replayed: false,
            upload: capability,
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, replayed: false, receipt: receipt() }),
        ),
      );

    const result = await uploadRitualImage({
      expectedActorId: actorId,
      ritualId,
      operationId,
      file: image(),
      fetcher,
    });

    expect(result).toMatchObject({ ok: true, replayed: false });
    const initiate = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(initiate).toEqual({
      version: 1,
      operationId,
      expectedActorId: actorId,
      ritualId,
      filename: "synthetic.png",
      byteSize: bytes.byteLength,
      contentType: "image/png",
      sha256,
    });
    expect(fetcher.mock.calls[1]).toEqual([
      capability.url,
      expect.objectContaining({
        method: "PUT",
        headers: capability.headers,
        credentials: "omit",
        redirect: "error",
      }),
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      version: 1,
      operationId,
      expectedActorId: actorId,
    });
  });

  it("continues to finalization after a conditional replay response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            state: "upload",
            replayed: true,
            upload: {
              kind: "presigned-put",
              url: "https://example.test/capability",
              headers: {},
              expiresAtMs: Date.now() + 60_000,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, replayed: true, receipt: receipt() }),
        ),
      );
    expect(
      await uploadRitualImage({
        expectedActorId: actorId,
        ritualId,
        operationId,
        file: image(),
        fetcher,
      }),
    ).toMatchObject({ ok: true, replayed: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a completed replay that is not bound to this actor, ritual, file and operation", async () => {
    const wrong = receipt();
    wrong.ritualId = createUuidV7();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          state: "completed",
          replayed: true,
          receipt: wrong,
        }),
      ),
    );
    expect(
      await uploadRitualImage({
        expectedActorId: actorId,
        ritualId,
        operationId,
        file: image(),
        fetcher,
      }),
    ).toEqual({ ok: false, code: "UNAVAILABLE", retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and oversized files before a network request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const unsupported = new File([bytes], "synthetic.svg", {
      type: "image/svg+xml",
    });
    const oversized = {
      ...image(),
      name: "large.png",
      type: "image/png",
      size: 20 * 1024 * 1024 + 1,
    } as File;
    expect(
      await uploadRitualImage({
        expectedActorId: actorId,
        ritualId,
        operationId,
        file: unsupported,
        fetcher,
      }),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(
      await uploadRitualImage({
        expectedActorId: actorId,
        ritualId,
        operationId,
        file: oversized,
        fetcher,
      }),
    ).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains the operation identity when the user retries an uncertain request", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ ok: false, code: "UNAVAILABLE", retryable: true }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <Upload
        expectedActorId={actorId}
        rituals={[{ id: ritualId, title: "Synthetic ritual" }]}
      />,
    );
    const input = screen.getByLabelText("Image file");
    fireEvent.change(input, { target: { files: [image()] } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("button", { name: "Retry upload" });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(first.operationId).toBe(second.operationId);
    expect(first.expectedActorId).toBe(actorId);
    expect(first.ritualId).toBe(ritualId);
  });

  it("locks both selectors and synchronously ignores a duplicate submit", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetcher = vi.fn<typeof fetch>(() => pending);
    vi.stubGlobal("fetch", fetcher);
    render(
      <Upload
        expectedActorId={actorId}
        rituals={[{ id: ritualId, title: "Synthetic ritual" }]}
      />,
    );
    const input = screen.getByLabelText("Image file") as HTMLInputElement;
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { files: [image()] } });
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(input.disabled).toBe(true);
    expect(screen.getByRole("combobox").getAttribute("aria-disabled")).toBe(
      "true",
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    resolve(
      new Response(
        JSON.stringify({ ok: false, code: "UNAVAILABLE", retryable: true }),
      ),
    );
    await screen.findByRole("button", { name: "Retry upload" });
    expect(input.disabled).toBe(false);
  });

  it("exposes the canonical private source reference after finalization", async () => {
    const completed = receipt();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      completed.operationId = JSON.parse(String(init?.body)).operationId;
      return new Response(
        JSON.stringify({
          ok: true,
          state: "completed",
          replayed: true,
          receipt: completed,
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <Upload
        expectedActorId={actorId}
        rituals={[{ id: ritualId, title: "Synthetic ritual" }]}
      />,
    );
    const input = screen.getByLabelText("Image file");
    fireEvent.change(input, { target: { files: [image()] } });
    fireEvent.submit(input.closest("form")!);
    const labelled = await screen.findByLabelText(
      "Ritual image source reference",
    );
    const source =
      labelled instanceof HTMLInputElement
        ? labelled
        : labelled.querySelector("input");
    expect(source?.value).toBe(
      formatRitualFileLocator({
        ritualId,
        attachmentId: completed.attachmentId,
        fileId: completed.fileId,
      }),
    );
    expect(
      screen
        .getByRole("button", { name: "Copy source reference" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
