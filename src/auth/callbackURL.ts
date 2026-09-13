/** Login returns only to an application path on this origin, never a supplied host or API route. */
export function safeAuthCallbackURL(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4096
  )
    return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded))
      return "/";
    const url = new URL(value, "https://callback.invalid");
    if (
      url.origin !== "https://callback.invalid" ||
      /^\/api(?:\/|$)/.test(decodeURIComponent(url.pathname))
    )
      return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
