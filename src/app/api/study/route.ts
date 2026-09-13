import {
  type StudyReviewResult,
  studySnapshotToWire,
} from "@/study/reviewContract";
import { sqlStudyService } from "@/study/sqlRuntime";

export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Authorization",
};

function status(result: Extract<StudyReviewResult, { ok: false }>) {
  if (result.code === "NOT_AUTHENTICATED") return 401;
  if (result.code === "ACCOUNT_CHANGED") return 409;
  if (
    result.code === "INVALID_REQUEST" ||
    result.code === "IDEMPOTENCY_KEY_REUSED"
  )
    return 400;
  return 503;
}

/** Lists only the current verified account's SQL baselines. */
export async function GET(request: Request) {
  const setId = new URL(request.url).searchParams.get("setId") ?? undefined;
  const result = await sqlStudyService.list(setId);
  if (!result.ok)
    return Response.json(result, { status: status(result), headers });
  return Response.json(
    {
      ok: true,
      snapshots: result.snapshots.map(studySnapshotToWire),
    },
    { headers },
  );
}

/** Accepts one immutable review; identity always comes from the fresh server session. */
export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = null;
  }
  const result = await sqlStudyService.review(input);
  if (!result.ok)
    return Response.json(result, { status: status(result), headers });
  return Response.json(
    { ...result, snapshot: studySnapshotToWire(result.snapshot) },
    { headers },
  );
}
