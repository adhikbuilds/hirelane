import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";

/**
 * A local OpenID provider for tests: a generated RSA key, discovery, JWKS and a token endpoint behind an injected
 * `fetch`. Nothing here opens a socket and nothing talks to a real Google.
 */
export interface MockIssuer {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch: typeof fetch;
  requests: { url: string; method: string }[];
  /** Plays the user's browser: reads the authorize URL, remembers its challenge and nonce, returns code and state. */
  authorize(authUrl: string, user: { sub: string; email: string; emailVerified?: boolean }, claims?: Record<string, unknown>): { code: string; state: string };
  mint(claims: Record<string, unknown>, opts?: { alg?: string; kid?: string; key?: KeyObject }): string;
  /** Next token response carries this id_token instead of a freshly minted one. */
  forceIdToken(token: string | null): void;
  otherKey: KeyObject;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function createMockIssuer(issuer = "https://issuer.example.test", clock: () => Date = () => new Date()): MockIssuer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const clientId = "client-123.apps.example.test";
  const clientSecret = "mock-secret";
  const redirectUri = "http://localhost:3001/auth/google/callback";
  const codes = new Map<string, { challenge: string; nonce: string; user: { sub: string; email: string; emailVerified?: boolean }; claims: Record<string, unknown> }>();
  const requests: { url: string; method: string }[] = [];
  let forced: string | null = null;

  const mint: MockIssuer["mint"] = (claims, o = {}) => {
    const header = { alg: o.alg ?? "RS256", kid: o.kid ?? "k1", typ: "JWT" };
    const signing = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
    if (header.alg === "none") return `${signing}.`;
    const sig = createSign("RSA-SHA256").update(signing).sign(o.key ?? privateKey);
    return `${signing}.${b64(sig)}`;
  };

  const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (url === `${issuer}/jwks`) return json({ keys: [jwk] });
    if (url === `${issuer}/token` && method === "POST") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const entry = codes.get(form.get("code") ?? "");
      if (!entry || form.get("client_secret") !== clientSecret || form.get("client_id") !== clientId || form.get("redirect_uri") !== redirectUri || form.get("grant_type") !== "authorization_code") {
        return json({ error: "invalid_grant" }, 400);
      }
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== entry.challenge) return json({ error: "invalid_grant", error_description: "pkce" }, 400);
      codes.delete(form.get("code")!);
      const now = Math.floor(clock().getTime() / 1000);
      const id_token =
        forced ??
        mint({ iss: issuer, aud: clientId, sub: entry.user.sub, email: entry.user.email, email_verified: entry.user.emailVerified ?? true, nonce: entry.nonce, iat: now, exp: now + 300, ...entry.claims });
      return json({ access_token: "unused", token_type: "Bearer", id_token });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    fetch: mockFetch,
    requests,
    otherKey: other.privateKey,
    mint,
    forceIdToken: (t) => {
      forced = t;
    },
    authorize(authUrl, user, claims = {}) {
      const u = new URL(authUrl);
      if (u.origin + u.pathname !== `${issuer}/authorize`) throw new Error("not the mock authorize endpoint");
      const p = u.searchParams;
      if (p.get("code_challenge_method") !== "S256") throw new Error("PKCE S256 missing");
      const code = randomBytes(12).toString("hex");
      codes.set(code, { challenge: p.get("code_challenge")!, nonce: p.get("nonce")!, user, claims });
      return { code, state: p.get("state")! };
    },
  };
}
