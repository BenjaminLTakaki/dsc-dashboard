# DSC Local Deployment Dashboard — Handoff Document

> Hand this file to a fresh Claude instance. It contains everything needed to continue the work without re-reading the conversation history.

---

## 1. What This Is

A browser-based dashboard that replaces the ~30 shell commands in `LOCAL.MD` with a GUI.
Users click "Run" (or "Configure & Run") on each step, see live responses, and build up session state (credentials, IDs) automatically.

**Location:** `doc/deployment-integration/local-deployment/dashboard/`

**Start it:**
```bash
cd doc/deployment-integration/local-deployment/dashboard
npm install          # only needed once — 3 deps: express, node-fetch v2, https-proxy-agent v5
node server.js       # listens on PORT env var, defaults to 5000
```
Then open `http://localhost:5000` (or the WSL2 IP if on Windows — see Section 9).

---

## 2. File Structure

```
dashboard/
├── package.json          # express ^4.18.2, https-proxy-agent ^5.0.1, node-fetch ^2.7.0
├── server.js             # Express backend (~305 lines)
├── public/
│   └── index.html        # Full SPA (~1800 lines, vanilla JS, no build step)
└── HANDOFF.md            # this file
```

---

## 3. Why a Node.js Backend (not pure browser JS)

Two things cannot be done from a browser:

1. **HTTPS through a squid proxy** — `fetch()` has no proxy support. The backend routes HTTPS calls through squid at `localhost:8888` inside K3s using `https-proxy-agent`. This is needed for Keycloak and VCVerifier which use self-signed `*.127.0.0.1.nip.io` certs.

2. **JWT signing with local private key** — The OID4VP flow needs to sign a VP JWT with `cert/private-key.pem`. The Node.js `crypto` module reads that file. Browsers cannot access the local filesystem.

Everything else (ODRL policies, NGSI-LD entities, TMForum calls) goes through the backend's generic `/api/proxy` or `/api/proxy-https` routes.

---

## 4. Server Routes (`server.js`)

| Route | Purpose |
|---|---|
| `GET /api/state` | Return in-memory session state object |
| `POST /api/state/update` | Merge `req.body` into state |
| `POST /api/state/reset` | Reset to empty state (see known issue below) |
| `POST /api/proxy` | Direct HTTP proxy to K3s port 8080 services |
| `POST /api/proxy-https` | HTTPS proxy through squid at `localhost:8888` |
| `POST /api/generate-did` | Runs `docker run quay.io/wi_stefan/did-helper:0.1.1`, reuses existing `cert/` |
| `POST /api/get-credential` | Full OID4VC 5-step flow against Keycloak |
| `POST /api/get-access-token` | Full OID4VP 3-step flow (reads `cert/did.json` + `cert/private-key.pem`) |

**Key constants in `server.js`:**
- `PROJECT_ROOT` = 4 levels up from `dashboard/` → resolves to the repo root
- `CERT_DIR` = `PROJECT_ROOT/cert/` — same location the shell scripts use
- `SQUID_PROXY` = `http://localhost:8888`
- `PORT` = `process.env.PORT || 5000`
- `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'` — set globally (needed for self-signed K3s certs)

---

## 5. Session State

The server keeps a single in-memory JS object reset on restart:
```js
{
  holderDid,                  // did:key:... — the holder's DID
  USER_CREDENTIAL,            // JWT — employee UserCredential
  REP_CREDENTIAL,             // JWT — representative UserCredential
  OPERATOR_CREDENTIAL,        // JWT — OperatorCredential
  FANCY_MARKETPLACE_ID,       // TMForum organization ID
  PRODUCT_SPEC_SMALL_ID,      // TMForum product spec ID
  PRODUCT_SPEC_FULL_ID,
  PRODUCT_OFFERING_SMALL_ID,  // TMForum product offering ID
  PRODUCT_OFFERING_FULL_ID,
  OFFER_ID,                   // The offering the customer will order
  ORDER_ID,                   // TMForum product order ID
}
```

The frontend syncs this on load (`GET /api/state`) and after every step that captures a value.

