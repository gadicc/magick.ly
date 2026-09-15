import { pathToFileURL } from "node:url";

const terminal = new Set(["succeeded", "failed", "skipped"]);
const origin = "https://magick.ly";
const validJob = (job) =>
  job &&
  typeof job.toDeploymentId === "string" &&
  job.toDeploymentId.length > 0 &&
  Number.isSafeInteger(job.requestedAt) &&
  job.requestedAt > 0 &&
  ["promote", "rollback"].includes(job.type) &&
  ["pending", "in-progress", ...terminal].includes(job.jobStatus);
const sameJob = (left, right) =>
  validJob(left) &&
  validJob(right) &&
  ["toDeploymentId", "requestedAt", "type", "jobStatus"].every(
    (key) => left[key] === right[key],
  );

/** Read-only release checks. Provider replies and credentials never reach logs. */
export function createReleaseChecks(env, options = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const wait =
    options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const required = (key) => {
    if (!env[key]) throw new Error(`Missing release setting: ${key}`);
    return env[key];
  };
  const projectId = required("VERCEL_PROJECT_ID");
  const teamId = required("VERCEL_ORG_ID");
  const api = async (path) => {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set("teamId", teamId);
    const response = await request(url.href, {
      headers: { Authorization: `Bearer ${required("VERCEL_TOKEN")}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Release provider check failed (${response.status})`);
    return response.json();
  };
  const project = async () => {
    // Vercel omits lastAliasRequest unless this expanded projection is requested.
    const value = await api(
      `/v9/projects/${encodeURIComponent(projectId)}?rollbackInfo=true`,
    );
    if (
      value.id !== projectId ||
      value.accountId !== teamId ||
      value.rollingRelease
    )
      throw new Error(
        "Unexpected project identity or unsupported rolling release configuration",
      );
    return value;
  };
  const deployment = async () => {
    const url = new URL(required("DEPLOYMENT_URL"));
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".vercel.app") ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid staged deployment URL");
    const value = await api(
      `/v13/deployments/${encodeURIComponent(url.hostname)}`,
    );
    if (
      value.projectId !== projectId ||
      value.url !== url.hostname ||
      value.target !== "production" ||
      value.readyState !== "READY" ||
      !value.id
    )
      throw new Error("Staged deployment identity or readiness mismatch");
    return { id: value.id, origin: url.origin };
  };
  const smoke = async (url, headers = {}) => {
    for (const path of ["/", "/api/auth/get-session"]) {
      const response = await request(`${url}${path}`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(
          `Application check failed (${path}, HTTP ${response.status})`,
        );
      }
      if (path === "/") await response.body?.cancel();
      else {
        // Reject login HTML and unexpectedly large responses without logging them.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Missing anonymous session response");
        let body = "";
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.length + body.length > 64)
              throw new Error("Unexpected anonymous session response");
            body += decoder.decode(value, { stream: true });
          }
          body += decoder.decode();
          if (JSON.parse(body) !== null)
            throw new Error("Unexpected anonymous session response");
        } finally {
          await reader.cancel();
        }
      }
    }
  };
  return {
    async preflight() {
      const value = await project();
      const job = value.lastAliasRequest;
      // Do not apply the CLI's three-minute age cutoff to unresolved requests.
      if (job != null && (!validJob(job) || !terminal.has(job.jobStatus)))
        throw new Error(
          "A previous alias change remains unresolved. Inspect Vercel before starting another release.",
        );
    },
    async staged() {
      const target = await deployment();
      const tokenUrl = new URL(required("ACTIONS_ID_TOKEN_REQUEST_URL"));
      if (tokenUrl.protocol !== "https:")
        throw new Error("Invalid identity-token endpoint");
      tokenUrl.searchParams.set("audience", "https://github.com/gadicc");
      const response = await request(tokenUrl.href, {
        headers: {
          Authorization: `Bearer ${required("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error("Could not obtain the short-lived release identity");
      const { value } = await response.json();
      if (typeof value !== "string" || !value || /[\r\n]/.test(value))
        throw new Error("Invalid release identity response");
      await smoke(target.origin, { "x-vercel-trusted-oidc-idp-token": value });
    },
    async promoted() {
      const target = await deployment();
      const deadline = now() + 5 * 60_000;
      for (;;) {
        const value = await project();
        const job = value.lastAliasRequest;
        if (
          validJob(job) &&
          job.toDeploymentId === target.id &&
          terminal.has(job.jobStatus)
        ) {
          const alias = await api("/v4/aliases/magick.ly");
          // Smoke even a partial failed promotion: it may already have moved traffic.
          await smoke(origin);
          const confirmedAlias = await api("/v4/aliases/magick.ly");
          // Check the job last: another promotion can begin during the alias read
          // while that alias still points at our deployment.
          const confirmed = await project();
          const matchesAlias = (value) =>
            value.alias === "magick.ly" &&
            value.projectId === projectId &&
            value.deploymentId === target.id;
          if (!sameJob(job, confirmed.lastAliasRequest))
            throw new Error(
              "Promotion changed during verification. Its outcome is uncertain; inspect Vercel before another release.",
            );
          if (
            job.type === "promote" &&
            (job.jobStatus === "succeeded" || job.jobStatus === "skipped") &&
            value.targets?.production?.id === target.id &&
            confirmed.targets?.production?.id === target.id &&
            matchesAlias(alias) &&
            matchesAlias(confirmedAlias)
          )
            return;
          throw new Error(
            "Promotion ended without all expected aliases. Inspect and recover the Vercel release before retrying.",
          );
        }
        if (now() >= deadline)
          throw new Error(
            "Promotion outcome is uncertain and may still change live traffic. Inspect the project's lastAliasRequest and magick.ly alias, then verify the live app before another release.",
          );
        await wait(5_000);
      }
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const command = process.argv[2];
    if (!["preflight", "staged", "promoted"].includes(command))
      throw new Error("Unknown release check");
    await createReleaseChecks(process.env)[command]();
    console.log(`Release ${command} checks passed.`);
  } catch (error) {
    // Network/JSON errors may include response fragments. Only our own fixed
    // messages are needed by the operator; never print provider bodies or URLs.
    console.error(
      error instanceof TypeError || error instanceof SyntaxError
        ? "Release check failed: invalid response or network failure."
        : error.message,
    );
    process.exitCode = 1;
  }
}
