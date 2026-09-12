type Row = Record<string, unknown>;
type AuthenticatedRequest = Request & { auth?: unknown };
type HttpPost = (request: Request) => Promise<Response>;

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Run only inside Auth.js's verified request callback. Gongo's legacy transport
 * otherwise falls back from null request.auth to unverified body/cookie tokens.
 * This bridge still targets Mongo: UUID sessions require the later DB cutover.
 */
export function withVerifiedGongoAuth(post: HttpPost): HttpPost {
  return (request: AuthenticatedRequest) => {
    const session = request.auth;
    // A truthy principal prevents Gongo.getSessionData's legacy token lookup.
    // No inherited keys can turn the anonymous principal into an identity.
    const principal: Row = Object.create(null);
    if (record(session) && record(session.user)) {
      const id = session.user.id;
      if (typeof id === "string" && /^[0-9a-f]{24}$/i.test(id)) {
        const userId = id.toLowerCase();
        Object.assign(principal, session, {
          // Keep the Auth.js shape for application RPCs; Gongo needs userId.
          user: { ...session.user, id: userId },
          userId,
        });
      }
    }
    request.auth = principal;
    // Leave the request body, cookies, response and ARSON transport untouched.
    return post(request);
  };
}