**Known issue — reset also clears holderDid:** When the user clicks "Reset State", `holderDid` is wiped even though the cert/ files on disk still exist. The server does re-read `cert/did.json` on the next `GET /api/state` call, but this is not obvious. Fix: exclude `holderDid` from reset, or re-read it immediately after reset. The `GET /api/state` handler already has logic to re-populate `holderDid` from disk if null.

---

## 6. Frontend Architecture (`public/index.html`)

Single HTML file, no build step, vanilla JS. Key sections:

### 6.1 Phase/Step data model

Each step is an object in the `STEPS` array:
```js
{
  id: '3-1',            // phase-step number, used as DOM id
  phase: 3,             // which sidebar phase this belongs to
  title: '...',
  desc: '...',
  endpoint: '...',      // shown as monospace label — informational only
  requires: ['holderDid', 'USER_CREDENTIAL'],  // state keys — shows warning if missing
  form: [               // OPTIONAL — if present, shows "Configure & Run" modal instead of "Run"
    { id: 'fieldId', label: 'Label', type: 'text'|'number'|'textarea', default: '...', hint: '...', required: true }
  ],
  run: async (formValues) => { ... return result; },  // throws on error, err.isWarning=true for soft warnings
}
```

### 6.2 Phases

8 phases + 1 custom assets page (phase 9):

| Phase | Steps | Description |
|---|---|---|
| 1 — Trust Anchor | 1-1 | Verify TIR has 2 issuers |
| 2 — Credentials | 2-1 to 2-4 | Generate DID, issue 3 VCs |
| 3 — Provider Setup | 3-1 to 3-3 | ODRL policy, NGSI-LD entity, 401 check |
| 4 — Authenticated Access | 4-1 | OID4VP token + read entity |
| 5 — Marketplace Policies | 5-1 to 5-4 | 4 ODRL policies for marketplace |
| 6 — Product Catalog | 6-1 to 6-4 | 2 product specs + 2 product offerings |
| 7 — Customer & Orders | 7-1 to 7-6 | Register org, browse, order, complete |
| 8 — Cluster Operations | 8-1 to 8-5 | OPERATOR token + K8SCluster CRUD |
| 9 — Custom Assets | — | Free-form NGSI-LD entity creator |

### 6.3 Error handling tiers

- `throw new Error(msg)` → red card, red badge "Error"
- `const err = new Error(msg); err.isWarning = true; throw err;` → yellow card "Warning" — used for PAP 500 (duplicate policy)
- Normal return → green "Success"

### 6.4 Activity Log

Right-side collapsible panel. Every `http()` / `https()` / `getCredential()` / `getAccessToken()` call logs method + status + URL path in real time.

### 6.5 Tooltip system

Every step has a `TOOLTIPS['step-id']` entry with `{ title, body, tags[] }`. Hovering the `?` button on each card shows a floating dark panel explaining the underlying technology.

### 6.6 Custom Assets page (phase 9)

Lets users define arbitrary NGSI-LD entity types with free-form key/value properties and POST them to Scorpio using the USER_CREDENTIAL access token.

---

## 7. Service URLs

All port 8080 unless noted. The squid proxy (HTTPS) is only needed for Keycloak and VCVerifier.

| Variable | URL | Protocol | Auth needed |
|---|---|---|---|
| `URL_BASE.TIR` | `http://tir.127.0.0.1.nip.io:8080` | HTTP | No |
| `URL_BASE.PAP` | `http://pap-provider.127.0.0.1.nip.io:8080` | HTTP | No (demo only) |
| `URL_BASE.SCORPIO` | `http://scorpio-provider.127.0.0.1.nip.io:8080` | HTTP | No (demo only) |
| `URL_BASE.DATA_SVC` | `http://mp-data-service.127.0.0.1.nip.io:8080` | HTTP | Bearer token (OID4VP) |
| `URL_BASE.TMF` | `http://tm-forum-api.127.0.0.1.nip.io:8080` | HTTP | No (admin API) |
| `URL_BASE.MP_TMF` | `http://mp-tmf-api.127.0.0.1.nip.io:8080` | HTTP | Bearer token (OID4VP) |
| Keycloak consumer | `https://keycloak-consumer.127.0.0.1.nip.io` | HTTPS via squid | Password grant |
| TIL (write TIR) | `http://til.127.0.0.1.nip.io:8080` | HTTP | No (demo only) |

