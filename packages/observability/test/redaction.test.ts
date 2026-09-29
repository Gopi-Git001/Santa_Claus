import { describe, expect, it } from "vitest";
import { createMemoryLogger, REDACTED, redact, redactString } from "../src/index.ts";

/*
 * Secret-redaction fixture (P00 spec §22). Secret-shaped values are assembled
 * at runtime from fragments so that no secret-like literal is ever committed
 * (the committed-secret scan would — correctly — reject one).
 */
const join = (...parts: string[]) => parts.join("");
const FIXTURE = {
  urlPassword: join("s3cr3t", "-db-", "pw"),
  bearer: join("abc123", "DEF456", "ghi789"),
  github: join("gh", "p_", "A".repeat(36)),
  aws: join("AK", "IA", "ABCDEFGHIJKLMNOP"),
  provider: join("sk", "-", "ant-", "x".repeat(24)),
  slack: join("xo", "xb-", "1234567890-abc"),
  jwt: join("ey", "JhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxIn0", ".", "c2lnbmF0dXJl"),
  pem: join("-----BEGIN ", "PRIVATE KEY-----\nMIIEv\n-----END ", "PRIVATE KEY-----"),
};

describe("redactString", () => {
  it.each([
    ["url credentials", `postgres://harness:${FIXTURE.urlPassword}@localhost:5432/db`, FIXTURE.urlPassword],
    ["bearer token", `Authorization: Bearer ${FIXTURE.bearer}`, FIXTURE.bearer],
    ["github token", `token ${FIXTURE.github}`, FIXTURE.github],
    ["aws key id", `key=${FIXTURE.aws}`, FIXTURE.aws],
    ["provider api key", `using ${FIXTURE.provider} now`, FIXTURE.provider],
    ["slack token", FIXTURE.slack, FIXTURE.slack],
    ["jwt", `jwt ${FIXTURE.jwt}`, FIXTURE.jwt],
    ["pem private key", FIXTURE.pem, "MIIEv"],
    ["password assignment", `password=${FIXTURE.urlPassword}`, FIXTURE.urlPassword],
  ])("masks %s", (_name, input, secret) => {
    const out = redactString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it.each([
    ["prefixed env name", `HARNESS_DB_PASSWORD=${FIXTURE.urlPassword}`],
    ["snake_case key", `client_secret=${FIXTURE.urlPassword}`],
    ["camelCase key", `dbPassword: ${FIXTURE.urlPassword}`],
    ["JSON in a string", `{"api_key":"${FIXTURE.urlPassword}"}`],
    ["upper-case token", `API_TOKEN: "${FIXTURE.urlPassword}"`],
  ])("masks keyword-suffixed keys: %s", (_name, input) => {
    expect(redactString(input)).not.toContain(FIXTURE.urlPassword);
  });

  it("does not mask ordinary token counts", () => {
    expect(redactString("input_tokens: 42, max_tokens=100")).toBe("input_tokens: 42, max_tokens=100");
  });

  it("keeps non-secret context readable", () => {
    expect(redactString(`postgres://harness:${FIXTURE.urlPassword}@localhost:5432/db`)).toBe(
      `postgres://harness:${REDACTED}@localhost:5432/db`,
    );
    expect(redactString("node finalize completed in 12ms")).toBe("node finalize completed in 12ms");
  });
});

describe("redact (structured)", () => {
  it("replaces values under sensitive keys at any depth", () => {
    const out = redact({
      a: { password: "x", nested: [{ apiKey: "y" }] },
      DATABASE_URL: "z",
      thread_id: "thr_1",
    });
    expect(out).toEqual({
      a: { password: REDACTED, nested: [{ apiKey: REDACTED }] },
      DATABASE_URL: REDACTED,
      thread_id: "thr_1",
    });
  });

  it("redacts error messages and causes, and survives cycles", () => {
    const cyclic: Record<string, unknown> = { note: `Bearer ${FIXTURE.bearer}` };
    cyclic["self"] = cyclic;
    const err = new Error(`connect failed postgres://u:${FIXTURE.urlPassword}@h/db`, { cause: cyclic });
    const text = JSON.stringify(redact({ err }));
    expect(text).not.toContain(FIXTURE.urlPassword);
    expect(text).not.toContain(FIXTURE.bearer);
    expect(text).toContain("[Circular]");
  });

  it("renders shared (non-circular) references instead of marking them circular", () => {
    const shared = { n: 1 };
    expect(redact({ a: shared, b: [shared, shared] })).toEqual({ a: { n: 1 }, b: [{ n: 1 }, { n: 1 }] });
  });

  it("keeps error details, redacted", () => {
    const err = Object.assign(new Error("x"), { code: "NODE_FAILED", details: { node: "n", password: "p" } });
    expect(redact(err)).toMatchObject({ code: "NODE_FAILED", details: { node: "n", password: REDACTED } });
  });

  it("honours objects that serialise themselves (SecretString-style)", () => {
    const secretLike = { toJSON: () => REDACTED, reveal: () => FIXTURE.urlPassword };
    expect(redact({ db: secretLike })).toEqual({ db: REDACTED });
  });
});

describe("logger", () => {
  it("never writes a secret-like value passed by mistake", () => {
    const { logger, lines } = createMemoryLogger();
    logger.child({ run_id: "run_x", node: "finalize" }).error("db failed", {
      detail: `postgres://harness:${FIXTURE.urlPassword}@db/x`,
      token: FIXTURE.github,
      meta: { note: FIXTURE.provider },
    });
    const raw = JSON.stringify(lines());
    for (const secret of [FIXTURE.urlPassword, FIXTURE.github, FIXTURE.provider])
      expect(raw).not.toContain(secret);
    expect(lines()[0]).toMatchObject({ level: "error", msg: "db failed", run_id: "run_x", node: "finalize" });
  });

  it("filters below the configured level", () => {
    const { logger, lines } = createMemoryLogger("warn");
    logger.info("hidden");
    logger.warn("shown");
    expect(lines()).toHaveLength(1);
  });
});
