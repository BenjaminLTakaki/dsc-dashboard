'use strict';

// Load .env if present — do this first so all process.env reads below pick up values
try { require('dotenv').config(); } catch (_) { /* dotenv is optional */ }

// Disable TLS verification globally — required for self-signed *.127.0.0.1.nip.io certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execSync } = require('child_process');
const crypto       = require('crypto');
const fetch        = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app  = express();
const PORT = process.env.PORT || 5000;

// Squid proxy inside K3s — needed for Keycloak + VCVerifier (HTTPS, self-signed certs).
// Set SQUID_PROXY='' to bypass (direct HTTPS — TLS check is already disabled above).
const SQUID_PROXY = process.env.SQUID_PROXY !== undefined
  ? process.env.SQUID_PROXY
  : 'http://localhost:8888';

// Root of the data-space-connector repository.
// Default: dsc-dashboard/ and data-space-connector/ are expected to be siblings,
// i.e. both live inside the same parent folder (e.g. g:\FinalFiware\).
// Override with PROJECT_ROOT env var if your layout is different.
const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', 'data-space-connector');

// Directory that holds did.json + private-key.pem (produced by the did-helper step).
// Override with CERT_DIR env var if you place the cert files elsewhere.
const CERT_DIR = process.env.CERT_DIR || path.join(PROJECT_ROOT, 'cert');

// ─────────────────────────────────────────────────────────────────────────────
// Startup validation — warn early about common misconfiguration
// ─────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(PROJECT_ROOT)) {
  console.warn(`\n⚠  WARNING: PROJECT_ROOT does not exist: ${PROJECT_ROOT}`);
  console.warn('   Set the PROJECT_ROOT env var (or add it to .env) to point at');
  console.warn('   the root of your data-space-connector repository.\n');
}

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// Session state  (in-memory; survives UI refreshes, resets on server restart)
// ─────────────────────────────────────────────────────────────────────────────
function makeEmptyState() {
  return {
    holderDid:                 null,
    USER_CREDENTIAL:           null,
    REP_CREDENTIAL:            null,
    OPERATOR_CREDENTIAL:       null,
    FANCY_MARKETPLACE_ID:      null,
    PRODUCT_SPEC_SMALL_ID:     null,
    PRODUCT_SPEC_FULL_ID:      null,
    PRODUCT_OFFERING_SMALL_ID: null,
    PRODUCT_OFFERING_FULL_ID:  null,
    OFFER_ID:                  null,
    ORDER_ID:                  null,
    // Arbitrary label→JWT map for multi-participant credential storage
    extraCredentials: {},
  };
}

function readDidFromDisk() {
  const p = path.join(CERT_DIR, 'did.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).id || null; } catch { return null; }
}

let state = makeEmptyState();

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
const proxyAgent = SQUID_PROXY ? new HttpsProxyAgent(SQUID_PROXY) : null;

async function doRequest({ method = 'GET', url, headers = {}, body, formData, useProxy = false }) {
  const opts = {
    method,
    headers: { ...headers },
    ...(useProxy && proxyAgent ? { agent: proxyAgent } : {}),
  };

  if (formData) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(formData).toString();
  } else if (body !== undefined && body !== null) {
    if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res  = await fetch(url, opts);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, ok: res.ok };
}

// Base64url (matches `openssl base64 -A | tr '+/' '-_' | tr -d '='`)
function b64u(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Wrap any route handler: catch thrown errors and respond as JSON
function apiRoute(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  // Lazily repopulate holderDid from disk if absent (e.g. after a page refresh)
  if (!state.holderDid) state.holderDid = readDidFromDisk();
  res.json(state);
});

app.post('/api/state/reset', (req, res) => {
  state = makeEmptyState();
  // Re-read holderDid immediately so the UI never shows it as null after reset
  state.holderDid = readDidFromDisk();
  res.json({ ok: true });
});

