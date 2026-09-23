import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const MAX_TOKEN_BYTES = 16_384;

function unauthorized(message = 'A valid OIDC access token is required.') {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = 'AUTHENTICATION_REQUIRED';
  error.retryable = false;
  return error;
}

function decodeJson(segment) {
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON object.');
    return value;
  }
  catch { throw unauthorized('The OIDC access token is malformed.'); }
}

function audienceMatches(value, audience) {
  return Array.isArray(value) ? value.includes(audience) : value === audience;
}

export class OidcAuthenticator {
  #keys = null;
  #keysUntil = 0;
  #inflight = null;

  constructor({ issuer, audience, jwksUri, roleClaim = 'groups', roleMap = {}, tenantClaim = 'orgward_tenant', tenantBindings, fetchImpl = fetch, clock = () => Date.now() }) {
    if (!issuer || !audience || !jwksUri) throw new Error('OIDC issuer, audience, and JWKS URI are required.');
    if (!tenantBindings || typeof tenantBindings !== 'object' || Array.isArray(tenantBindings)) {
      throw new Error('OIDC tenant bindings must be an explicit provider-tenant to OrgWard-tenant mapping.');
    }
    const bindings = Object.entries(tenantBindings);
    if (!bindings.length || bindings.some(([providerTenant, tenantId]) =>
      !providerTenant.trim() || providerTenant.length > 512 || typeof tenantId !== 'string' || !TENANT_ID.test(tenantId))) {
      throw new Error('OIDC tenant bindings must contain provider tenant values mapped to valid OrgWard tenant IDs.');
    }
    this.issuer = issuer;
    this.audience = audience;
    this.jwksUri = jwksUri;
    this.roleClaim = roleClaim;
    this.roleMap = roleMap;
    this.tenantClaim = tenantClaim;
    this.tenantBindings = new Map(bindings);
    this.fetchImpl = fetchImpl;
    this.clock = clock;
  }

  async #getKey(kid) {
    if (!this.#keys || this.#keysUntil <= this.clock()) {
      if (!this.#inflight) this.#inflight = (async () => {
        const response = await this.fetchImpl(this.jwksUri, { headers: { accept: 'application/json' }, redirect: 'error' });
        if (!response.ok) throw unauthorized('The OIDC signing keys are temporarily unavailable.');
        let document;
        try { document = await response.json(); }
        catch { throw unauthorized('The OIDC signing key set is invalid.'); }
        if (!Array.isArray(document?.keys)) throw unauthorized('The OIDC signing key set is invalid.');
        const keys = new Map();
        for (const key of document.keys) {
          if (key?.kty === 'RSA' && (key?.use === undefined || key.use === 'sig')
            && (key?.alg === undefined || key.alg === 'RS256')
            && (!key?.key_ops || key.key_ops.includes('verify'))
            && typeof key?.kid === 'string') keys.set(key.kid, key);
        }
        if (!keys.size) throw unauthorized('The OIDC signing key set has no supported keys.');
        this.#keys = keys;
        this.#keysUntil = this.clock() + 5 * 60_000;
      })().finally(() => { this.#inflight = null; });
      await this.#inflight;
    }
    const jwk = this.#keys?.get(kid);
    if (!jwk) throw unauthorized('The OIDC signing key is unknown.');
    try { return createPublicKey({ key: jwk, format: 'jwk' }); }
    catch { throw unauthorized('The OIDC signing key is invalid.'); }
  }

  async authenticate(request, { expectedNonce = null } = {}) {
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' && authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/);
    if (!match || Buffer.byteLength(match[1]) > MAX_TOKEN_BYTES) throw unauthorized();
    const [encodedHeader, encodedClaims, encodedSignature, extra] = match[1].split('.');
    if (!encodedHeader || !encodedClaims || !encodedSignature || extra !== undefined) throw unauthorized('The OIDC access token is malformed.');
    const header = decodeJson(encodedHeader);
    const claims = decodeJson(encodedClaims);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthorized('The OIDC access token uses an unsupported signing method.');
    const key = await this.#getKey(header.kid);
    const valid = verifySignature('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedClaims}`), key, Buffer.from(encodedSignature, 'base64url'));
    if (!valid) throw unauthorized();

    const now = Math.floor(this.clock() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== this.issuer || !audienceMatches(claims.aud, this.audience)
      || (audiences.length > 1 && claims.azp !== this.audience)
      || (claims.azp !== undefined && claims.azp !== this.audience)
      || !Number.isFinite(claims.exp) || claims.exp <= now
      || !Number.isSafeInteger(claims.iat) || claims.iat < 0 || claims.iat > now + 60 || claims.exp <= claims.iat
      || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now))
      || typeof claims.sub !== 'string' || !claims.sub.trim()) throw unauthorized();
    if (expectedNonce !== null && claims.nonce !== expectedNonce) throw unauthorized('The OIDC authentication response did not match this login attempt.');
    const providerTenant = claims[this.tenantClaim];
    const tenantId = typeof providerTenant === 'string' ? this.tenantBindings.get(providerTenant) : null;
    if (!tenantId) throw unauthorized('The OIDC identity has no configured tenant binding.');

    const sourceRoles = claims[this.roleClaim];
    const roles = (Array.isArray(sourceRoles) ? sourceRoles : typeof sourceRoles === 'string' ? [sourceRoles] : [])
      .flatMap((source) => Array.isArray(this.roleMap[source]) ? this.roleMap[source] : [])
      .filter((role, index, values) => typeof role === 'string' && values.indexOf(role) === index);
    const labelClaim = typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.name;
    const displayName = typeof labelClaim === 'string' && labelClaim.trim()
      ? labelClaim.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || claims.sub.slice(0, 200)
      : claims.sub.slice(0, 200);
    return Object.freeze({
      issuer: this.issuer,
      subject: claims.sub,
      principal: `oidc:${createHash('sha256').update(`${this.issuer}\n${claims.sub}`).digest('hex')}`,
      displayName,
      tenantId,
      roles: Object.freeze(roles),
      actorType: claims.orgward_actor_type === 'workload' ? 'workload' : 'human',
      expiresAt: claims.exp,
    });
  }
}
