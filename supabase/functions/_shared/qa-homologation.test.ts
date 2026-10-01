import { assertEquals } from "jsr:@std/assert@1";
import {
  canBypassTenantOutboundPause,
  shouldEscalateLegacyAntiLoop,
} from "./qa-homologation.ts";

Deno.test("QA pause bypass requires every safety condition", () => {
  assertEquals(
    canBypassTenantOutboundPause({
      tenantOutboundAllowed: false,
      campaignActive: true,
      homologationMode: true,
      leadAllowlisted: true,
    }),
    true,
  );
  assertEquals(
    canBypassTenantOutboundPause({
      tenantOutboundAllowed: false,
      campaignActive: true,
      homologationMode: true,
      leadAllowlisted: false,
    }),
    false,
  );
});

Deno.test("legacy anti-loop remains enabled outside contained QA", () => {
  assertEquals(
    shouldEscalateLegacyAntiLoop({
      messageCount: 10,
      leadStatus: "CONTACTED",
      intent: "INTERESTED",
      qaHomologationAllowed: false,
    }),
    true,
  );
});

Deno.test("contained QA uses qualification limits instead of historical message count", () => {
  assertEquals(
    shouldEscalateLegacyAntiLoop({
      messageCount: 99,
      leadStatus: "CONTACTED",
      intent: "INTERESTED",
      qaHomologationAllowed: true,
    }),
    false,
  );
});
