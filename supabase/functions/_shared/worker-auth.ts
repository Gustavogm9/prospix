type WorkerAuthOptions = {
  serviceRoleKey: string;
  supabaseUrl: string;
  cronSecret?: string | null;
};

type ServiceRoleClaims = {
  iss?: unknown;
  ref?: unknown;
  role?: unknown;
  exp?: unknown;
};

function decodeJwtPayload(token: string): ServiceRoleClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as ServiceRoleClaims;
  } catch {
    return null;
  }
}

function isGatewayVerifiedLegacyServiceRoleJwt(
  authorization: string,
  supabaseUrl: string,
): boolean {
  if (!authorization.startsWith("Bearer ")) return false;
  const claims = decodeJwtPayload(authorization.slice("Bearer ".length));
  if (!claims) return false;

  let expectedRef = "";
  try {
    expectedRef = new URL(supabaseUrl).hostname.split(".")[0] || "";
  } catch {
    return false;
  }

  return claims.iss === "supabase" &&
    claims.role === "service_role" &&
    claims.ref === expectedRef &&
    typeof claims.exp === "number" &&
    claims.exp > Math.floor(Date.now() / 1000);
}

/**
 * Accepts the current secret key, the configured cron secret, or the legacy
 * service-role JWT after the Edge gateway has verified its signature.
 * Every caller using the JWT branch must keep verify_jwt=true in config.toml.
 */
export function isAuthorizedWorkerRequest(
  req: Request,
  options: WorkerAuthOptions,
): boolean {
  const authorization = req.headers.get("authorization") || "";
  if (authorization === `Bearer ${options.serviceRoleKey}`) return true;

  const cronSecret = String(options.cronSecret || "").trim();
  if (
    cronSecret && (
      authorization === `Bearer ${cronSecret}` ||
      req.headers.get("x-cron-secret") === cronSecret
    )
  ) return true;

  return isGatewayVerifiedLegacyServiceRoleJwt(
    authorization,
    options.supabaseUrl,
  );
}
