import { describe, expect, it } from "vitest";
import { isBulkMail, trimBody } from "../src/trim.js";

describe("trimBody", () => {
  it("drops Gmail/Apple quoted history and > lines", () => {
    const raw = [
      "Sounds good, let's meet Thursday at 3pm in the office.",
      "",
      "On Mon, 21 Sep 2026 at 10:02, Alice Example <alice@example.com>",
      "wrote:",
      "> Can we meet this week?",
      "> Thanks",
    ].join("\n");
    expect(trimBody(raw, 800)).toBe("Sounds good, let's meet Thursday at 3pm in the office.");
  });

  it("drops Outlook reply headers", () => {
    const raw = "Approved, please go ahead with the purchase.\r\n\r\nFrom: Bob <bob@corp.com>\r\nSent: Monday\r\nSubject: PO\r\n\r\nOld text";
    expect(trimBody(raw, 800)).toBe("Approved, please go ahead with the purchase.");
  });

  it("keeps forwarded content when there is almost nothing above the marker", () => {
    const raw = "FYI\n\nFrom: Carol <c@x.com>\nSent: Friday\n\nThe contract renewal is due on 1 October.";
    expect(trimBody(raw, 800)).toContain("contract renewal is due");
  });

  it("removes signatures, mobile footers and URLs", () => {
    const raw = "Invoice attached, due Friday. Pay at https://pay.example.com/abc?x=1 or www.example.com/pay\nSent from my iPhone\n-- \nDan\nCEO, Example Inc.";
    expect(trimBody(raw, 800)).toBe("Invoice attached, due Friday. Pay at [link] or [link]");
  });

  it("strips newsletter boilerplate and footer only in newsletter mode", () => {
    const raw = [
      "View this email in your browser",
      "Weekly Tech Digest",
      "Apple announced new MacBooks with a faster chip and longer battery life.",
      "Forward to a friend",
      "You're receiving this because you subscribed at example.com.",
      "Unsubscribe | Update your preferences",
      "© 2026 Digest Media. All rights reserved.",
    ].join("\n");
    expect(trimBody(raw, 800, { newsletter: true })).toBe(
      "Weekly Tech Digest Apple announced new MacBooks with a faster chip and longer battery life.",
    );
    expect(trimBody(raw, 800)).toContain("Unsubscribe");
  });

  it("returns nothing when the limit is 0", () => {
    expect(trimBody("anything", 0, { newsletter: true })).toBe("");
  });

  it("truncates on a word boundary", () => {
    const out = trimBody("word ".repeat(300), 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith("word…")).toBe(true);
  });
});

describe("isBulkMail", () => {
  it("detects list headers and no-reply senders", () => {
    expect(isBulkMail(new Map([["list-unsubscribe", "<mailto:x>"]]), "shop@brand.com")).toBe(true);
    expect(isBulkMail(new Map([["precedence", "bulk"]]), "a@b.com")).toBe(true);
    expect(isBulkMail(new Map([["auto-submitted", "auto-generated"]]), "a@b.com")).toBe(true);
    expect(isBulkMail(null, "no-reply@bank.com")).toBe(true);
    expect(isBulkMail(null, "notifications@github.com")).toBe(true);
  });

  it("treats normal personal mail as not bulk", () => {
    expect(isBulkMail(new Map([["auto-submitted", "no"]]), "alice@example.com")).toBe(false);
    expect(isBulkMail(null, "newsom@example.com")).toBe(false);
    expect(isBulkMail(null, null)).toBe(false);
  });
});
