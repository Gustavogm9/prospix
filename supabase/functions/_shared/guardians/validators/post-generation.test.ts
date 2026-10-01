import { assertEquals } from "jsr:@std/assert@1";
import { hasUnsupportedSuperlativeOrCredentialClaim } from "./post-generation.ts";

Deno.test("semantic scope allows conversational use of explicar melhor", () => {
  assertEquals(
    hasUnsupportedSuperlativeOrCredentialClaim(
      "O Giovane pode explicar melhor como funciona a proteção de renda.",
    ),
    false,
  );
});

Deno.test("semantic scope still blocks unsupported commercial superlatives", () => {
  assertEquals(
    hasUnsupportedSuperlativeOrCredentialClaim(
      "Somos a melhor solução do mercado.",
    ),
    true,
  );
  assertEquals(
    hasUnsupportedSuperlativeOrCredentialClaim(
      "Produto premiado e comprovado.",
    ),
    true,
  );
});
