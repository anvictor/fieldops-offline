export const PUBLIC_SITE = "https://anvictor.github.io/fieldops-offline/";

export function validateSha(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("Expected a full lowercase commit SHA.");
  }
  return value;
}

export function parseTarget(value) {
  const url = new URL(value);
  const publicSite = url.href === PUBLIC_SITE;
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) && !!url.port;
  if ((!publicSite && !local) || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/fieldops-offline/" || value !== url.href) {
    throw new Error("Smoke target is outside the approved allowlist.");
  }
  return url;
}

export function assertBuildInfo(info, sha) {
  validateSha(sha);
  if (!info || info.schemaVersion !== 1 || info.sha !== sha) {
    throw new Error("Deployment marker does not match the expected version.");
  }
}

// Apply equally to renderer and service-worker-owned outbound requests.
export function allowedRequest(value, method, target) {
  const url = new URL(value);
  return method === "GET" && url.origin === target.origin &&
    url.pathname.startsWith(target.pathname) && !/(^|\/)api(?:\/|$)/.test(url.pathname);
}
