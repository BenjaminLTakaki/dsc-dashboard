# Dashboard TODO
> Last updated: 2026-04-20  
> Location: `doc/deployment-integration/local-deployment/dashboard/`  
> Start: `node server.js` — requires K3s cluster running (`mvn clean deploy -Plocal`)

---

## ✅ Done (this session)

### Backend (`server.js`)
- [x] Generic `apiRoute()` wrapper — consistent error handling on all routes
- [x] `GET /api/health` — pings TIR, TIL, PAP, Scorpio, TMForum, MP-TMF, DataSvc with 5s timeout
- [x] `GET /api/tir/issuers` — paginated TIR issuer listing
- [x] `POST /api/til/register` — register new participant DID into TIL
- [x] `PUT  /api/til/register` — update existing TIL issuer entry
- [x] `GET  /api/pap/policies` — list all PAP ODRL policies
- [x] `DELETE /api/pap/policies?uid=` — delete a policy by UID (fixes PAP 500 re-run collisions)
- [x] `GET  /api/ngsi/entities` — list Scorpio entities with type filter + pagination
- [x] `DELETE /api/ngsi/entities?id=` — delete a Scorpio entity
- [x] `PATCH /api/ngsi/entities?id=` — update a Scorpio entity's attributes
- [x] `GET|DELETE /api/tmf/productSpecification` — product spec list + delete
- [x] `GET|DELETE /api/tmf/productOffering` — product offering list + delete
- [x] `GET|PATCH /api/tmf/productOrder` — order list + complete/cancel
- [x] `GET|DELETE /api/tmf/organization` — org list + delete
- [x] `POST /api/get-credential` — fully configurable OID4VC (any KC URL, realm, client, user, type, password, stateKey)
- [x] `POST /api/get-access-token` — OID4VP token exchange (dataSvcUrl configurable)

### Frontend (`public/index.html` + `public/app-pages.js`)
- [x] Full dark-mode management console UI (Inter font, CSS variables, premium design)
- [x] Left sidebar with 10 sections grouped by: Overview, Trust & Identity, Access Control, Marketplace, Data, Config
- [x] Session state bar (bottom strip showing key→value chips with copy buttons)
- [x] Toast notification system (success / error / warning / info)
- [x] Generic modal system (openModal / closeModal)
- [x] All settings persisted to `localStorage` (survive page refresh)
- [x] **Dashboard** — service health grid + credential status stats + quick actions
- [x] **Participants** — TIR issuer table + Register Participant modal (configurable DID, credential types, claims JSON)
- [x] **Credentials** — DID generation, Keycloak config form (URL/realm/client/password), 3 standard credential rows + "Custom Credential" modal for any KC config
- [x] **Policies** — PAP policy table (list/view/delete) + Create Policy modal with 5 templates
- [x] **Product Catalog** — Specs tab (list/view/delete/create) + Offerings tab (list/view/delete/create with live spec dropdown)
- [x] **Browse & Order** — live marketplace offering cards (via REP credential OID4VP) + one-click order + cluster viewer
- [x] **Entities** — NGSI-LD browser with type filter, paginated table, create/delete, raw JSON paste support
- [x] **Orders** — full order table + Complete action (triggers Contract Management)
- [x] **Settings** — full config form: identities, Keycloak, all 7 service URLs — saved to localStorage
- [x] **Demo Wizard** — all 8 phases × 24 steps preserved with form overrides, per-step responses, status badges

---

## 🐛 Known Bugs / Must Fix Before Demo

### Critical
- [ ] **Server must be restarted** after the `server.js` update — new routes (`/api/health`, `/api/tir/*`, `/api/pap/*`, `/api/ngsi/*`, `/api/tmf/*`) only exist after restart. Until then, Participants/Policies/Entities/Orders pages show "Unexpected token `<`" (the old server returned HTML for unknown routes).
  ```bash
  # In WSL, in the dashboard directory:
  node server.js
  ```

- [x] **Marketplace OID4VP URL bug** — Fixed: both `loadMpOfferings()` and `placeMarketplaceOrder()` now use `CFG.urlDataSvc` directly.

- [x] **Demo Wizard steps 5-2/5-3** — Removed dead `policy` variable from step 5-2 (unused computed value). Inline bodies still used (correct and intentional — `buildRolePolicy` uses `ngsi-ld:entityType`, not `tmf:resource`).

