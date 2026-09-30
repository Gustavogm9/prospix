import { describe, expect, it } from 'vitest';

import { buildEvolutionHeaders } from '../../../../supabase/functions/_shared/evolution-auth';

describe('buildEvolutionHeaders', () => {
  it('keeps the Evolution API key and adds the optional Basic credential', () => {
    expect(
      buildEvolutionHeaders('api-key', {
        basicAuthB64: 'dXNlcjpwYXNz',
        requestUrl: 'https://evolution.guilds.com.br/message/sendText/guilds',
        allowedHost: 'evolution.guilds.com.br',
      }),
    ).toEqual({
      apikey: 'api-key',
      Authorization: 'Basic dXNlcjpwYXNz',
    });
  });

  it('does not emit an Authorization header when Basic auth is not configured', () => {
    expect(buildEvolutionHeaders('api-key')).toEqual({
      apikey: 'api-key',
    });
  });

  it('normalizes a value that already contains the Basic scheme', () => {
    expect(
      buildEvolutionHeaders('api-key', {
        basicAuthB64: ' Basic dXNlcjpwYXNz ',
        requestUrl: 'https://evolution.guilds.com.br/instance/fetchInstances',
        allowedHost: 'evolution.guilds.com.br',
      }),
    ).toEqual({
      apikey: 'api-key',
      Authorization: 'Basic dXNlcjpwYXNz',
    });
  });

  it('never forwards the proxy credential to a different tenant-controlled host', () => {
    expect(
      buildEvolutionHeaders('api-key', {
        basicAuthB64: 'dXNlcjpwYXNz',
        requestUrl: 'https://evolution.example.net/message/sendText/other',
        allowedHost: 'evolution.guilds.com.br',
      }),
    ).toEqual({
      apikey: 'api-key',
    });
  });
});
