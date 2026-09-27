import { describe, expect, it } from "vitest";
import { syncSearchQuery } from "../src/mail.js";

describe("syncSearchQuery", () => {
  const since = new Date("2026-09-01T00:00:00Z");
  it("asks the server for unread mail only by default setting", () => {
    expect(syncSearchQuery(since, true)).toEqual({ since, seen: false });
  });
  it("asks for all mail when unread-only is off", () => {
    expect(syncSearchQuery(since, false)).toEqual({ since });
  });
});