app.post('/api/state/update', (req, res) => {
  Object.assign(state, req.body);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic proxies  (browser cannot call Keycloak/VCVerifier directly — CORS + proxy)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/proxy',       apiRoute(async (req, res) => res.json(await doRequest({ ...req.body, useProxy: false }))));
app.post('/api/proxy-https', apiRoute(async (req, res) => res.json(await doRequest({ ...req.body, useProxy: true  }))));

// ─────────────────────────────────────────────────────────────────────────────
// Health check — pings all services with a 5 s timeout
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', apiRoute(async (req, res) => {
  const q = req.query;
  const checks = [
    { key: 'TIR',      url: (q.tirUrl     || 'http://tir.127.0.0.1.nip.io:8080')              + '/v4/issuers?pageSize=1' },
    { key: 'TIL',      url: (q.tilUrl     || 'http://til.127.0.0.1.nip.io:8080')              + '/v4/issuers?pageSize=1' },
    { key: 'PAP',      url: (q.papUrl     || 'http://pap-provider.127.0.0.1.nip.io:8080')     + '/policy' },
    { key: 'Scorpio',  url: (q.scorpioUrl || 'http://scorpio-provider.127.0.0.1.nip.io:8080') + '/ngsi-ld/v1/entities?pageSize=1' },
    { key: 'TMForum',  url: (q.tmfUrl     || 'http://tm-forum-api.127.0.0.1.nip.io:8080')     + '/tmf-api/productCatalogManagement/v4/productOffering?pageSize=1' },
    { key: 'MP-TMF',   url: (q.mpTmfUrl   || 'http://mp-tmf-api.127.0.0.1.nip.io:8080')      + '/tmf-api/productCatalogManagement/v4/productOffering?pageSize=1' },
    { key: 'DataSvc',  url: (q.dataSvcUrl || 'http://mp-data-service.127.0.0.1.nip.io:8080') + '/.well-known/openid-configuration' },
    { key: 'Keycloak', url: (q.keycloakUrl || 'https://keycloak-consumer.127.0.0.1.nip.io')   + '/realms/test-realm/.well-known/openid-configuration', useProxy: true },
  ];

  const results = await Promise.all(checks.map(async c => {
    const t0 = Date.now();
    try {
      const r = await Promise.race([
        doRequest({ url: c.url, useProxy: c.useProxy || false }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      return { key: c.key, url: c.url, up: r.status < 500, status: r.status, ms: Date.now() - t0 };
    } catch (err) {
      return { key: c.key, url: c.url, up: false, status: 0, ms: Date.now() - t0, error: err.message };
    }
  }));
  res.json(results);
}));

// ─────────────────────────────────────────────────────────────────────────────
// TIR — read issuers
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/tir/issuers', apiRoute(async (req, res) => {
  const { tirUrl = 'http://tir.127.0.0.1.nip.io:8080', page = 0, pageSize = 100 } = req.query;
  res.json(await doRequest({ url: `${tirUrl}/v4/issuers?page=${page}&pageSize=${pageSize}` }));
}));

// ─────────────────────────────────────────────────────────────────────────────
// TIL — register / update issuer (admin write API)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/til/register', apiRoute(async (req, res) => {
  const { tilUrl = 'http://til.127.0.0.1.nip.io:8080', ...body } = req.body;
  res.json(await doRequest({
    method: 'POST', url: `${tilUrl}/v4/issuers`,
    body, headers: { 'Content-Type': 'application/json' },
  }));
}));

app.put('/api/til/register', apiRoute(async (req, res) => {
  const { tilUrl = 'http://til.127.0.0.1.nip.io:8080', did, ...body } = req.body;
  if (!did) return res.status(400).json({ ok: false, error: 'did is required' });
  res.json(await doRequest({
    method: 'PUT', url: `${tilUrl}/v4/issuers/${encodeURIComponent(did)}`,
    body, headers: { 'Content-Type': 'application/json' },
  }));
}));

// ─────────────────────────────────────────────────────────────────────────────
// PAP — policy CRUD
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/pap/policies', apiRoute(async (req, res) => {
  const { papUrl = 'http://pap-provider.127.0.0.1.nip.io:8080' } = req.query;
  res.json(await doRequest({ url: `${papUrl}/policy` }));
}));

// Create a new ODRL policy.
// Accepts the full ODRL JSON body in req.body.policy (or req.body directly).
// Upsert mode (req.body.upsert=true): checks if a policy with the same odrl:uid
// already exists and skips the POST if so — avoids PAP 500 on re-run.
app.post('/api/pap/policies', apiRoute(async (req, res) => {
  const { papUrl = 'http://pap-provider.127.0.0.1.nip.io:8080', upsert = false, ...rest } = req.body;
  // Policy body may arrive under a "policy" key or directly as the whole body
  const policy = rest.policy || rest;

  if (upsert) {
    const existing = await doRequest({ url: `${papUrl}/policy` });
    const uids = Array.isArray(existing.body)
      ? existing.body.map(p => p['odrl:uid'] || p['@id']).filter(Boolean)
      : [];
    const incomingUid = policy['odrl:uid'] || policy['@id'];
    if (incomingUid && uids.includes(incomingUid)) {
      return res.json({ ok: true, skipped: true, note: 'Policy already exists — skipped (upsert mode).' });
    }
  }

  res.json(await doRequest({
    method: 'POST', url: `${papUrl}/policy`,
    body: policy, headers: { 'Content-Type': 'application/json' },
  }));
}));

