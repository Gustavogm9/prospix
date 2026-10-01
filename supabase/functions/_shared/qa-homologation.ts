export function canBypassTenantOutboundPause(params: {
  tenantOutboundAllowed: boolean;
  campaignActive: boolean;
  homologationMode: boolean;
  leadAllowlisted: boolean;
}): boolean {
  return params.tenantOutboundAllowed === false &&
    params.campaignActive === true &&
    params.homologationMode === true &&
    params.leadAllowlisted === true;
}

export function shouldEscalateLegacyAntiLoop(params: {
  messageCount: number;
  leadStatus?: string | null;
  intent?: string | null;
  qaHomologationAllowed: boolean;
}): boolean {
  if (params.qaHomologationAllowed) return false;

  return params.messageCount >= 10 &&
    params.leadStatus !== "MEETING_SCHEDULED" &&
    params.intent !== "SCHEDULED";
}
