export function campaignEnrichmentPolicy(
  filters: Record<string, unknown> | null | undefined,
  tenantActiveSources: Iterable<string>,
): { deepEnrichmentEnabled: boolean; activeSources: Set<string> } {
  const deepEnrichmentEnabled = filters?.deep_enrichment === true;
  return {
    deepEnrichmentEnabled,
    activeSources: deepEnrichmentEnabled
      ? new Set([...tenantActiveSources].map((source) => String(source).toUpperCase()))
      : new Set<string>(),
  };
}