// uid must be URL-encoded because policy UIDs contain slashes
app.delete('/api/pap/policies', apiRoute(async (req, res) => {
  const { papUrl = 'http://pap-provider.127.0.0.1.nip.io:8080', uid } = req.query;
  if (!uid) return res.status(400).json({ ok: false, error: 'uid query param is required' });
  res.json(await doRequest({ method: 'DELETE', url: `${papUrl}/policy/${encodeURIComponent(uid)}` }));
}));

// ─────────────────────────────────────────────────────────────────────────────
// NGSI-LD entity CRUD (Scorpio)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/ngsi/entities', apiRoute(async (req, res) => {
  const { scorpioUrl = 'http://scorpio-provider.127.0.0.1.nip.io:8080', type, pageSize = 50, page = 0 } = req.query;
  const params = new URLSearchParams({ count: 'true', pageSize, page });
  if (type) params.set('type', type);
  res.json(await doRequest({ url: `${scorpioUrl}/ngsi-ld/v1/entities?${params}` }));
}));

app.post('/api/ngsi/entities', apiRoute(async (req, res) => {
  const { scorpioUrl = 'http://scorpio-provider.127.0.0.1.nip.io:8080', ...body } = req.body;
  res.json(await doRequest({
    method: 'POST',
    url: `${scorpioUrl}/ngsi-ld/v1/entities`,
    body,
    headers: { 'Content-Type': 'application/ld+json' },
  }));
}));

app.delete('/api/ngsi/entities', apiRoute(async (req, res) => {
  const { scorpioUrl = 'http://scorpio-provider.127.0.0.1.nip.io:8080', id } = req.query;
  if (!id) return res.status(400).json({ ok: false, error: 'id query param is required' });
  res.json(await doRequest({ method: 'DELETE', url: `${scorpioUrl}/ngsi-ld/v1/entities/${encodeURIComponent(id)}` }));
}));

app.patch('/api/ngsi/entities', apiRoute(async (req, res) => {
  const { scorpioUrl = 'http://scorpio-provider.127.0.0.1.nip.io:8080', id } = req.body;
  if (!id) return res.status(400).json({ ok: false, error: 'id is required in request body' });
  const { id: _id, scorpioUrl: _url, ...attrs } = req.body;
  res.json(await doRequest({
    method: 'PATCH',
    url: `${scorpioUrl}/ngsi-ld/v1/entities/${encodeURIComponent(id)}/attrs`,
    body: attrs,
    headers: { 'Content-Type': 'application/json' },
  }));
}));

