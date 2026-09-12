import { chatDependencies } from "../providers";
import { respondToChat } from "../server";

export const runtime = "edge";

/** Retain the plaintext protocol for clients cached before the AI SDK upgrade. */
export function POST(request: Request) {
  return respondToChat(request, "legacy", chatDependencies);
}
