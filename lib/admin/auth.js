import { auditStatements, requireRow } from './audit.js';
import { digest, equal, seal, token, unseal } from './crypto.js';
import { AdminError, redirect } from './http.js';

const origins = { production: 'https://freemcp.in', preview: 'https://feature-admin-dashboard.freemcp.pages.dev' };
const sessionName = '__Host-freemcp-admin';
const stateName = '__Host-freemcp-state';
const stateLife = 600;
const sessionLife = 7200;
const absoluteLife = 28800;
const seconds = () => Math.floor(Date.now() / 1000);
const tokenFormat = /^[a-zA-Z0-9_-]{43}$/;
const sessionHash = (config,raw) => digest(config.secret+'\nsession\n'+raw);

export function configuration(env, request) {
  const mode = env.ADMIN_ENV;
  const local = mode === 'local' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(env.ADMIN_ORIGIN || '');
  if (!local && !Object.hasOwn(origins, mode)) throw new AdminError(503, 'Administration is not configured.');
  const origin = local ? env.ADMIN_ORIGIN : origins[mode];
  if (new URL(request.url).origin !== origin) throw new AdminError(404, 'Not found.');
  if (!local && env.CF_PAGES_BRANCH !== (mode === 'production' ? 'main' : 'feature/admin-dashboard')) {
    throw new AdminError(404, 'Not found.');
  }
  const allowlist = (env.ADMIN_GITHUB_IDS || '').split(',').map(id => id.trim());
  if (!env.DB || !/^[a-zA-Z0-9_]{10,100}$/.test(env.ADMIN_GITHUB_CLIENT_ID || '') ||
      !env.ADMIN_GITHUB_CLIENT_SECRET || !allowlist.every(id => /^[1-9][0-9]{0,17}$/.test(id)) ||
      typeof env.ADMIN_SESSION_SECRET !== 'string' || env.ADMIN_SESSION_SECRET.length < 32 ||
      !tokenFormat.test(env.ADMIN_HISTORY_KEY || '')) {
    throw new AdminError(503, 'Administration is not configured.');
  }
  return { db: env.DB, mode, origin, allowlist, client: env.ADMIN_GITHUB_CLIENT_ID,
    clientSecret: env.ADMIN_GITHUB_CLIENT_SECRET, secret: env.ADMIN_SESSION_SECRET,
    historyKey: env.ADMIN_HISTORY_KEY, callback: origin + '/admin/oauth/callback/' };
}

function cookie(name, value, age, sameSite = 'Lax') {
  return `${name}=${value}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=${sameSite}`;
}
function readCookie(request, name) {
  const matches = (request.headers.get('Cookie') || '').split(/;\s*/).filter(pair => pair.startsWith(name + '='));
  const value = matches.length === 1 ? matches[0].slice(name.length + 1) : '';
  return tokenFormat.test(value) ? value : '';
}

export function requireOrigin(config, request) {
  if (request.headers.get('Origin') !== config.origin) throw new AdminError(403, 'Request origin is not authorized.');
}
export function requireCsrf(session, value) {
  if (!equal(session.csrf, value)) throw new AdminError(403, 'This form has expired. Reload the page and try again.');
}

export async function rateLimit(config, identity, kind, max, window) {
  const now = seconds();
  const bucket = Math.floor(now / window);
  const key = await digest(config.secret + '\n' + config.mode + '\n' + kind + '\n' + identity + '\n' + bucket);
  const { results: [row] } = await config.db.prepare(`INSERT INTO admin_rate_limits(id,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET attempts=MIN(attempts+1,?) RETURNING attempts`)
    .bind(key, (bucket + 2) * window, max + 1).all();
  if (row.attempts > max) throw new AdminError(429, 'Too many requests. Try again shortly.');
}
const clientAddress = request => request.headers.get('CF-Connecting-IP') || 'loopback';

export async function sessionFor(config, request) {
  const raw = readCookie(request, sessionName);
  if (!raw) return null;
  const hash = await sessionHash(config,raw);
  const row = await config.db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND environment=? AND expires_at>? AND absolute_expires_at>?')
    .bind(hash, config.mode, seconds(), seconds()).first();
  if (!row || !config.allowlist.includes(row.actor)) return null;
  return { ...row, csrf: await digest(config.secret + '\ncsrf\n' + raw) };
}

export async function beginOAuth(config, request) {
  requireOrigin(config, request);
  await rateLimit(config, clientAddress(request), 'login', 12, 600);
  const state = token(), verifier = token(), now = seconds();
  const hash = await digest(state);
  await config.db.batch([
    config.db.prepare('DELETE FROM admin_oauth_states WHERE expires_at<=?').bind(now),
    config.db.prepare('DELETE FROM admin_rate_limits WHERE expires_at<=?').bind(now),
    config.db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    config.db.prepare('INSERT INTO admin_oauth_states VALUES(?,?,?)').bind(hash, await seal(config.historyKey,'oauth:'+hash,verifier), now + stateLife),
  ]);
  const url = new URL('https://github.com/login/oauth/authorize');
  for (const [key, value] of Object.entries({
    client_id: config.client, redirect_uri: config.callback, state, scope: '',
    code_challenge: await digest(verifier), code_challenge_method: 'S256',
  })) url.searchParams.set(key, value);
  return redirect(url.href, [cookie(stateName, state, stateLife, 'Lax')]);
}

