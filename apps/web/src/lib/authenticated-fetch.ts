export type SessionRetryProvider = {
  getAccessToken: () => Promise<string | null>;
  refreshAccessToken: () => Promise<string | null>;
  onUnauthorized: () => void;
};

function requestHeaders(
  options: RequestInit,
  accessToken: string | null,
  additionalHeaders: Record<string, string>,
) {
  const headers = Object.fromEntries(new Headers(options.headers).entries());
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  Object.assign(headers, additionalHeaders);
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return headers;
}

export async function fetchWithSessionRetry(
  path: string,
  options: RequestInit,
  provider: SessionRetryProvider,
  additionalHeaders: Record<string, string> = {},
) {
  const send = (accessToken: string | null) =>
    fetch(path, {
      ...options,
      headers: requestHeaders(options, accessToken, additionalHeaders),
      cache: 'no-store',
    });

  let response = await send(await provider.getAccessToken());
  if (response.status !== 401) return response;

  let refreshedToken: string | null = null;
  try {
    refreshedToken = await provider.refreshAccessToken();
  } catch {
    refreshedToken = null;
  }

  if (refreshedToken) response = await send(refreshedToken);
  if (response.status === 401) provider.onUnauthorized();
  return response;
}
