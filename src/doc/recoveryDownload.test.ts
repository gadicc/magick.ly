// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { downloadRitualRecovery } from "./drafts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("downloads exact recovery text locally and releases its temporary URL", async () => {
  vi.useFakeTimers();
  const objects: Blob[] = [];
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      objects.push(blob);
      return "blob:synthetic-recovery";
    },
    revokeObjectURL: revoke,
  });
  const anchors: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function () {
      anchors.push(this);
    },
  );
  const source = "\uFEFFp e\u0301 🌍\r\n";
  const circular: Record<string, unknown> = { source };
  circular.ref = circular;
  downloadRitualRecovery({ draft: circular }, "my-recovery.json");
  expect(anchors[0].download).toBe("my-recovery.json");
  expect(anchors[0].getAttribute("href")).toBe("blob:synthetic-recovery");
  expect(objects[0].type).toBe("application/json");
  const reading = new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(objects[0]);
  });
  expect(revoke).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(JSON.parse(await reading)).toEqual({ draft: { source } });
  expect(revoke).toHaveBeenCalledWith("blob:synthetic-recovery");
  downloadRitualRecovery({ source });
  expect(anchors[1].download).toBe("ritual-recovery.json");
  await vi.runOnlyPendingTimersAsync();
});
