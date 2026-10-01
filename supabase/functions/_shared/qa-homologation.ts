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
