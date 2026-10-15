import { assertEquals } from "jsr:@std/assert@1";
import { beatRow, MAX_DETAIL, parseBeat, secretsMatch } from "./beat.ts";

Deno.test("secret compare fails closed when unset or missing", async () => {
  assertEquals(await secretsMatch("", ""), false);
  assertEquals(await secretsMatch("", "anything"), false);
  assertEquals(await secretsMatch("s3cret", null), false);
  assertEquals(await secretsMatch("s3cret", "s3cre"), false);
  assertEquals(await secretsMatch("s3cret", "s3cret"), true);
});

Deno.test("only brix and mini are accepted", () => {
  assertEquals("error" in parseBeat({ service: "opsagent" }), true);
  assertEquals("error" in parseBeat({}), true);
  assertEquals("error" in parseBeat(null), true);
  assertEquals(parseBeat({ service: "brix" }), { service: "brix", detail: null });
  assertEquals(parseBeat({ service: "mini", detail: " hi " }), { service: "mini", detail: "hi" });
});

Deno.test("detail is clipped, one line, and non-strings are ignored", () => {
  const long = parseBeat({ service: "mini", detail: "x".repeat(500) });
  assertEquals("error" in long, false);
  assertEquals((long as { detail: string }).detail.length, MAX_DETAIL);
  assertEquals(parseBeat({ service: "mini", detail: "a\nb\tc" }), { service: "mini", detail: "a b c" });
  assertEquals(parseBeat({ service: "mini", detail: 42 }), { service: "mini", detail: null });
});

Deno.test("beat row is ok with fresh timestamps", () => {
  const row = beatRow({ service: "brix", detail: "d" }, "2026-10-15T12:00:00.000Z");
  assertEquals(row.status, "ok");
  assertEquals(row.beat_at, row.last_ok_at);
  assertEquals(row.detail, { text: "d" });
});
