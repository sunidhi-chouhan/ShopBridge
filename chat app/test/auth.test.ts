import "./helpers";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { beforeEach, describe, it } from "node:test";
import { RATE_LIMITS, assertAuthRate, clientKey, resetAuthRate } from "../server/auth";

function req(forwardedFor?: string, remote = "10.0.0.1"): IncomingMessage {
  return {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    socket: { remoteAddress: remote },
  } as unknown as IncomingMessage;
}

describe("rate limiting", () => {
  beforeEach(() => resetAuthRate());

  it("uses the original client address", () => {
    assert.equal(clientKey(req("203.0.113.5, 10.1.1.1")), "203.0.113.5");
    assert.equal(clientKey(req(undefined, "198.51.100.7")), "198.51.100.7");
  });

  it("limits password attempts per address", () => {
    const office = req("203.0.113.5");
    for (let i = 0; i < RATE_LIMITS.credentials; i++) assertAuthRate(office, "credentials");
    assert.throws(() => assertAuthRate(office, "credentials"), { status: 429 });
  });

  it("demo role switching has its own, larger budget", () => {
    const office = req("203.0.113.5");
    for (let i = 0; i < RATE_LIMITS.credentials + 1; i++) {
      try {
        assertAuthRate(office, "credentials");
      } catch {
        /* exhausted on purpose */
      }
    }
    // A judging panel behind one network switching roles ~50 times is fine.
    for (let i = 0; i < 50; i++) assertAuthRate(office, "demo");
  });

  it("windows reset after 15 minutes", () => {
    const office = req("203.0.113.9");
    const start = 1_000_000;
    for (let i = 0; i < RATE_LIMITS.credentials; i++) assertAuthRate(office, "credentials", start);
    assert.throws(() => assertAuthRate(office, "credentials", start + 1000), { status: 429 });
    assertAuthRate(office, "credentials", start + 15 * 60 * 1000 + 1);
  });
});
