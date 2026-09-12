// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UploadFilePage from "./page";

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = createHash("sha256").update(bytes).digest("hex");
const entry = {
  _id: "synthetic-file",
  filename: "synthetic.png",
  sha256: digest,
  size: bytes.length,
  type: "image",
  image: { format: "png", width: 1, height: 1 },
};
const request = vi.fn();
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("fetch", request);
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function submitImage() {
  render(<UploadFilePage />);
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [new File([bytes], "synthetic.png", { type: "image/png" })],
    },
  });
  // Dispatch submission directly: jsdom has no OS file picker to populate its
  // internal FileList for native required-field validation. FileReader is real.
  fireEvent.submit(input.form!);
  expect(
    (screen.getByRole("button", { name: "Upload" }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
}
async function expectComplete() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Upload" }) as HTMLInputElement)
        .disabled,
    ).toBe(false),
  );
}

describe("legacy image upload preflight and result UI", () => {
  it("hashes the selected bytes and reuses an existing file without another upload", async () => {
    request.mockResolvedValue({ json: async () => entry });
    submitImage();
    await expectComplete();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/file2?return=meta&sha256=" + digest,
    );
    expect(screen.getByText(/SHA256:/).textContent).toContain(digest);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/api/file2?sha256=" + digest,
    );
    expect(document.body.textContent).toContain("synthetic.png");
  });

  it("posts the form only after a missing-file response and displays the uploaded result", async () => {
    request.mockResolvedValueOnce({
      json: async () => ({ $error: { code: "ENOENT" } }),
    });
    request.mockResolvedValueOnce({ json: async () => entry });
    submitImage();
    await expectComplete();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(
      "/api/file2?return=meta&sha256=" + digest,
    );
    const [url, options] = request.mock.calls[1];
    expect(url).toBe("/api/file2");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("sha256")).toBe(digest);
    expect(document.body.textContent).toContain("Uploaded:");
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/api/file2?sha256=" + digest,
    );
  });

  it("shows a structured preflight error and re-enables submission without uploading", async () => {
    request.mockResolvedValue({
      json: async () => ({
        $error: { code: "EACCES", message: "Sign in required" },
      }),
    });
    submitImage();
    await expectComplete();
    expect(request).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Sign in required");
    expect(document.body.textContent).not.toContain("Uploaded:");
  });
});
