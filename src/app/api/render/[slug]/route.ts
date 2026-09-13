import { componentImageResponse } from "@/render/componentImageResponse";

export async function GET(
  request: Request,
  context: RouteContext<"/api/render/[slug]">,
) {
  const { slug } = await context.params;
  return componentImageResponse(slug, request);
}
