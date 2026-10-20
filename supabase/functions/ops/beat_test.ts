import { assertEquals } from "jsr:@std/assert@1";
import { beatRow, MAX_DETAIL, parseBeat, secretsMatch } from "./beat.ts";

Deno.test("secret compare fails closed when unset or missing", async () => {
  assertEquals(await secretsMatch("", ""), false);
  assertEquals(await secretsMatch("", "anything"), false);
  assertEquals(await secretsMatch("s3cret", null), false);
  assertEquals(await secretsMatch("s3cret", "s3cre"), false);
  assertEquals(await secretsMatch("s3cret", "s3cret"), true);
});

Deno.test("only the catalogued services are accepted", () => {
  assertEquals("error" in parseBeat({ service: "opsagent" }), true);
  assertEquals("error" in parseBeat({}), true);
  assertEquals("error" in parseBeat(null), true);
  assertEquals(parseBeat({ service: "brix" }), { service: "brix", detail: null, status: "ok", message: null });
  assertEquals(parseBeat({ service: "mini", detail: " hi " }), {
    service: "mini", detail: "hi", status: "ok", message: null,
  });
  assertEquals("error" in parseBeat({ service: "supabase" }), false);
});

Deno.test("detail is clipped, one line, and non-strings are ignored", () => {
  const long = parseBeat({ service: "mini", detail: "x".repeat(500) });
  assertEquals("error" in long, false);
  assertEquals((long as { detail: string }).detail.length, MAX_DETAIL);
  assertEquals(parseBeat({ service: "mini", detail: "a\nb\tc" }), {
    service: "mini", detail: "a b c", status: "ok", message: null,
  });
  assertEquals(parseBeat({ service: "mini", detail: 42 }), {
    service: "mini", detail: null, status: "ok", message: null,
  });
});

Deno.test("status and message are validated like detail", () => {
  const warn = parseBeat({ service: "supabase", status: "warn", message: "egress\n82 %" });
  assertEquals(warn, { service: "supabase", detail: null, status: "warn", message: "egress 82 %" });
  const junk = parseBeat({ service: "supabase", status: "fine", message: 7 });
  assertEquals(junk, { service: "supabase", detail: null, status: "ok", message: null });
});

Deno.test("beat row is ok with fresh timestamps", () => {
  const row = beatRow({ service: "brix", detail: "d", status: "ok", message: null }, "2026-10-15T12:00:00.000Z");
  assertEquals(row.status, "ok");
  assertEquals(row.beat_at, row.last_ok_at);
  assertEquals(row.detail, { text: "d" });
  assertEquals(row.expected_every_seconds, 300);
});

Deno.test("a warn beat keeps its message; an ok beat clears it", () => {
  const warn = beatRow(
    { service: "supabase", detail: "d", status: "warn", message: "egress 82 %" },
    "2026-10-15T12:00:00.000Z",
  );
  assertEquals(warn.status, "warn");
  assertEquals(warn.last_error, "egress 82 %");
  assertEquals(warn.last_error_at, "2026-10-15T12:00:00.000Z");
  assertEquals(warn.expected_every_seconds, 3600);
  const ok = beatRow(
    { service: "supabase", detail: "d", status: "ok", message: "stale" },
    "2026-10-15T13:00:00.000Z",
  );
  assertEquals(ok.last_error, null);
  assertEquals(ok.last_error_at, null);
});
