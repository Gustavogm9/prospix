import type { EffectiveGuardianConfig } from "./types.ts";

type SupabaseRpcError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

type SupabaseRpcClient = {
  rpc: (
    functionName: "get_guardian_active_config",
    args: { p_tenant_id: string },
  ) => Promise<{ data: unknown; error: SupabaseRpcError | null }>;
};

export class GuardianConfigError extends Error {
  readonly code: string;

  constructor(message: string, code = "GUARDIAN_CONFIG_LOAD_FAILED") {
    super(message);
    this.name = "GuardianConfigError";
    this.code = code;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeEffectiveGuardianConfig(value: unknown): EffectiveGuardianConfig | null {
  if (!isObject(value)) return null;
  if (typeof value.tenant_id !== "string") return null;
  if (!isObject(value.active_version)) return null;
  if (!Array.isArray(value.guardians)) return null;

  const activeVersion = value.active_version;
  if (
    typeof activeVersion.id !== "string" ||
    typeof activeVersion.version_number !== "number" ||
    typeof activeVersion.config_hash !== "string"
  ) {
    return null;
  }

  return value as unknown as EffectiveGuardianConfig;
}

export class GuardianConfigLoader {
  static async loadActive(params: {
    supabase: SupabaseRpcClient;
    tenantId: string;
    required?: boolean;
  }): Promise<EffectiveGuardianConfig | null> {
    const { data, error } = await params.supabase.rpc("get_guardian_active_config", {
      p_tenant_id: params.tenantId,
    });

    if (error) {
      throw new GuardianConfigError(
        error.message || "Failed to load active Guardian Engine config.",
        error.code || "GUARDIAN_CONFIG_RPC_ERROR",
      );
    }

    const config = normalizeEffectiveGuardianConfig(data);
    if (!config && params.required) {
      throw new GuardianConfigError(
        "Active Guardian Engine config is not available or has invalid shape.",
        "ACTIVE_CONFIG_NOT_AVAILABLE",
      );
    }

    return config;
  }
}
