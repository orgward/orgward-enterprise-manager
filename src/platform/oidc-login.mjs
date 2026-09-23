import { createHash, randomBytes } from 'node:crypto';

const LOGIN_TTL_MS = 5 * 60_000;

function authError(statusCode, code, message) {
  const error = new Error(message);
  Object.assign(error, { statusCode, code, retryable: statusCode >= 500 });
  return error;
}

function secureUrl(value, label) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${label} must be an absolute URL.`); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error(`${label} must use HTTPS, except on loopback for local development.`);
  if (url.username || url.password || url.hash) throw new Error(`${label} cannot contain user information or a fragment.`);
  return url;
}

function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value) || value.length > 2048) return '/';
  try {
    const url = new URL(value, 'https://orgward.invalid');
    return url.origin === 'https://orgward.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch { return '/'; }
}

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class OidcLoginFlow {
  #pending = new Map();

  constructor({ clientId, redirectUri, authorizationEndpoint, tokenEndpoint, identityAuthenticator, fetchImpl = fetch, clock = () => Date.now() }) {
    if (typeof clientId !== 'string' || !clientId.trim()) throw new Error('OIDC client ID is required for browser sign-in.');
    this.redirectUri = secureUrl(redirectUri, 'OIDC redirect URI').toString();
    this.authorizationEndpoint = secureUrl(authorizationEndpoint, 'OIDC authorization endpoint');
    this.tokenEndpoint = secureUrl(tokenEndpoint, 'OIDC token endpoint').toString();
    this.clientId = clientId;
    this.identityAuthenticator = identityAuthenticator;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
  }

  begin(returnTo = '/') {
    const now = this.clock();
    for (const [key, entry] of this.#pending) if (entry.createdAt + LOGIN_TTL_MS <= now) this.#pending.delete(key);
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expiresAt = now + LOGIN_TTL_MS;
    this.#pending.set(state, { nonce, verifier, returnTo: safeReturnTo(returnTo), createdAt: now });

    const authorization = new URL(this.authorizationEndpoint);
    authorization.searchParams.set('client_id', this.clientId);
    authorization.searchParams.set('redirect_uri', this.redirectUri);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('scope', 'openid profile');
    authorization.searchParams.set('state', state);
    authorization.searchParams.set('nonce', nonce);
    authorization.searchParams.set('code_challenge', challengeFor(verifier));
    authorization.searchParams.set('code_challenge_method', 'S256');
    return { state, location: authorization.toString(), maxAge: Math.ceil((expiresAt - now) / 1000) };
  }

  async complete({ state, cookieState, code, sessionStore }) {
    const transaction = typeof state === 'string' ? this.#pending.get(state) : null;
    if (!transaction || state !== cookieState || transaction.createdAt + LOGIN_TTL_MS <= this.clock()) {
      if (typeof state === 'string') this.#pending.delete(state);
      throw authError(400, 'OIDC_LOGIN_STATE_INVALID', 'The sign-in response expired or did not match its browser session. Start again.');
    }
    this.#pending.delete(state);
    if (typeof code !== 'string' || !code || code.length > 4096) throw authError(400, 'OIDC_LOGIN_CODE_INVALID', 'The identity provider returned an invalid sign-in code.');

    let response;
    try {
      response = await this.fetchImpl(this.tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, client_id: this.clientId,
          redirect_uri: this.redirectUri, code_verifier: transaction.verifier,
        }),
      });
    } catch {
      throw authError(503, 'OIDC_PROVIDER_UNAVAILABLE', 'The identity provider could not complete sign-in. Try again.');
    }
    if (!response.ok) throw authError(401, 'OIDC_LOGIN_REJECTED', 'The identity provider rejected sign-in. Start again.');
    let tokens;
    try { tokens = await response.json(); }
    catch { throw authError(502, 'OIDC_RESPONSE_INVALID', 'The identity provider returned an invalid sign-in response.'); }
    if (typeof tokens?.id_token !== 'string' || tokens.id_token.length > 16_384) throw authError(502, 'OIDC_RESPONSE_INVALID', 'The identity provider returned no usable ID token.');

    let identity;
    try {
      identity = await this.identityAuthenticator.authenticate(
        { headers: { authorization: `Bearer ${tokens.id_token}` } },
        { expectedNonce: transaction.nonce },
      );
    } catch {
      throw authError(401, 'OIDC_ID_TOKEN_INVALID', 'The identity provider response could not be verified. Start again.');
    }
    if (identity.actorType !== 'human') {
      throw authError(403, 'OIDC_WORKLOAD_BROWSER_SESSION_DENIED', 'Workload identities cannot start a browser session.');
    }
    const sessionId = randomBytes(32).toString('base64url');
    await sessionStore.create(sessionId, identity, identity.expiresAt);
    return { identity, sessionId, returnTo: transaction.returnTo, maxAge: Math.max(1, identity.expiresAt - Math.floor(this.clock() / 1000)) };
  }
}
