import { getLegacyPublicFileGet } from "@/files/legacyPublicRuntime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getLegacyPublicFileGet()(request);
}