### Minor
- [ ] **PAP GET /policy** may return `[]` or `404` if the ODRL-PAP version deployed doesn't support `GET /policy`. The Policies page shows a graceful info alert in that case, but the user should verify by checking the PAP API docs for the deployed version.
- [ ] **Delete product spec** — TMForum may reject if an offering references the spec. Delete the offering first.
- [x] **TIL `PUT` update** — Fixed: `openUpdateParticipant()` now calls `put('til/register', …)` using the new `put()` HTTP helper added to `index.html`.

---

## 🚀 Next Steps (Priority Order)

### P1 — Immediate (makes demo reliably replayable)
- [x] **Fix Marketplace OID4VP URL** — Fixed (see bug section above).
- [ ] **Auto-restart server hint** — add a banner on the Dashboard if health check returns HTML errors, saying "Restart server.js"
- [x] **Policy pre-seed button** — "Seed Standard Policies" button added to Policies page header. Seeds policies 5-1 through 5-4 in sequence; 500s are treated as "already exists" (skipped).

### P2 — Participant Management (core "production" feature)
- [x] **Organizations page** — Added as new nav item in Marketplace section. Lists all TMForum organizations with DID characteristic column; supports view + delete.
- [ ] **Multi-consumer support** — Settings: define N consumer profiles each with `{ name, did, kcUrl, realm }`. Credentials page shows a dropdown to switch which consumer you're issuing credentials for.
- [ ] **DID decode** — in the Credentials page, clicking a credential JWT should show a decoded payload panel (split on `.`, base64url decode the middle section).
- [x] **TIL update via PUT** — Fixed (see bug section above).

### P3 — Catalog & Policy UX
- [ ] **Delete spec safety** — check for referencing offerings before allowing delete. Show a warning if offerings reference the spec.
- [ ] **Policy diff view** — when creating a policy, show a preview of the JSON that will be posted (collapsible, syntax-highlighted).
- [ ] **Policy templates** — add pre-built templates for all 4 standard demo policies (5-1 through 5-4) as one-click creates.
- [ ] **Offering status toggle** — add PATCH offering to toggle `lifecycleStatus` between ACTIVE and INACTIVE without deleting.

### P4 — Operations Quality
- [ ] **Persistent activity log** — serialize log entries to `sessionStorage` so they survive page navigation within the same session (but reset on browser close).
- [ ] **Export state** — "Export" button on the state bar that downloads `dsc-state.json` with all current S values (credentials + IDs). Complementary "Import state" to paste it back.
- [ ] **Health auto-refresh** — Dashboard health grid refreshes every 30 seconds automatically, with a countdown badge.
- [ ] **Keycloak health check** — dedicated check in the health grid for the Keycloak instance (currently missing from the 7-service list).
- [ ] **Step progress persistence** — Demo Wizard step statuses (`_stepStatus`, `_stepResp`) are lost on page navigation. Store them in `sessionStorage` keyed by step ID.

### P5 — Multi-Provider Support
- [ ] **Provider profiles** — Settings: define N provider configurations each with their own `{ papUrl, scorpioUrl, tmfUrl, tirUrl }`. All resource pages (Policies, Catalog, Entities) show a provider dropdown at the top.
- [ ] **Cross-provider entity query** — Entities page: query multiple Scorpio endpoints in one view, federated search.

---

## 📁 File Map

```
dashboard/
├── server.js          ← Node.js backend (extended — restart required after update)
├── package.json
├── HANDOFF.md         ← Full architecture reference (update after major changes)
├── TODO.md            ← This file
└── public/
    ├── index.html     ← HTML shell + CSS + core JS (settings, state, HTTP, modal, nav)
    └── app-pages.js   ← All 10 page renderers (Dashboard, Participants, Credentials,
                          Policies, Catalog, Marketplace, Entities, Orders, Settings, Demo)
```

---

## 🔧 Quick Fix Reference

```bash
# Restart server after server.js changes
cd doc/deployment-integration/local-deployment/dashboard
node server.js

# Check if PAP supports GET /policy
curl http://pap-provider.127.0.0.1.nip.io:8080/policy

# Check TIL issuer registration
curl http://til.127.0.0.1.nip.io:8080/v4/issuers

# Manually delete a PAP policy by UID
curl -X DELETE "http://localhost:5000/api/pap/policies?uid=https://mp-operation.org/policy/common/test"

# List all NGSI-LD entities
curl "http://localhost:5000/api/ngsi/entities?type=K8SCluster"
```