---

## 8. Known Issues & Bugs

### 8.1 PAP returns 500 for duplicate policies (NOT a real error)
The ODRL-PAP service returns HTTP 500 (not 409) when you POST a policy whose `odrl:uid` already exists. This happens when the K3s deploy pre-seeds the policy, or when a step is run twice. All PAP policy steps (3-1, 5-1, 5-2, 5-3, 5-4) use `parsePapResult()` which converts 500 into a yellow warning. The demo can continue — the policy is in place.

**Root fix needed:** Make the policy UID configurable (step 3-1 form already has entityType but the `@id` and `odrl:uid` fields in the ODRL body are still partially hardcoded). Users should be able to fully customize the policy UID so they can run the demo multiple times cleanly. OR: implement a GET+DELETE+POST upsert pattern against the PAP.

### 8.2 Reset clears holderDid even though cert/ still exists on disk
`POST /api/state/reset` resets the full state object including `holderDid`. But the cert/ directory is on disk and isn't deleted. On the next `GET /api/state`, the server re-reads `cert/did.json` and repopulates `holderDid`. But the UI shows it as null briefly and requires a manual "Refresh State" click.

**Fix:** In `server.js`, after the reset, immediately re-read `cert/did.json` and set `state.holderDid` before returning. Or: exclude `holderDid` from the reset entirely since it's disk-backed.

### 8.3 Not all configurable fields are exposed in forms
Several steps have partially hardcoded values:
- ODRL policy UIDs (e.g. `https://mp-operation.org/policy/common/test`) — if two users run the demo at the same time or the deploy pre-seeds them, there will be PAP 500 collisions.
- Consumer DID (`did:web:fancy-marketplace.biz`) — hardcoded in `CONSUMER_DID` constant and in step 7-3 form default but not derived from TIR.
- Provider DID (`did:web:mp-operations.org`) — hardcoded in `PROVIDER_DID` constant.

**Fix needed:** Add a "Settings" panel (or config modal) that lets users set the provider/consumer DIDs and base URL prefix for policy UIDs before starting the demo.

### 8.4 Some steps re-acquire the access token on every run
Steps 8-2, 8-3, 8-4 each call `getAccessToken()` independently. This means 3 separate OID4VP flows for steps that run close together. Consider caching the token with a TTL.

---

## 9. WSL2 / Windows Access

The server runs inside WSL2. From a Windows browser, access via the WSL2 IP:
```powershell
# In PowerShell (run as admin):
$wslIp = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenport=5000 listenaddress=0.0.0.0 connectport=5000 connectaddress=$wslIp
netsh advfirewall firewall add rule name="WSL2 Port 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
```
Then browse to `http://<windows-machine-ip>:5000`.

---

## 10. The User's Vision — What Needs to Be Built Next

The user wants this to be a **production-quality demo** of a real dataspace, not just a script runner. Here is their stated intent:

### 10.1 Truly configurable setup — no hardcoded values
Every company name, DID, policy UID, entity type, and credential type should be a user input. The demo should be replayable without needing to redeploy K3s. Specifically:
- "Settings" step or panel where user sets: provider org name, consumer org name, provider DID, consumer DID
- Policy UIDs auto-derived from org names so they don't collide on re-run
- Entity IDs auto-generated or user-chosen

### 10.2 Proper Marketplace UI
The user wants a real marketplace experience inside the dashboard, not just API call buttons. This means:
- A "marketplace" view that shows product offerings as cards (name, description, price placeholder)
- A "browse as customer" mode where the user acts as the consumer: browses offerings, registers their org, places orders
- A "manage as provider" mode where the user acts as the provider: creates offerings, sees incoming orders, completes them
- Login/signup concept: the user should "log in" as either the provider or consumer role, and the UI changes accordingly
- Data transfer visualization: after the order is complete, actually show the data flowing — list the K8SClusters the consumer created

