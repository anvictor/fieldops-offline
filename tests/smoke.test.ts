import { describe, expect, it } from "vitest";
// The scripts run directly in Node; their runtime input validation is tested here.
// @ts-expect-error JavaScript smoke scripts intentionally have no emitted declarations.
import { allowedRequest, assertBuildInfo, parseTarget, PUBLIC_SITE, validateSha } from "../scripts/smoke-config.mjs";

const sha = "a".repeat(40);
describe("safe deployed smoke configuration", () => {
  it("permits only the hosted site and canonical loopback preview", () => {
    for (const target of [PUBLIC_SITE, "http://127.0.0.1:4173/fieldops-offline/", "http://localhost:4173/fieldops-offline/"]) {
      expect(parseTarget(target).href).toBe(target);
    }
  });
  it("rejects credentials, query, fragment, foreign host/path and noncanonical input", () => {
    for (const target of ["https://user:pass@anvictor.github.io/fieldops-offline/", PUBLIC_SITE + "?x", PUBLIC_SITE + "#x",
      "https://example.com/fieldops-offline/", "https://anvictor.github.io/", "http://127.0.0.1/fieldops-offline/",
      "http://127.0.0.1:4173/other/", " " + PUBLIC_SITE, "https://anvictor.github.io/fieldops-offline"]) {
      expect(() => parseTarget(target)).toThrow();
    }
  });
  it("rejects invalid expected versions", () => {
    expect(validateSha(sha)).toBe(sha);
    for (const value of [undefined, "", "a".repeat(7), "A".repeat(40), "g".repeat(40), sha + "\n"]) {
      expect(() => validateSha(value)).toThrow();
    }
  });
  it("fails closed on stale or malformed markers", () => {
    expect(() => assertBuildInfo({ schemaVersion: 1, sha }, sha)).not.toThrow();
    for (const value of [null, {}, { schemaVersion: 2, sha }, { schemaVersion: 1, sha: "b".repeat(40) }, { schemaVersion: 1 }]) {
      expect(() => assertBuildInfo(value, sha)).toThrow();
    }
  });
  it("permits static GETs but blocks all mutations and same/cross-origin API requests", () => {
    const target = parseTarget(PUBLIC_SITE);
    expect(allowedRequest(PUBLIC_SITE + "assets/app.js", "GET", target)).toBe(true);
    for (const [url, method] of [[PUBLIC_SITE + "api/inspections", "GET"], [PUBLIC_SITE + "assets/app.js", "POST"],
      ["https://backend.example/api/inspections", "PATCH"], ["https://anvictor.github.io/api/inspections", "DELETE"],
      ["https://backend.example/config", "GET"]]) expect(allowedRequest(url, method, target)).toBe(false);
  });
});