// ─────────────────────────────────────────────────────────────────────────────
// TMForum resource helpers  (admin URL — no auth required)
// ─────────────────────────────────────────────────────────────────────────────
function tmfHandler(method, apiPath) {
  return apiRoute(async (req, res) => {
    const { tmfUrl = 'http://tm-forum-api.127.0.0.1.nip.io:8080', id } = req.query;
    const url = `${tmfUrl}/tmf-api/${apiPath}${id ? '/' + id : ''}`;
    const hasBody = method === 'PATCH' || method === 'POST';
    res.json(await doRequest({
      method, url,
      body:    hasBody ? req.body : undefined,
      headers: hasBody ? { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json;charset=utf-8' } : {},
    }));
  });
}

app.get   ('/api/tmf/productSpecification', tmfHandler('GET',    'productCatalogManagement/v4/productSpecification'));
app.post  ('/api/tmf/productSpecification', tmfHandler('POST',   'productCatalogManagement/v4/productSpecification'));
app.delete('/api/tmf/productSpecification', tmfHandler('DELETE', 'productCatalogManagement/v4/productSpecification'));
app.get   ('/api/tmf/productOffering',      tmfHandler('GET',    'productCatalogManagement/v4/productOffering'));
app.post  ('/api/tmf/productOffering',      tmfHandler('POST',   'productCatalogManagement/v4/productOffering'));
app.delete('/api/tmf/productOffering',      tmfHandler('DELETE', 'productCatalogManagement/v4/productOffering'));
app.get   ('/api/tmf/productOrder',         tmfHandler('GET',    'productOrderingManagement/v4/productOrder'));
app.patch ('/api/tmf/productOrder',         tmfHandler('PATCH',  'productOrderingManagement/v4/productOrder'));
app.get   ('/api/tmf/organization',         tmfHandler('GET',    'party/v4/organization'));
app.delete('/api/tmf/organization',         tmfHandler('DELETE', 'party/v4/organization'));

// ─────────────────────────────────────────────────────────────────────────────
// DID generation  (runs the did-helper Docker container; reuses existing cert/)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/generate-did', (req, res) => {
  const certDir = req.body?.certDir ? path.resolve(String(req.body.certDir)) : CERT_DIR;
  try {
    const didPath = path.join(certDir, 'did.json');

    if (fs.existsSync(didPath)) {
      const did = JSON.parse(fs.readFileSync(didPath, 'utf8')).id;
      if (!req.body?.certDir) state.holderDid = did;
      return res.json({ ok: true, holderDid: did, source: 'existing', certDir });
    }

    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

    execSync(
      `docker run --rm -v "${certDir}:/cert" quay.io/wi_stefan/did-helper:0.1.1`,
      { timeout: 120_000, stdio: 'pipe' },
    );

    const pk = path.join(certDir, 'private-key.pem');
    if (fs.existsSync(pk)) fs.chmodSync(pk, 0o644);

    const did = JSON.parse(fs.readFileSync(didPath, 'utf8')).id;
    if (!req.body?.certDir) state.holderDid = did;
    res.json({ ok: true, holderDid: did, source: 'generated', certDir });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OID4VC — credential issuance via Keycloak (pre-authorized-code flow, 5 steps)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/get-credential', apiRoute(async (req, res) => {
  const {
    credentialType,
    username,
    keycloakUrl = 'https://keycloak-consumer.127.0.0.1.nip.io',
    realm       = 'test-realm',
    clientId    = 'account-console',
    password    = 'test',
    stateKey,   // optional: persist the resulting JWT under this session-state key
  } = req.body;

  if (!credentialType) return res.status(400).json({ ok: false, error: 'credentialType is required' });
  if (!username)       return res.status(400).json({ ok: false, error: 'username is required' });

  const KC = keycloakUrl.replace(/\/$/, '');

  // Step 1 — resource-owner password grant → short-lived access token
  const s1 = await doRequest({
    method:   'POST',
    url:      `${KC}/realms/${realm}/protocol/openid-connect/token`,
    formData: { grant_type: 'password', client_id: clientId, username, scope: 'openid', password },
    useProxy: true,
  });
  if (!s1.body?.access_token)
    return res.status(400).json({ ok: false, error: 'Step 1 (password grant) failed', detail: s1.body });

  // Step 2 — get credential-offer URI
  const s2 = await doRequest({
    url:      `${KC}/realms/${realm}/protocol/oid4vc/credential-offer-uri?credential_configuration_id=${credentialType}`,
    headers:  { Authorization: `Bearer ${s1.body.access_token}` },
    useProxy: true,
  });
  const offerUri = s2.body?.issuer + s2.body?.nonce;

  // Step 3 — resolve offer → pre-authorized_code
  const s3 = await doRequest({
    url:      offerUri,
    headers:  { Authorization: `Bearer ${s1.body.access_token}` },
    useProxy: true,
  });
  const preAuthCode = s3.body?.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'];
  if (!preAuthCode)
    return res.status(400).json({ ok: false, error: 'Step 3 (pre-auth code) failed', detail: s3.body });

  // Step 4 — exchange pre-auth code → credential access token
  const s4 = await doRequest({
    method:   'POST',
    url:      `${KC}/realms/${realm}/protocol/openid-connect/token`,
    formData: { grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code', 'pre-authorized_code': preAuthCode },
    useProxy: true,
  });
  if (!s4.body?.access_token)
    return res.status(400).json({ ok: false, error: 'Step 4 (cred access token) failed', detail: s4.body });

  // Step 5 — fetch the VC JWT
  const s5 = await doRequest({
    method:  'POST',
    url:     `${KC}/realms/${realm}/protocol/oid4vc/credential`,
    headers: { Authorization: `Bearer ${s4.body.access_token}` },
    body:    { credential_identifier: credentialType, format: 'jwt_vc' },
    useProxy: true,
  });
  const credential = s5.body?.credential;
  if (!credential)
    return res.status(400).json({
      ok: false,
      error: 'Step 5 returned null credential. The Keycloak realm may need a redeploy (mvn clean deploy -Plocal).',
      detail: s5.body,
    });

  // Persist in session state under well-known keys + optional custom key
  if (credentialType === 'user-credential'    && username === 'employee')       state.USER_CREDENTIAL     = credential;
  if (credentialType === 'user-credential'    && username === 'representative') state.REP_CREDENTIAL      = credential;
  if (credentialType === 'operator-credential')                                 state.OPERATOR_CREDENTIAL = credential;
  if (stateKey) state[stateKey] = credential;

  res.json({ ok: true, credential });
}));