### 10.3 Logging and audit trail
The activity log (already built) should be expanded:
- Show request/response bodies (expandable)
- Persist across page refreshes (write to server-side log file or localStorage)
- Show timestamps and step context ("Running step 7-3: Register Organization")

### 10.4 Real data / custom assets
The user wants to be able to add their own NGSI-LD entity types with custom schemas, not just EnergyReport. The custom assets page (phase 9) is started but needs:
- Ability to define a schema/template for an entity type
- List all existing entities of a given type (GET /ngsi-ld/v1/entities?type=X)
- Update and delete entities
- Show the data as formatted cards, not just raw JSON

### 10.5 Provider-side data exposure flow
Currently the demo only shows the provider pre-creating data (EnergyReport). The full vision is:
- Provider adds their own real assets (sensor data, cluster configs, whatever)
- Consumer browses what's available after authentication
- Consumer sees the actual data after ordering, showing real data transfer

---

## 11. The Dataspace Technology Stack (for context)

Understanding these is essential for correct API calls and error diagnosis:

| Component | Role | URL |
|---|---|---|
| **TIR** (Trusted Issuers Registry) | Lists orgs trusted to issue VCs. Read-only at runtime. | `http://tir.../v4/issuers` |
| **TIL** (Trusted Issuers List) | Write API for TIR. Contract Management uses this to register the consumer after order. | `http://til.../v4/issuers` |
| **Keycloak** | Issues Verifiable Credentials (VCs) as JWTs via OID4VC protocol. One instance per participant. | `https://keycloak-consumer...` |
| **VCVerifier** | Validates VP JWTs presented by holders, issues short-lived access tokens. | `https://provider-verifier...` |
| **APISIX** | API gateway in front of Scorpio/data service. Validates Bearer tokens from VCVerifier. | `http://mp-data-service...` |
| **OPA** | Policy Decision Point. Evaluates ODRL policies stored in PAP against each request. | Internal only |
| **PAP** | Policy Administration Point. CRUD for ODRL policies. | `http://pap-provider...` |
| **Scorpio** | NGSI-LD Context Broker. Stores entity data. Direct URL exposed for demo. | `http://scorpio-provider...` |
| **TMForum APIs** | Product catalog, ordering, party management. Admin URL (no auth) + marketplace URL (Bearer token). | `http://tm-forum-api...` / `http://mp-tmf-api...` |
| **Contract Management** | Listens to TMForum order events. On order completion: (1) registers consumer DID in TIR, (2) creates ODRL policy from product spec's policyConfig characteristic. | Internal only |

### OID4VC Flow (credential issuance — Keycloak)
```
1. POST /realms/test-realm/protocol/openid-connect/token  (grant_type=password) → access_token
2. GET  /realms/test-realm/protocol/oid4vc/credential-offer-uri?credential_configuration_id=X → {issuer, nonce}
3. GET  issuer+nonce → {grants: {"urn:...pre-authorized_code": {"pre-authorized_code": "..."}}}
4. POST /realms/test-realm/protocol/openid-connect/token  (grant_type=pre-authorized_code) → credAccessToken
5. POST /realms/test-realm/protocol/oid4vc/credential     (credential_identifier=X, format=jwt_vc) → {credential: "eyJ..."}
```

### OID4VP Flow (token exchange — VCVerifier)
```
1. GET  http://mp-data-service.../..well-known/openid-configuration → {token_endpoint}
2. Build signed VP JWT: header.payload signed with EC P-256 private key (DER format via crypto.sign)
   - header: {"alg":"ES256","typ":"JWT","kid":holderDid}
   - payload: {"iss":holderDid,"sub":holderDid,"vp":{"@context":...,"verifiableCredential":[credential],"holder":holderDid}}
3. POST token_endpoint (grant_type=vp_token, vp_token=<jwt>, scope=<scope>) → {access_token}
```

---

## 12. ODRL Policy Structure (for PAP)

