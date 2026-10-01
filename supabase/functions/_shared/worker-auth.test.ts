import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAuthorizedWorkerRequest } from "./worker-auth.ts";

const SUPABASE_URL = "https://project-ref.supabase.co";

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function serviceJwt(overrides: Record<string, unknown> = {}): string {
  return `${base64Url({ alg: "HS256", typ: "JWT" })}.${
    base64Url({
      iss: "supabase",
      ref: "project-ref",
      role: "service_role",
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    })
  }.signature`;
}

function authorized(authorization: string, cronHeader?: string): boolean {
  const headers = new Headers({ authorization });
  if (cronHeader) headers.set("x-cron-secret", cronHeader);
  return isAuthorizedWorkerRequest(
    new Request("https://example.test", { headers }),
    {
      serviceRoleKey: "current-secret",
      supabaseUrl: SUPABASE_URL,
      cronSecret: "cron-secret",
    },
  );
}

Deno.test("accepts the current project secret key", () => {
  assertEquals(authorized("Bearer current-secret"), true);
});

Deno.test("accepts the configured cron secret in bearer or dedicated header", () => {
  assertEquals(authorized("Bearer cron-secret"), true);
  assertEquals(authorized("Bearer unrelated", "cron-secret"), true);
});

Deno.test("accepts a non-expired legacy service-role JWT for the same project", () => {
  assertEquals(authorized(`Bearer ${serviceJwt()}`), true);
});

Deno.test("rejects malformed, expired, wrong-role, and cross-project JWTs", () => {
  assertEquals(authorized("Bearer not-a-jwt"), false);
  assertEquals(authorized(`Bearer ${serviceJwt({ exp: 1 })}`), false);
  assertEquals(
    authorized(`Bearer ${serviceJwt({ role: "authenticated" })}`),
    false,
  );
  assertEquals(
    authorized(`Bearer ${serviceJwt({ ref: "other-project" })}`),
    false,
  );
});
