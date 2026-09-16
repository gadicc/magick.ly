import { parseComponentImageRequest } from "@/render/componentImageRequest";

/** A shared link's validated text and rose setting, or the page defaults. */
export function sigilFromSearchParams(searchParams: URLSearchParams) {
  try {
    if (!searchParams.has("text")) throw new Error("no shared sigil");
    const params = new URLSearchParams();
    params.set("text", searchParams.get("text") ?? "");
    if (searchParams.get("rose") === "false") params.set("rose", "false");
    const { props } = parseComponentImageRequest("rose-sigil", params);
    return { text: props.text, rose: props.rose };
  } catch {
    return { text: "גדי", rose: true };
  }
}
