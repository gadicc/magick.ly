// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FileStatus, find } from "filepond";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrainingUpload from "./TrainingUpload";

// FilePond detects browser capabilities at import time. jsdom needs these
// layout/object-URL features, while FilePond, its wrapper and app stay real.
vi.hoisted(() => {
  window.URL.createObjectURL = () => "blob:synthetic-pdf";
  window.URL.revokeObjectURL = () => {};
  // jsdom has no layout; non-zero measurements allow the real control's
  // animation loop to expose its action buttons.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 40,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentElement;
    },
  });
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: { supports: () => true },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

// Keep real animation/upload clocks, including FilePond's minimum duration.
vi.setConfig({ testTimeout: 10_000 });

class UploadRequest {
  static sent: UploadRequest[] = [];
  method = "";
  url = "";
  body?: FormData;
  status = 0;
  statusText = "";
  response = "";
  readyState = 0;
  aborted = false;
  upload = {
    onprogress: undefined as
      | undefined
      | ((event: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void),
  };
  onload?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  onreadystatechange?: () => void;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  getAllResponseHeaders() {
    return "content-type: application/json";
  }
  send(body: FormData) {
    this.body = body;
    UploadRequest.sent.push(this);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body: string) {
    this.status = status;
    this.response = body;
    this.readyState = 4;
    this.statusText = status === 200 ? "OK" : "Bad Gateway";
    this.onreadystatechange?.();
    this.onload?.();
  }
}
beforeEach(() => {
  UploadRequest.sent = [];
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Unexpected network call"))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function selectPdf(name = "synthetic.pdf") {
  await waitFor(() =>
    expect(document.querySelector('input[type="file"]')).not.toBeNull(),
  );
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  expect(input).not.toBeNull();
  const file = new File(["%PDF-1.7\nSynthetic fixture"], name, {
    type: "application/pdf",
  });
  // jsdom cannot populate the OS file-picker fake path through fireEvent.
  Object.defineProperty(input, "value", {
    configurable: true,
    writable: true,
    value: "C:/fakepath/" + name,
  });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}
async function request(index = 0) {
  await waitFor(
    () => expect(UploadRequest.sent.length).toBeGreaterThan(index),
    { timeout: 4000 },
  );
  return UploadRequest.sent[index];
}
function pond() {
  return find(document.querySelector(".filepond--root") as HTMLElement);
}

async function clickEnabledButton(name: string) {
  let button: HTMLButtonElement | undefined;
  await waitFor(() => {
    button = screen
      .getAllByRole("button", { name, hidden: true })
      .find((element) => !(element as HTMLButtonElement).disabled) as
      | HTMLButtonElement
      | undefined;
    expect(button).toBeDefined();
  });
  fireEvent.click(button!);
}

describe("PDF training upload using the real FilePond controls", () => {
  it("selects a PDF, sends multipart metadata/file, shows progress and reports indexed chunks", async () => {
    render(<TrainingUpload />);
    await selectPdf();
    const upload = await request();
    expect(upload.method).toBe("POST");
    expect(upload.url).toBe("/chat/train/upload");
    expect(screen.getAllByText("synthetic.pdf").length).toBeGreaterThan(0);
    const entries = upload.body!.getAll("filepond");
    expect(entries.some((entry) => typeof entry === "string")).toBe(true);
    expect(entries.filter((entry) => entry instanceof File)).toHaveLength(1);
    expect((entries.find((entry) => entry instanceof File) as File).name).toBe(
      "synthetic.pdf",
    );
    await act(async () => upload.progress(50, 100));
    await waitFor(
      () => expect(document.body.textContent).toContain("Uploading 50%"),
      { timeout: 4000 },
    );
    await act(async () =>
      upload.respond(
        200,
        JSON.stringify({ sourceId: "synthetic-source", chunks: 7 }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Indexed 7 chunks.")).toBeTruthy(),
    );
    await waitFor(
      () =>
        expect(pond().getFile().status).toBe(FileStatus.PROCESSING_COMPLETE),
      { timeout: 4000 },
    );
    expect(pond().getFile().serverId).toBe("synthetic-source");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [
      JSON.stringify({ message: "Partial ingestion; retry the same PDF." }),
      "Partial ingestion; retry the same PDF.",
    ],
    ["upstream proxy error", "Upload failed. Please try again."],
  ])(
    "shows server failure and can retry the same selected file (%s)",
    async (body, message) => {
      render(<TrainingUpload />);
      await selectPdf();
      const first = await request();
      await act(async () => first.respond(502, body));
      await waitFor(() =>
        expect(screen.getAllByText(message).length).toBeGreaterThan(0),
      );
      await waitFor(() =>
        expect(pond().getFile().status).toBe(FileStatus.PROCESSING_ERROR),
      );
      await clickEnabledButton("Retry");
      const retry = await request(1);
      const retriedFile = retry
        .body!.getAll("filepond")
        .find((entry) => entry instanceof File) as File;
      expect(retriedFile.name).toBe("synthetic.pdf");
      expect(retry.method).toBe("POST");
      expect(retry.url).toBe("/chat/train/upload");
      await act(async () =>
        retry.respond(
          200,
          JSON.stringify({ sourceId: "retried-source", chunks: 3 }),
        ),
      );
      await waitFor(() =>
        expect(screen.getByText("Indexed 3 chunks.")).toBeTruthy(),
      );
      await waitFor(
        () =>
          expect(pond().getFile().status).toBe(FileStatus.PROCESSING_COMPLETE),
        { timeout: 4000 },
      );
      expect(pond().getFile().serverId).toBe("retried-source");
      expect(
        UploadRequest.sent.every((request) => request.method === "POST"),
      ).toBe(true);
    },
  );

  it("aborts an in-flight request and ignores progress after cancellation", async () => {
    render(<TrainingUpload />);
    await selectPdf();
    const upload = await request();
    await clickEnabledButton("Cancel");
    await waitFor(() => expect(upload.aborted).toBe(true));
    await waitFor(() =>
      expect(document.body.textContent).toContain("Upload cancelled"),
    );
    await act(async () => upload.progress(100, 100));
    expect(document.body.textContent).not.toContain("Indexed");
    expect(pond().getFile()).toBeNull();
    expect(UploadRequest.sent).toHaveLength(1);
    await selectPdf("replacement.pdf");
    const replacement = await request(1);
    const nextFile = replacement
      .body!.getAll("filepond")
      .find((entry) => entry instanceof File) as File;
    expect(nextFile.name).toBe("replacement.pdf");
    await act(async () =>
      replacement.respond(
        200,
        JSON.stringify({ sourceId: "replacement-source", chunks: 2 }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Indexed 2 chunks.")).toBeTruthy(),
    );
  });
});