// ─────────────────────────────────────────────────────────────────────────────
// OID4VP — VP token exchange → Bearer access token (3-step flow)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/get-access-token', apiRoute(async (req, res) => {
  const {
    credential,
    scope,
    dataSvcUrl = 'http://mp-data-service.127.0.0.1.nip.io:8080',
    certDir,   // optional: use a different cert directory (multi-participant)
  } = req.body;

  if (!credential) return res.status(400).json({ ok: false, error: 'credential is required' });

  // Step 1 — discover token endpoint from .well-known
  const wk = await doRequest({ url: `${dataSvcUrl}/.well-known/openid-configuration` });
  const tokenEndpoint = wk.body?.token_endpoint;
  if (!tokenEndpoint)
    return res.status(400).json({ ok: false, error: 'token_endpoint not found in .well-known', detail: wk.body });

  // Step 2 — build and sign a VP JWT using the holder's EC P-256 private key
  const effectiveCertDir = certDir ? path.resolve(String(certDir)) : CERT_DIR;
  const didJson    = JSON.parse(fs.readFileSync(path.join(effectiveCertDir, 'did.json'), 'utf8'));
  const holderDid  = didJson.id;
  const privKeyPem = fs.readFileSync(path.join(effectiveCertDir, 'private-key.pem'), 'utf8');

  const vp = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiablePresentation'],
    verifiableCredential: [credential],
    holder: holderDid,
  };

  const hdr = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: holderDid }));
  const pay = b64u(JSON.stringify({ iss: holderDid, sub: holderDid, vp }));
  const sig = crypto.sign('sha256', Buffer.from(`${hdr}.${pay}`), privKeyPem);
  const jwt = `${hdr}.${pay}.${b64u(sig)}`;

  // Step 3 — exchange VP for access token
  const tokenRes = await doRequest({
    method: 'POST', url: tokenEndpoint,
    formData: { grant_type: 'vp_token', vp_token: jwt, scope },
    useProxy: true,
  });

  res.json({ ok: true, accessToken: tokenRes.body?.access_token ?? null, tokenEndpoint });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Config introspection endpoint — lets the UI show resolved paths
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    port:        PORT,
    projectRoot: PROJECT_ROOT,
    certDir:     CERT_DIR,
    squidProxy:  SQUID_PROXY,
    certDirExists:    fs.existsSync(CERT_DIR),
    projectRootExists: fs.existsSync(PROJECT_ROOT),
    hasDid:      fs.existsSync(path.join(CERT_DIR, 'did.json')),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\nFIWARE DSC Dashboard');
  console.log('─'.repeat(50));
  console.log(`  URL:               http://localhost:${PORT}`);
  console.log(`  Project root:      ${PROJECT_ROOT}  ${fs.existsSync(PROJECT_ROOT) ? '✓' : '✗ NOT FOUND'}`);
  console.log(`  Cert dir:          ${CERT_DIR}  ${fs.existsSync(CERT_DIR) ? '✓' : '(will be created by Generate DID)'}`);
  console.log(`  Squid proxy:       ${SQUID_PROXY || '(disabled)'}`);
  console.log('─'.repeat(50));
  console.log('\nRoutes:');
  console.log('  GET    /api/health           GET    /api/config');
  console.log('  GET    /api/state            POST   /api/state/update   POST /api/state/reset');
  console.log('  GET    /api/tir/issuers      POST/PUT /api/til/register');
  console.log('  GET/POST/DELETE /api/pap/policies');
  console.log('  GET/POST/DELETE/PATCH /api/ngsi/entities');
  console.log('  GET/POST/DELETE /api/tmf/{productSpecification|productOffering}');
  console.log('  GET/PATCH /api/tmf/productOrder');
  console.log('  GET/DELETE /api/tmf/organization');
  console.log('  POST /api/get-credential     POST /api/get-access-token');
  console.log('  POST /api/generate-did');
  console.log('  POST /api/proxy              POST /api/proxy-https\n');
});
