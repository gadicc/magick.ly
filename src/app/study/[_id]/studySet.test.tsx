/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/auth/client";
import { useStudySet } from "@/study/client";
import type { StudySet } from "@/study/sets";
import getSet from "@/study/sets";
import StudyQuiz from "./StudyQuiz";
import StudySetLoad from "./studySet";

vi.mock("@/auth/client", () => ({ useSession: vi.fn() }));
vi.mock("@/study/client", () => ({ useStudySet: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  useSetSearchParam: vi.fn(),
}));
vi.mock("@/study/sets", () => ({ default: vi.fn() }));
vi.mock("../../clientProviders", () => ({
  useLegacyRecoveryGate: () => ({ state: "ready", retry: vi.fn() }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("study card interaction", () => {
  it("shows a scope storage failure instead of a perpetual loading state", async () => {
    const syntheticSet = {
      id: "synthetic",
      data: {},
      generateCards: () => [],
    } as unknown as StudySet;
    vi.mocked(getSet).mockReturnValue(syntheticSet);
    vi.mocked(useSession).mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    });
    vi.mocked(useStudySet).mockReturnValue({
      loading: true,
      error: "IndexedDB is unavailable.",
      scope: null,
      snapshot: null,
      review: vi.fn(),
      sync: vi.fn(),
    });

    await act(async () => {
      render(<StudySetLoad _id="synthetic" />);
    });
    expect(
      await screen.findByText(
        "Study progress could not be loaded: IndexedDB is unavailable.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Loading study progress/)).toBeNull();
  });

  it("records one incorrect completed review with the original card timer", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const onReview = vi.fn().mockResolvedValue(undefined);
    const Question = ({ question }: { question: string }) => (
      <div>{question}</div>
    );
    const set = {
      id: "synthetic",
      data: {},
      question: "question",
      answer: "answer",
      answers: ["A", "B"],
      gdGrade: "0=0",
      Question,
      generateCards: vi.fn(),
    } as unknown as StudySet;
    render(
      <StudyQuiz
        set={set}
        cards={[
          {
            id: "one",
            question: "Question one",
            answer: "A",
            answers: ["A", "B"],
          },
          {
            id: "two",
            question: "Question two",
            answer: "B",
            answers: ["A", "B"],
          },
        ]}
        mode="supermemo"
        setMode={vi.fn()}
        onReview={onReview}
        syncWarning={null}
      />,
    );
    const startedAt = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByRole("button", { name: "B" }).style.background).toBe(
      "red",
    );
    vi.setSystemTime(new Date(Date.now() + 4_200));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "A" }));
    });
    expect(onReview).toHaveBeenCalledWith({
      cardId: "one",
      mode: "supermemo",
      wrongCount: 1,
      startTime: startedAt,
    });
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "A" }).style.background).toBe(
      "green",
    );
  });
});
