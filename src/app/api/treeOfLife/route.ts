import { componentImageResponse } from "@/render/componentImageResponse";

/** Keep saved ritual URLs valid through the shared component-image registry. */
export function GET(request: Request) {
  return componentImageResponse("tree-of-life", request);
}