All PAP policies follow this JSON-LD structure:
```json
{
  "@context": { "odrl": "http://www.w3.org/ns/odrl/2/", ... },
  "@id": "https://mp-operation.org/policy/common/<uid>",
  "odrl:uid": "https://mp-operation.org/policy/common/<uid>",
  "@type": "odrl:Policy",
  "odrl:permission": {
    "odrl:assigner": { "@id": "https://www.mp-operation.org/" },
    "odrl:target": {
      "@type": "odrl:AssetCollection",
      "odrl:source": "urn:asset",
      "odrl:refinement": [
        {
          "@type": "odrl:Constraint",
          "odrl:leftOperand": "ngsi-ld:entityType",   // OR "tmf:resource"
          "odrl:operator": { "@id": "odrl:eq" },
          "odrl:rightOperand": "EnergyReport"          // entity type or TMF resource name
        }
      ]
    },
    "odrl:assignee": { "@id": "vc:any" },              // OR PartyCollection with role constraint
    "odrl:action": { "@id": "odrl:read" }              // OR "tmf:create"
  }
}
```

**The `odrl:uid` must be globally unique per PAP instance.** If you POST a policy with a uid that already exists, the PAP returns 500. There is no PUT/upsert endpoint.

---

## 13. Credential Types in the Demo

| Keycloak username | Credential type | Role in credential | Used for |
|---|---|---|---|
| `employee` | `user-credential` (UserCredential) | none / basic | Reading EnergyReport (Phase 4) |
| `representative` | `user-credential` (UserCredential) | REPRESENTATIVE | Self-registration + ordering (Phase 7) |
| `operator` | `operator-credential` (OperatorCredential) | OPERATOR | Creating K8SClusters (Phase 8) |