export async function finishOAuth(config, request) {
  await rateLimit(config, clientAddress(request), 'callback', 18, 600);
  const url = new URL(request.url);
  const state = url.searchParams.get('state'), code = url.searchParams.get('code');
  if (!equal(readCookie(request, stateName), state) || !state || !code || code.length > 240 ||
      url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) {
    throw new AdminError(403, 'Sign-in request is invalid or expired. Start again.');
  }
  const hash = await digest(state);
  const { results: [row] } = await config.db.prepare('DELETE FROM admin_oauth_states WHERE state_hash=? AND expires_at>? RETURNING verifier')
    .bind(hash, seconds()).all();
  if (!row) throw new AdminError(403, 'Sign-in request is invalid or expired. Start again.');
  let verifier;
  try {
    verifier = await unseal(config.historyKey, 'oauth:' + hash, row.verifier);
  } catch {
    throw new AdminError(503, 'The saved sign-in request could not be read. Start again.');
  }
  const parameters = new URLSearchParams({
    client_id: config.client, client_secret: config.clientSecret, redirect_uri: config.callback,
    code, code_verifier: verifier,
  });
  const credential = await exchangeGitHubCode(parameters);
  if (typeof credential?.access_token !== 'string' || !credential.access_token ||
      credential.scope && (typeof credential.scope !== 'string' || credential.scope.trim())) {
    throw new AdminError(502, 'GitHub sign-in could not be verified. Start again.');
  }
  const user = await githubIdentity(credential.access_token);
  if (!config.allowlist.includes(String(user.id))) throw new AdminError(403, 'This GitHub account is not authorized.');
  const identity = { actor: String(user.id), login: String(user.login || '').slice(0, 64) };
  const prior = await sessionFor(config, request);
  const sessionCookie = await issueSession(config, identity, prior);
  return redirect('/admin/', [sessionCookie, cookie(stateName, '', 0, 'Lax')]);
}

async function exchangeGitHubCode(parameters) {
  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FreeMCP-Admin' },
      body: parameters.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AdminError(502, 'Could not reach GitHub to exchange the sign-in code. Start again.');
  }

  // GitHub can return OAuth errors with either a successful or an error HTTP status.
  const credential = await response.json().catch(() => null);
  switch (credential?.error) {
    case 'incorrect_client_credentials':
      throw new AdminError(503, 'GitHub rejected the OAuth app credentials. Check the client ID and secret for this environment.');
    case 'redirect_uri_mismatch':
      throw new AdminError(503, 'GitHub rejected the OAuth callback URL. Check the callback configured for this environment.');
    case 'bad_verification_code':
    case 'bad_code_verifier':
    case 'incorrect_code_verifier':
      throw new AdminError(400, 'GitHub rejected this sign-in request. Start again.');
    case 'unverified_user_email':
      throw new AdminError(403, 'Verify your GitHub email address before signing in.');
  }
  if (!response.ok) {
    // Expose only the status. Never forward provider error bodies, headers, or redirects.
    throw new AdminError(502, 'GitHub code exchange returned HTTP ' + response.status + '.');
  }
  return credential;
}

async function githubIdentity(accessToken) {
  let response;
  try {
    response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FreeMCP-Admin',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // Workers supports manual redirects. Never forward the bearer token to another URL.
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AdminError(502, 'Could not reach GitHub to verify your identity. Start again.');
  }
  if (!response.ok) throw new AdminError(502, 'GitHub identity lookup returned HTTP ' + response.status + '. Start again.');
  const user = await response.json().catch(() => null);
  if (!Number.isSafeInteger(user?.id)) throw new AdminError(502, 'GitHub did not return a valid account identity. Start again.');
  return user;
}

async function issueSession(config, identity, prior, rotating = false) {
  const now = seconds();
  const max = rotating ? prior.absolute_expires_at : now + absoluteLife;
  const age = Math.min(sessionLife, max - now);
  if (age <= 0) throw new AdminError(401, 'Session expired. Sign in again.');
  const raw = token();
  const db = config.db;
  const hash = await sessionHash(config,raw);
  const insert = db.prepare(`INSERT INTO admin_sessions SELECT ?,?,?,?,?,?${rotating ? ' WHERE EXISTS (SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at>?)' : ''}`)
    .bind(hash, identity.actor, identity.login, config.mode, now + age, max, ...(rotating ? [prior.token_hash, now] : []));
  const logged = await auditStatements(config,identity.actor,{entity:'session',entityId:identity.actor,action:rotating?'rotate':'sign-in',
    reason:rotating?'Refreshed authenticated session':'GitHub identity verified',after:{active:true}});
  const batch = [insert,...logged.statements,requireRow(db,'SELECT 1 FROM admin_sessions WHERE token_hash=?',hash)];
  if (prior) batch.push(db.prepare('DELETE FROM admin_sessions WHERE token_hash=? AND EXISTS (SELECT 1 FROM admin_sessions WHERE token_hash=?)').bind(prior.token_hash, hash));
  try {
    await db.batch(batch);
  } catch (error) {
    if (rotating && String(error.message).includes('freemcp_write_missing')) throw new AdminError(401, 'Session expired. Sign in again.');
    throw error;
  }
  return cookie(sessionName, raw, age);
}

export async function changeSession(config, session, action) {
  if (action === 'rotate') return redirect('/admin/settings/', [await issueSession(config, session, session, true)]);
  const db = config.db;
  const statement = action === 'revoke'
    ? db.prepare('DELETE FROM admin_sessions WHERE actor=? AND environment=?').bind(session.actor, config.mode)
    : db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(session.token_hash);
  const logged = await auditStatements(config,session.actor,{entity:'session',entityId:session.actor,action,
    reason:action==='revoke'?'Revoked all account sessions':'Signed out',after:{active:false}},false);
  const remaining = action === 'revoke'
    ? requireRow(db,'SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM admin_sessions WHERE actor=? AND environment=?)',session.actor,config.mode)
    : requireRow(db,'SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM admin_sessions WHERE token_hash=?)',session.token_hash);
  await db.batch([statement,remaining,...logged.statements]);
  return redirect('/admin/login/', [cookie(sessionName, '', 0)]);
}
