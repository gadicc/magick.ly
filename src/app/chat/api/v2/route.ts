import { chatDependencies } from "../../providers";
import { respondToChat } from "../../server";

export const runtime = "nodejs";

export function POST(request: Request) {
  return respondToChat(request, "v2", chatDependencies);
}
