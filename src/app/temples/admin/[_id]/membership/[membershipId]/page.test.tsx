// @vitest-environment jsdom

import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  back: vi.fn(),
  membership: {} as Record<string, unknown>,
}));
vi.mock("gongo-client-react", () => {
  const database = {
    collection: (name: string) => ({
      find: () =>
        name === "templeMemberships"
          ? mocks.membership
          : name === "temples"
            ? { _id: "temple", name: "Synthetic" }
            : { _id: "user", displayName: "Test member" },
      update: mocks.update,
    }),
  };
  return {
    db: database,
    useGongoOne: (lookup: (db: typeof database) => unknown) => lookup(database),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: mocks.back }) }));

beforeEach(() => {
  mocks.update.mockClear();
  mocks.back.mockClear();
  mocks.membership = {
    _id: "membership",
    userId: "user",
    templeId: "temple",
    grade: 0,
    admin: false,
    motto: "Synthetic motto",
    addedAt: new Date("2020-01-01T00:00:00Z"),
    memberSince: new Date(2023, 5, 15),
  };
});
// Simulate browser media features; the actual picker and date adapter stay real.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserver);
vi.stubGlobal(
  "fetch",
  vi.fn(() => {
    throw new Error("No network calls allowed in UI fixture");
  }),
);
afterEach(cleanup);
async function submit(name = "Save") {
  const button = screen.getByRole("button", {
    name,
  }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
async function mount() {
  const params = Promise.resolve({ _id: "temple", membershipId: "membership" });
  await act(async () => {
    render(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <React.Suspense fallback="Loading">
          <Page params={params} />
        </React.Suspense>
      </LocalizationProvider>,
    );
  });
  await screen.findByText("Edit Membership");
}

describe("membership editor date validation", () => {
  it("renders existing Date and keeps Save disabled until dirty", async () => {
    await mount();
    expect(screen.getByRole("spinbutton", { name: "Month" }).textContent).toBe(
      "06",
    );
    expect(screen.getByRole("spinbutton", { name: "Day" }).textContent).toBe(
      "15",
    );
    expect(screen.getByRole("spinbutton", { name: "Year" }).textContent).toBe(
      "2023",
    );
    expect(screen.getByLabelText("Motto")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Save",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("Save preserves existing Date after a motto-only edit", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Motto"), {
      target: { value: "Updated motto" },
    });
    await submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const [id, { $set }] = mocks.update.mock.calls[0];
    expect(id).toBe("membership");
    expect($set).toEqual({
      motto: "Updated motto",
      grade: 0,
      admin: false,
      memberSince: new Date(2023, 5, 15),
    });
    expect($set.memberSince).toBeInstanceOf(Date);
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("calendar day selection saves a Date with Save & Back", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Choose date/ }));
    const day = await screen.findByRole("gridcell", {
      name: "20",
    });
    fireEvent.click(day);
    await submit("Save & Back");
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toEqual(
      new Date(2023, 5, 20),
    );
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toBeInstanceOf(Date);
    expect(mocks.back).toHaveBeenCalledOnce();
  });

  it("typing date sections saves the typed Date", async () => {
    await mount();
    for (const [name, value] of [
      ["Month", "09"],
      ["Day", "22"],
      ["Year", "2024"],
    ]) {
      const section = screen.getByRole("spinbutton", { name });
      act(() => {
        section.focus();
      });
      await act(async () => {
        fireEvent.input(section, {
          inputType: "insertText",
          data: value,
          target: { textContent: value },
        });
      });
    }
    act(() => {
      screen.getByLabelText("Motto").focus();
    });
    await submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toEqual(
      new Date(2024, 8, 22),
    );
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toBeInstanceOf(Date);
  });

  it("clear button permits the optional date to be saved as null", async () => {
    await mount();
    fireEvent.click(screen.getByTitle("Clear"));
    expect(screen.getByRole("spinbutton", { name: "Month" }).textContent).toBe(
      "MM",
    );
    await submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toBeNull();
  });

  it("does not save a partially cleared date", async () => {
    await mount();
    const section = screen.getByRole("spinbutton", {
      name: "Day",
    });
    act(() => {
      section.focus();
    });
    fireEvent.keyDown(section, { key: "Delete" });
    expect(section.textContent).toBe("DD");
    await submit();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.getByText("Enter a complete date or clear the field."),
    ).toBeTruthy();
  });

  it("rejects a negative grade through the actual form/schema", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Grade", { exact: false }), {
      target: { value: "-1" },
    });
    await submit();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects a fully typed impossible calendar date", async () => {
    mocks.membership.memberSince = new Date(2023, 0, 15);
    await mount();
    for (const [name, value] of [
      ["Day", "31"],
      ["Month", "02"],
    ]) {
      const section = screen.getByRole("spinbutton", { name });
      act(() => {
        section.focus();
      });
      await act(async () => {
        fireEvent.input(section, {
          inputType: "insertText",
          data: value,
          target: { textContent: value },
        });
      });
    }
    fireEvent.change(screen.getByLabelText("Motto"), {
      target: { value: "Edited while date invalid" },
    });
    await submit();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid date.")).toBeTruthy();
  });

  it("can fully clear after a partial-date error and save null", async () => {
    await mount();
    const day = screen.getByRole("spinbutton", { name: "Day" });
    act(() => {
      day.focus();
    });
    await act(async () => {
      fireEvent.keyDown(day, { key: "Delete" });
    });
    await submit();
    await screen.findByText("Enter a complete date or clear the field.");
    fireEvent.click(screen.getByTitle("Clear"));
    await submit("Save & Back");
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toBeNull();
    expect(mocks.back).toHaveBeenCalledOnce();
    expect(
      screen.queryByText("Enter a complete date or clear the field."),
    ).toBeNull();
  });

  it("can correct a partial date and then save the complete Date", async () => {
    await mount();
    const day = screen.getByRole("spinbutton", { name: "Day" });
    act(() => {
      day.focus();
    });
    await act(async () => {
      fireEvent.keyDown(day, { key: "Delete" });
    });
    await submit();
    await screen.findByText("Enter a complete date or clear the field.");
    act(() => {
      day.focus();
    });
    await act(async () => {
      fireEvent.input(day, {
        inputType: "insertText",
        data: "22",
        target: { textContent: "22" },
      });
    });
    await submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toEqual(
      new Date(2023, 5, 22),
    );
    expect(
      screen.queryByText("Enter a complete date or clear the field."),
    ).toBeNull();
  });

  it("shows and enforces the picker's minimum-date validation", async () => {
    await mount();
    const year = screen.getByRole("spinbutton", { name: "Year" });
    act(() => {
      year.focus();
    });
    await act(async () => {
      fireEvent.input(year, {
        inputType: "insertText",
        data: "1800",
        target: { textContent: "1800" },
      });
    });
    await screen.findByText("Enter a valid date.");
    await submit();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves admin checkbox changes with the existing Date", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Admin" }));
    await submit();
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1].$set.admin).toBe(true);
    expect(mocks.update.mock.calls[0][1].$set.memberSince).toEqual(
      new Date(2023, 5, 15),
    );
  });
});