Credentials are issued by `keycloak-consumer` (the consumer's Keycloak).
All OID4VC calls go through the squid proxy (HTTPS, self-signed cert).

---

## 14. The `cert/` Directory

Created at repo root by `docker run quay.io/wi_stefan/did-helper:0.1.1` (step 2-1).
Contents used by the server:
- `cert/did.json` → `{ "id": "did:key:z6Mk...", ... }` — the holder DID
- `cert/private-key.pem` → EC P-256 private key (PKCS#8 PEM format)
- `cert/public-key.pem` → public key
- `cert/cert.pem` → self-signed cert

The `private-key.pem` is chmod'd to 644 by the generate-did route so Node.js can read it.
The server re-reads `cert/did.json` on every `GET /api/state` if `state.holderDid` is null.

---

## 15. Immediate Next Development Priorities

In order of importance based on the user's stated goals:

### Priority 1 — Fix reset behavior for holderDid
In `server.js`, change `POST /api/state/reset` to:
```js
app.post('/api/state/reset', (req, res) => {
  state = makeEmptyState();
  // Re-read holderDid from disk immediately
  const didPath = path.join(CERT_DIR, 'did.json');
  if (fs.existsSync(didPath)) {
    try { state.holderDid = JSON.parse(fs.readFileSync(didPath, 'utf8')).id; } catch {}
  }
  res.json({ ok: true });
});
```

### Priority 2 — Configurable policy UIDs (solve PAP 500 cleanly)
Add a `policyUid` field to step 3-1's form (like 6-1 and 6-2 already do). Update `makeEnergyPolicy()` to accept a uid parameter. Optionally, implement a GET-first-then-skip pattern:
```js
// Check if policy exists first
const existing = await http('GET', `${URL_BASE.PAP}/policy`);
const uids = (existing.body || []).map(p => p['odrl:uid'] || p['@id']);
if (uids.includes(policyUid)) return { ok: true, note: 'Policy already exists, skipping.' };
// Otherwise POST
```
(Check what the PAP's GET /policy endpoint returns — it may list all policies.)

### Priority 3 — Role-based "persona" switching
Add a top-level "I am the: [Provider] [Consumer]" toggle that:
- As Provider: shows phases 1, 3, 5, 6 (setup tasks)
- As Consumer: shows phases 2, 4, 7, 8 (consumer tasks)
- Both personas show phases 1-8 if "Full Demo" is selected

### Priority 4 — Marketplace UI view
Add a new sidebar section "Marketplace" that:
- Lists product offerings as cards (fetches from MP_TMF with REP token)
- Each card has: name, description, "Order" button
- Clicking Order runs the 7-3 → 7-4 → 7-5 → 7-6 flow automatically
- After completion, shows a "Your Assets" panel with the K8SClusters the operator created

### Priority 5 — Settings panel
A collapsible settings section (or a modal accessible from the header) where users can set:
- Provider organization name and DID
- Consumer organization name and DID
- Policy UID prefix (default `https://mp-operation.org/policy/common/`)
- Data service base URL (in case of non-default deployment)

Store these in localStorage so they survive page refresh.

---

## 16. Code Patterns to Follow

**Adding a new step with a form:**
```js
{
  id: 'X-Y', phase: X,
  title: 'Human-readable title',
  desc: 'One sentence description shown in the card.',
  endpoint: 'METHOD http://service.../path — shown as label',
  requires: ['SESSION_KEY_1'],   // keys that must be non-null in S before running
  form: [
    { id: 'fieldName', label: 'Field Label', type: 'text', default: 'DefaultValue', hint: 'Helper text below input', required: true },
  ],
  run: async (f) => {
    // f.fieldName is the value from the form
    const res = await http('POST', `${URL_BASE.TMF}/some/path`, { key: f.fieldName }, { 'Content-Type': 'application/json' });
    if (!res.body?.id) throw new Error(`Failed. Status: ${res.status}`);
    await saveState({ MY_ID: res.body.id });
    return { id: res.body.id };
  },
},
```

**Adding a tooltip for the new step:**
```js
TOOLTIPS['X-Y'] = {
  title: 'Concept name',
  body: '2-3 sentence explanation of what this step does and why.',
  tags: ['Tag1', 'Tag2'],
};
```

**Adding a soft warning (not red error):**
```js
const err = new Error('Human-readable warning message');
err.isWarning = true;
throw err;
```

---

## 17. Running the Demo End-to-End (happy path)

Assuming a fresh K3s deploy (`mvn clean deploy -Plocal`):

1. Phase 1: Run 1-1 → should show 2 issuers
2. Phase 2: Run 2-1 (generates DID), then 2-2, 2-3, 2-4 (issues 3 credentials)
3. Phase 3: Run 3-1 (PAP policy — may 500-warn if pre-seeded, that's ok), 3-2 (create entity), 3-3 (verify 401)
4. Phase 4: Run 4-1 → should return 200 with EnergyReport entity (if 403, wait 5s and retry)
5. Phase 5: Run 5-1 through 5-4 (all PAP policies — may 500-warn, that's ok)
6. Phase 6: Run 6-1, 6-2 (product specs), then 6-3, 6-4 (product offerings)
7. Phase 7: Run 7-1 (pre-check 403), 7-2 (pre-check null token), 7-3 (register org), 7-4 (list offerings), 7-5 (place order), 7-6 (complete order)
8. Wait 3 seconds
9. Phase 8: Run 8-1 (get OPERATOR token — should now work), 8-2 (create 3-node cluster), 8-3 (create 4-node cluster), 8-4 (list all clusters), 8-5 (verify 403 with USER token)

Total time: ~5 minutes of clicking. All 24 steps complete.

---

## 18. Repo Context

- **Repo root:** `/home/benta/workspace/data-space-connector`
- **Full walkthrough:** `doc/deployment-integration/local-deployment/LOCAL.MD`
- **Test resources (ODRL policy examples):** `doc/deployment-integration/it/src/test/resources/policies/`
- **K3s deploy command:** `mvn clean deploy -Plocal` (from repo root, takes 5-10 min)
- **Cluster config:** `target/k3s.yaml` (after deploy)
- **Git branch:** `main`

---

## 19. npm Dependencies (pinned for compatibility)

```json
{
  "express": "^4.18.2",
  "https-proxy-agent": "^5.0.1",
  "node-fetch": "^2.7.0"
}
```

**Do not upgrade `https-proxy-agent` to v6+ or `node-fetch` to v3+** — both changed to ESM-only which breaks CommonJS `require()`. The server uses CJS (`'use strict'` + `require()`).

Node.js >= 16 required (uses `crypto.sign()` API).
