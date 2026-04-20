'use strict';
// app-pages.js — all page renderers for the FIWARE DSC Operations Console
// Requires: index.html globals (I, CFG, S, Pages, toast, openModal, closeModal, fval,
//           get, post, del, patch, httpProxy, getCredential, getAccessToken,
//           renderTable, renderFields, esc, badge, loading, saveState, buildEntityReadPolicy, etc.)

// ─────────────────────────────────────────────────────────────
// 1. DASHBOARD
// ─────────────────────────────────────────────────────────────
Pages.dashboard = async function () {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Dashboard</div><div class="page-desc">Service health and quick stats for your local deployment.</div></div>
      <div class="page-actions"><button class="btn btn-secondary" onclick="Pages.dashboard()">${I.refresh} Refresh</button></div>
    </div>
    <div class="health-grid" id="health-grid">${[...Array(7)].map(() => `<div class="health-card"><div class="health-dot pinging"></div><div><div class="health-label">…</div><div class="health-meta">Checking</div></div></div>`).join('')}</div>
    <div class="stat-grid" id="stat-grid"><div class="stat-card">Loading stats…</div></div>
    <div class="section-title">Quick Actions</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">
      <button class="btn btn-primary"   onclick="showPage('credentials')">${I.credentials} Issue Credentials</button>
      <button class="btn btn-secondary" onclick="showPage('participants')">${I.participants} Manage Participants</button>
      <button class="btn btn-secondary" onclick="showPage('policies')">${I.policies} Browse Policies</button>
      <button class="btn btn-secondary" onclick="showPage('marketplace')">${I.marketplace} Browse Marketplace</button>
      <button class="btn btn-secondary" onclick="showPage('demo')">${I.demo} Run Demo Wizard</button>
    </div>`;

  // Health check
  try {
    const health = await get('health', {
      tirUrl: CFG.urlTIR, tilUrl: CFG.urlTIL, papUrl: CFG.urlPAP,
      scorpioUrl: CFG.urlScorpio, tmfUrl: CFG.urlTMF, mpTmfUrl: CFG.urlMpTMF, dataSvcUrl: CFG.urlDataSvc,
    });
    document.getElementById('health-grid').innerHTML = health.map(s => `
      <div class="health-card">
        <div class="health-dot ${s.up ? 'up' : 'down'}"></div>
        <div>
          <div class="health-label">${esc(s.key)}</div>
          <div class="health-meta">${s.up ? `${s.ms}ms · HTTP ${s.status}` : `${s.error || 'unreachable'}`}</div>
        </div>
      </div>`).join('');

    const upCount = health.filter(s => s.up).length;
    const statColor = upCount === health.length ? 'green' : upCount > 3 ? 'yellow' : 'red';
    document.getElementById('stat-grid').innerHTML = `
      <div class="stat-card ${statColor}"><div class="stat-label">Services</div><div class="stat-value">${upCount}/${health.length}</div><div class="stat-sub">online</div></div>
      <div class="stat-card accent"><div class="stat-label">Holder DID</div><div class="stat-value" style="font-size:13px;margin-top:4px">${S.holderDid ? '✓ set' : '✗ none'}</div><div class="stat-sub">${S.holderDid ? 'key material ready' : 'run credentials page'}</div></div>
      <div class="stat-card ${S.USER_CREDENTIAL ? 'green' : ''}"><div class="stat-label">USER_CRED</div><div class="stat-value">${S.USER_CREDENTIAL ? '✓' : '✗'}</div><div class="stat-sub">${S.USER_CREDENTIAL ? 'issued' : 'not issued'}</div></div>
      <div class="stat-card ${S.REP_CREDENTIAL ? 'green' : ''}"><div class="stat-label">REP_CRED</div><div class="stat-value">${S.REP_CREDENTIAL ? '✓' : '✗'}</div><div class="stat-sub">${S.REP_CREDENTIAL ? 'issued' : 'not issued'}</div></div>
      <div class="stat-card ${S.OPERATOR_CREDENTIAL ? 'green' : ''}"><div class="stat-label">OPERATOR_CRED</div><div class="stat-value">${S.OPERATOR_CREDENTIAL ? '✓' : '✗'}</div><div class="stat-sub">${S.OPERATOR_CREDENTIAL ? 'issued' : 'not issued'}</div></div>
    `;
  } catch (e) {
    document.getElementById('health-grid').innerHTML = `<div class="empty-state">${I.warn} Could not reach dashboard. Is server.js running?</div>`;
  }
};

// ─────────────────────────────────────────────────────────────
// 2. PARTICIPANTS  (TIR viewer + TIL registration)
// ─────────────────────────────────────────────────────────────
Pages.participants = async function () {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Participants</div><div class="page-desc">View the Trusted Issuers Registry (TIR) and register new participants via TIL.</div></div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Pages.participants()">${I.refresh} Refresh</button>
        <button class="btn btn-primary" onclick="openRegisterParticipant()">${I.plus} Register Participant</button>
      </div>
    </div>
    <div id="participants-table">${loading('Loading TIR issuers…')}</div>`;

  try {
    const r = await get('tir/issuers', { tirUrl: CFG.urlTIR, pageSize: 100 });
    const items = r.body?.items || r.body || [];
    if (!Array.isArray(items) || !items.length) {
      document.getElementById('participants-table').innerHTML = `<div class="empty-state">No issuers found in TIR at ${esc(CFG.urlTIR)}</div>`;
      return;
    }
    document.getElementById('participants-table').innerHTML = renderTable(
      ['DID', 'Credential Types', 'Trusted For', 'Actions'],
      items.map(iss => [
        `<div class="td-mono">${esc(iss.did || iss.issuer || '—')}</div>`,
        (iss.credentials || []).map(c => `<span class="tag">${esc(c.credentialsType || c.type || c)}</span>`).join('') || badge('none', 'grey'),
        badge(iss.attributes?.legacyIssuer ? 'Legacy' : 'DSBA', 'blue'),
        `<div class="td-actions">
          <button class="btn btn-sm btn-secondary" onclick="viewIssuer(${esc(JSON.stringify(iss))})">${I.eye} View</button>
          <button class="btn btn-sm btn-primary" onclick="openUpdateParticipant(${esc(JSON.stringify(iss))})">${I.credentials} Update</button>
        </div>`,
      ])
    );
  } catch (e) {
    document.getElementById('participants-table').innerHTML = `<div class="empty-state">${I.warn} Error: ${esc(e.message)}</div>`;
  }
};

window.viewIssuer = function (issuer) {
  openModal({
    title: 'Issuer Details', sub: issuer.did || '',
    body: `<pre class="code-block">${esc(JSON.stringify(issuer, null, 2))}</pre>`,
    noFooter: true,
  });
};

window.openRegisterParticipant = function () {
  const CRED_TYPES = ['UserCredential', 'OperatorCredential', 'GaiaXParticipantCredential', 'LegalParticipantCredential'];
  openModal({
    title: 'Register New Participant', sub: 'Adds the participant DID to the Trusted Issuers List (TIL). Contract Management reads TIL → TIR.',
    wide: true,
    submitLabel: 'Register',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'p-name',  label: 'Organization Name', placeholder: 'Fancy Marketplace Inc.', hint: 'Display name only (not stored in TIL)', full: true },
        { id: 'p-did',   label: 'DID *', placeholder: 'did:web:fancy-marketplace.biz', hint: 'The W3C DID that will be trusted in the dataspace', full: true },
        { id: 'p-til',   label: 'TIL URL', default: CFG.urlTIL, hint: 'Override if using a different TIL instance' },
      ])}
    </div>
    <div class="sep"></div>
    <div class="section-title">Credential Types to Trust</div>
    <div id="cred-type-rows"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="addCredTypeRow()">${I.plus} Add credential type</button>`,
    onSubmit: async () => {
      const did  = fval('p-did');
      const tilUrl = fval('p-til') || CFG.urlTIL;
      if (!did) { toast('DID is required', 'error'); return; }
      const rows = document.querySelectorAll('.cred-type-row');
      const credentials = Array.from(rows).map(r => ({
        credentialsType: r.querySelector('.ct-type').value,
        claims: r.querySelector('.ct-claims').value ? JSON.parse(r.querySelector('.ct-claims').value) : [],
      }));
      const body = { did, credentials, tilUrl };
      const r = await post('til/register', body);
      if (r.ok || r.status === 200 || r.status === 201) {
        toast(`Participant ${did} registered!`, 'success');
        closeModal();
        Pages.participants();
      } else {
        toast(`Error: ${r.error || r.body?.message || r.status}`, 'error');
      }
    },
  });
  // Initial row
  addCredTypeRow();
};

window.addCredTypeRow = function () {
  const container = document.getElementById('cred-type-rows');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'cred-type-row';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end';
  div.innerHTML = `
    <div class="field"><label>Credential Type</label>
      <select class="ct-type">
        <option>UserCredential</option>
        <option>OperatorCredential</option>
        <option>GaiaXParticipantCredential</option>
        <option>VerifiableCredential</option>
      </select>
    </div>
    <div class="field"><label>Claims JSON (optional)</label>
      <input class="ct-claims" type="text" placeholder='[{"name":"roles","allowedValues":["OPERATOR"]}]'/>
    </div>
    <button class="btn btn-danger btn-icon" onclick="this.closest('.cred-type-row').remove()">${I.trash}</button>`;
  container.appendChild(div);
};

window.openUpdateParticipant = function (issuer) {
  openModal({
    title: 'Update Participant', sub: issuer.did,
    wide: true, submitLabel: 'Update',
    body: `<div class="form-grid">
      ${renderFields([{ id: 'up-til', label: 'TIL URL', default: CFG.urlTIL }])}
      </div>
      <div class="section-title" style="margin-top:12px">Body (JSON)</div>
      <div class="field form-full">
        <textarea id="up-body" style="min-height:200px">${esc(JSON.stringify({ did: issuer.did, credentials: issuer.credentials || [] }, null, 2))}</textarea>
      </div>`,
    onSubmit: async () => {
      const body  = JSON.parse(fval('up-body'));
      const tilUrl = fval('up-til') || CFG.urlTIL;
      const r = await put('til/register', { ...body, tilUrl, did: issuer.did });
      if (r.ok || r.status === 200 || r.status === 201 || r.status === 204) {
        toast('Participant updated!', 'success'); closeModal(); Pages.participants();
      } else {
        toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
      }
    },
  });
};

// ─────────────────────────────────────────────────────────────
// 3. CREDENTIALS  (configurable OID4VC issuance)
// ─────────────────────────────────────────────────────────────
Pages.credentials = async function () {
  const credDefs = [
    { type: 'user-credential',     label: 'UserCredential (employee)',       user: 'employee',       stateKey: 'USER_CREDENTIAL',     scope: 'default' },
    { type: 'user-credential',     label: 'UserCredential (representative)', user: 'representative', stateKey: 'REP_CREDENTIAL',      scope: 'default' },
    { type: 'operator-credential', label: 'OperatorCredential (operator)',   user: 'operator',       stateKey: 'OPERATOR_CREDENTIAL', scope: 'operator' },
  ];

  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Credentials</div><div class="page-desc">Generate holder DID key material and issue Verifiable Credentials via OID4VC (pre-authorized code flow).</div></div>
      <div class="page-actions"><button class="btn btn-primary" onclick="openCustomCredential()">${I.plus} Custom Credential</button></div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="section-title">Step 1 — Holder DID</div>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Generates an EC P-256 key pair and a did:key DID in the project <code>cert/</code> directory. Required before issuing credentials.</p>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="btn-gen-did" onclick="generateDID()">${I.credentials} Generate / Load DID</button>
        <div id="did-result" class="monospace" style="color:var(--accent);font-size:11px">${S.holderDid || 'not set'}</div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Step 2 — Issue Credentials from Keycloak</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        ${renderFields([
          { id: 'kc-url',    label: 'Keycloak URL',   default: CFG.kcUrl },
          { id: 'kc-realm',  label: 'Realm',           default: CFG.kcRealm },
          { id: 'kc-client', label: 'Client ID',        default: CFG.kcClient },
          { id: 'kc-pass',   label: 'Password',         default: CFG.kcPassword, type: 'password' },
        ])}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="btn btn-secondary btn-sm" onclick="saveKcSettings()">Save as defaults</button>
      </div>
      <hr class="sep">
      <div style="display:grid;gap:10px">
        ${credDefs.map(c => `
          <div id="cred-row-${c.stateKey}" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r)">
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px">${esc(c.label)}</div>
              <div style="font-size:11px;color:var(--muted)">${esc(c.type)} · user: ${esc(c.user)}</div>
              ${S[c.stateKey] ? `<div class="cred-preview">${esc(S[c.stateKey].substring(0,100))}…</div>` : ''}
            </div>
            <div>${S[c.stateKey] ? badge('Issued','green') : badge('Not issued','grey')}</div>
            <button class="btn btn-primary btn-sm" onclick="issueCredential('${c.type}','${c.user}','${c.stateKey}')">${I.credentials} Issue</button>
            ${S[c.stateKey] ? `<button class="btn btn-ghost btn-icon" title="Copy" onclick="copyToClipboard('${esc(S[c.stateKey])}')">${I.copy}</button>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
};

window.generateDID = async function () {
  const btn = document.getElementById('btn-gen-did');
  if (btn) { btn.disabled = true; btn.innerHTML = `${I.spin} Generating…`; }
  try {
    const r = await post('generate-did', {});
    if (!r.ok) throw new Error(r.error);
    await saveState({ holderDid: r.holderDid });
    toast(`DID ${r.source === 'existing' ? 'loaded' : 'generated'}`, 'success');
    const el = document.getElementById('did-result');
    if (el) el.textContent = r.holderDid;
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `${I.credentials} Generate / Load DID`; }
  }
};

window.issueCredential = async function (credentialType, username, stateKey) {
  if (!S.holderDid) { toast('Generate DID first', 'warning'); return; }
  const btn = document.querySelector(`#cred-row-${stateKey} .btn-primary`);
  if (btn) { btn.disabled = true; btn.innerHTML = `${I.spin}`; }
  try {
    const r = await post('get-credential', {
      credentialType, username, stateKey,
      keycloakUrl: fval('kc-url')  || CFG.kcUrl,
      realm:       fval('kc-realm')|| CFG.kcRealm,
      clientId:    fval('kc-client')|| CFG.kcClient,
      password:    fval('kc-pass') || CFG.kcPassword,
    });
    if (!r.ok) throw new Error(r.error);
    await saveState({ [stateKey]: r.credential });
    toast(`${stateKey} issued!`, 'success');
    Pages.credentials();
  } catch (e) {
    toast(e.message, 'error', 'Credential issuance failed');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `${I.credentials} Issue`; }
  }
};

window.saveKcSettings = function () {
  saveCFG({ kcUrl: fval('kc-url'), kcRealm: fval('kc-realm'), kcClient: fval('kc-client'), kcPassword: fval('kc-pass') });
  toast('Keycloak settings saved', 'success');
};

window.openCustomCredential = function () {
  openModal({
    title: 'Issue Custom Credential', sub: 'Use any Keycloak instance, realm, username, and credential type.',
    wide: true, submitLabel: 'Issue',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'cc-kc',    label: 'Keycloak URL',    default: CFG.kcUrl },
        { id: 'cc-realm', label: 'Realm',             default: CFG.kcRealm },
        { id: 'cc-client',label: 'Client ID',          default: CFG.kcClient },
        { id: 'cc-pass',  label: 'Password',           default: CFG.kcPassword, type: 'password' },
        { id: 'cc-user',  label: 'Username *',          placeholder: 'employee' },
        { id: 'cc-type',  label: 'Credential Type *',   placeholder: 'user-credential' },
        { id: 'cc-key',   label: 'Save to state key',   placeholder: 'MY_CREDENTIAL', hint: 'Optional — store in session state under this key' },
      ])}
    </div>`,
    onSubmit: async () => {
      const r = await post('get-credential', {
        keycloakUrl:    fval('cc-kc'),
        realm:          fval('cc-realm'),
        clientId:       fval('cc-client'),
        password:       fval('cc-pass'),
        username:       fval('cc-user'),
        credentialType: fval('cc-type'),
        stateKey:       fval('cc-key') || undefined,
      });
      if (!r.ok) { toast(r.error, 'error', 'Failed'); return; }
      if (fval('cc-key')) await saveState({ [fval('cc-key')]: r.credential });
      toast('Credential issued!', 'success');
      openModal({
        title: 'Credential Issued', noFooter: true,
        body: `<pre class="code-block">${esc(r.credential)}</pre>`,
      });
    },
  });
};

// ─────────────────────────────────────────────────────────────
// 4. POLICIES  (PAP CRUD)
// ─────────────────────────────────────────────────────────────
Pages.policies = async function () {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Access Policies</div><div class="page-desc">Manage ODRL policies in the Policy Administration Point (PAP). Delete existing policies to cleanly re-run the demo.</div></div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Pages.policies()">${I.refresh} Refresh</button>
        <button class="btn btn-secondary" onclick="seedStandardPolicies()">${I.check} Seed Standard Policies</button>
        <button class="btn btn-primary"   onclick="openCreatePolicy()">${I.plus} Create Policy</button>
      </div>
    </div>
    <div id="policies-table">${loading()}</div>`;

  try {
    const r = await get('pap/policies', { papUrl: CFG.urlPAP });
    const list = Array.isArray(r.body) ? r.body : (Array.isArray(r) ? r : []);
    if (!list.length) {
      // PAP may return empty or 404 — show info
      document.getElementById('policies-table').innerHTML = `
        <div class="alert alert-info">${I.info} <div>No policies found (or PAP GET /policy is not supported by this version). Use the Demo Wizard to create standard policies.</div></div>
        <div class="empty-state">No policies in PAP at ${esc(CFG.urlPAP)}</div>`;
      return;
    }
    document.getElementById('policies-table').innerHTML = renderTable(
      ['Policy UID', 'Type', 'Action', 'Assignee', ''],
      list.map(p => {
        const uid    = p['odrl:uid'] || p['@id'] || p.uid || '?';
        const type   = p['@type']   || '—';
        const perm   = p['odrl:permission'];
        const action = perm?.['odrl:action']?.['@id'] || perm?.['odrl:action'] || '—';
        const assignee = perm?.['odrl:assignee']?.['@id'] || (perm?.['odrl:assignee']?.['@type'] ? 'role-based' : '—');
        return [
          `<div class="td-mono">${esc(uid)}</div>`,
          `<span class="tag">${esc(type)}</span>`,
          badge(String(action).split(':').pop(), 'blue'),
          badge(String(assignee).split(':').pop(), 'purple'),
          `<div class="td-actions">
            <button class="btn btn-sm btn-secondary" onclick="viewPolicy(${esc(JSON.stringify(p))})">${I.eye}</button>
            <button class="btn btn-sm btn-danger"    onclick="deletePolicy('${esc(uid)}')">${I.trash}</button>
          </div>`,
        ];
      })
    );
  } catch (e) {
    document.getElementById('policies-table').innerHTML = `<div class="empty-state">${I.warn} ${esc(e.message)}</div>`;
  }
};

window.viewPolicy = function (p) {
  openModal({ title: 'Policy Detail', sub: p['odrl:uid'] || p['@id'] || '', body: `<pre class="code-block">${esc(JSON.stringify(p, null, 2))}</pre>`, noFooter: true });
};

window.deletePolicy = async function (uid) {
  if (!confirm(`Delete policy:\n${uid}\n\nThis cannot be undone.`)) return;
  const r = await del('pap/policies', { papUrl: CFG.urlPAP, uid });
  if (r.ok || r.status === 200 || r.status === 204 || r.status === 200) {
    toast('Policy deleted', 'success'); Pages.policies();
  } else {
    toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
  }
};

window.openCreatePolicy = function () {
  const templates = [
    { v: 'entity-read',  l: 'Entity Read (ngsi-ld:entityType + vc:any)' },
    { v: 'tmf-read',     l: 'TMForum Read (tmf:resource + vc:any)' },
    { v: 'role-read',    l: 'Role-based Read (role + credentialType)' },
    { v: 'role-create',  l: 'Role-based Create (tmf:create)' },
    { v: 'custom',       l: 'Custom JSON' },
  ];
  openModal({
    title: 'Create Policy', sub: 'POST to PAP — policy UID must be unique (HTTP 500 = already exists).',
    wide: true, submitLabel: 'Create',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'cp-tpl', label: 'Template', type: 'select', options: templates, full: true },
        { id: 'cp-uid', label: 'Policy UID *', default: CFG.policyPrefix + 'my-policy', placeholder: 'https://mp-operation.org/policy/common/...', full: true, hint: 'Must be globally unique in this PAP' },
        { id: 'cp-target', label: 'Target (entityType or tmf:resource)', placeholder: 'EnergyReport' },
        { id: 'cp-action', label: 'Action', default: 'odrl:read', placeholder: 'odrl:read / tmf:create' },
        { id: 'cp-role',   label: 'Role (for role templates)', placeholder: 'OPERATOR' },
        { id: 'cp-ctype',  label: 'Credential Type (for role templates)', placeholder: 'OperatorCredential' },
        { id: 'cp-json',   label: 'Custom JSON (overrides above if set)', type: 'textarea', full: true, placeholder: '{ "@context": ... }' },
      ])}
    </div>`,
    onSubmit: async () => {
      const tpl = fval('cp-tpl'), uid = fval('cp-uid');
      if (!uid) { toast('Policy UID is required', 'error'); return; }
      let body;
      if (fval('cp-json')) {
        try { body = JSON.parse(fval('cp-json')); } catch { toast('Invalid JSON', 'error'); return; }
      } else if (tpl === 'entity-read' || tpl === 'role-read') {
        body = tpl === 'entity-read'
          ? buildEntityReadPolicy(fval('cp-target') || 'Entity', uid)
          : buildRolePolicy(uid, fval('cp-target'), fval('cp-action') || 'odrl:read', fval('cp-ctype') || 'OperatorCredential', fval('cp-role') || 'OPERATOR');
      } else if (tpl === 'tmf-read' || tpl === 'role-create') {
        body = buildTmfPolicy(uid, fval('cp-target') || 'productOffering', fval('cp-action') || 'odrl:read');
      } else {
        toast('Select a template or provide Custom JSON', 'error'); return;
      }
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, body, { 'Content-Type': 'application/json' });
      if (r.status === 200 || r.status === 201 || r.status === 204) {
        toast('Policy created!', 'success'); closeModal(); Pages.policies();
      } else if (r.status === 500) {
        toast('PAP 500 — policy UID likely already exists. Change the suffix.', 'warning'); closeModal();
      } else {
        toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
      }
    },
  });
};

window.seedStandardPolicies = async function () {
  toast('Seeding standard policies…', 'info');
  const uid = (s) => CFG.policyPrefix + s;
  const policies = [
    // 5-1: read product offerings (vc:any)
    { name: '5-1 offering-read',      body: () => buildTmfPolicy(uid('offering'), 'productOffering', 'odrl:read') },
    // 5-2: REPRESENTATIVE self-registration (tmf:resource = organization)
    { name: '5-2 self-registration',  body: () => ({
        '@context': ODRL_CTX, '@id': uid('selfRegistration'), 'odrl:uid': uid('selfRegistration'), '@type': 'odrl:Policy',
        'odrl:permission': {
          'odrl:assigner': { '@id': 'https://www.mp-operation.org/' },
          'odrl:target': { '@type': 'odrl:AssetCollection', 'odrl:source': 'urn:asset',
            'odrl:refinement': [{ '@type': 'odrl:Constraint', 'odrl:leftOperand': 'tmf:resource', 'odrl:operator': { '@id': 'odrl:eq' }, 'odrl:rightOperand': 'organization' }] },
          'odrl:assignee': { '@type': 'odrl:PartyCollection', 'odrl:source': 'urn:user',
            'odrl:refinement': { '@type': 'odrl:LogicalConstraint', 'odrl:and': [
              { '@type': 'odrl:Constraint', 'odrl:leftOperand': { '@id': 'vc:role' }, 'odrl:operator': { '@id': 'odrl:hasPart' }, 'odrl:rightOperand': { '@value': 'REPRESENTATIVE', '@type': 'xsd:string' } },
              { '@type': 'odrl:Constraint', 'odrl:leftOperand': { '@id': 'vc:type' }, 'odrl:operator': { '@id': 'odrl:hasPart' }, 'odrl:rightOperand': { '@value': 'UserCredential', '@type': 'xsd:string' } },
            ] } },
          'odrl:action': { '@id': 'tmf:create' },
        },
    }) },
    // 5-3: REPRESENTATIVE product ordering (tmf:resource = productOrder)
    { name: '5-3 ordering',           body: () => ({
        '@context': ODRL_CTX, '@id': uid('ordering'), 'odrl:uid': uid('ordering'), '@type': 'odrl:Policy',
        'odrl:permission': {
          'odrl:assigner': { '@id': 'https://www.mp-operation.org/' },
          'odrl:target': { '@type': 'odrl:AssetCollection', 'odrl:source': 'urn:asset',
            'odrl:refinement': [{ '@type': 'odrl:Constraint', 'odrl:leftOperand': 'tmf:resource', 'odrl:operator': { '@id': 'odrl:eq' }, 'odrl:rightOperand': 'productOrder' }] },
          'odrl:assignee': { '@type': 'odrl:PartyCollection', 'odrl:source': 'urn:user',
            'odrl:refinement': { '@type': 'odrl:LogicalConstraint', 'odrl:and': [
              { '@type': 'odrl:Constraint', 'odrl:leftOperand': { '@id': 'vc:role' }, 'odrl:operator': { '@id': 'odrl:hasPart' }, 'odrl:rightOperand': { '@value': 'REPRESENTATIVE', '@type': 'xsd:string' } },
              { '@type': 'odrl:Constraint', 'odrl:leftOperand': { '@id': 'vc:type' }, 'odrl:operator': { '@id': 'odrl:hasPart' }, 'odrl:rightOperand': { '@value': 'UserCredential', '@type': 'xsd:string' } },
            ] } },
          'odrl:action': { '@id': 'tmf:create' },
        },
    }) },
    // 5-4: OPERATOR read K8SCluster
    { name: '5-4 k8s-read',           body: () => buildRolePolicy(uid('allowRead'), 'K8SCluster', 'odrl:read', 'OperatorCredential', 'OPERATOR') },
  ];

  let created = 0, skipped = 0, errors = 0;
  for (const p of policies) {
    try {
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, p.body(), { 'Content-Type': 'application/json' });
      if (r.status === 500) { skipped++; }
      else if (r.status === 200 || r.status === 201 || r.status === 204) { created++; }
      else { errors++; console.warn(`Seed ${p.name}: unexpected ${r.status}`, r.body); }
    } catch (e) { errors++; }
  }

  if (errors > 0) toast(`Seeded: ${created} created, ${skipped} skipped, ${errors} errors — check console`, 'warning');
  else toast(`Policies seeded: ${created} created, ${skipped} already existed`, errors ? 'warning' : 'success');
  Pages.policies();
};

// ─────────────────────────────────────────────────────────────
// 5. PRODUCT CATALOG  (specs + offerings CRUD)
// ─────────────────────────────────────────────────────────────
let _catalogTab = 'specs';

Pages.catalog = async function (tab) {
  if (tab) _catalogTab = tab;
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Product Catalog</div><div class="page-desc">Manage TMForum product specifications and offerings.</div></div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Pages.catalog()">${I.refresh} Refresh</button>
        <button class="btn btn-primary" onclick="${_catalogTab === 'specs' ? 'openCreateSpec()' : 'openCreateOffering()'}">${I.plus} ${_catalogTab === 'specs' ? 'New Spec' : 'New Offering'}</button>
      </div>
    </div>
    <div class="tabs">
      <div class="tab-btn${_catalogTab==='specs'?' active':''}"   onclick="Pages.catalog('specs')">Product Specifications</div>
      <div class="tab-btn${_catalogTab==='offers'?' active':''}"  onclick="Pages.catalog('offers')">Product Offerings</div>
    </div>
    <div id="catalog-table">${loading()}</div>`;

  if (_catalogTab === 'specs') await loadSpecs();
  else await loadOfferings();
};

async function loadSpecs() {
  const r = await get('tmf/productSpecification', { tmfUrl: CFG.urlTMF });
  const list = Array.isArray(r.body) ? r.body : [];
  document.getElementById('catalog-table').innerHTML = renderTable(
    ['ID','Name','Version','Status','Chars','Actions'],
    list.map(s => [
      `<span class="id-pill">${esc((s.id||'').substring(0,8))}…</span>`,
      `<strong>${esc(s.name||'—')}</strong>`,
      `<span class="tag">${esc(s.version||'—')}</span>`,
      badge(s.lifecycleStatus||'ACTIVE', stateColor(s.lifecycleStatus)),
      String(s.productSpecCharacteristic?.length || 0),
      `<div class="td-actions">
        <button class="btn btn-sm btn-secondary" onclick="viewCatalogItem('productSpecification','${esc(s.id)}',${esc(JSON.stringify(s))})">${I.eye}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteSpec('${esc(s.id)}','${esc(s.name)}')">${I.trash}</button>
      </div>`,
    ]),
    'No product specifications found. Create one to start.'
  );
}

async function loadOfferings() {
  const r = await get('tmf/productOffering', { tmfUrl: CFG.urlTMF });
  const list = Array.isArray(r.body) ? r.body : [];
  document.getElementById('catalog-table').innerHTML = renderTable(
    ['ID','Name','Version','Status','Spec','Actions'],
    list.map(o => [
      `<span class="id-pill">${esc((o.id||'').substring(0,8))}…</span>`,
      `<strong>${esc(o.name||'—')}</strong>`,
      `<span class="tag">${esc(o.version||'—')}</span>`,
      badge(o.lifecycleStatus||'ACTIVE', stateColor(o.lifecycleStatus)),
      `<span class="id-pill">${esc((o.productSpecification?.id||'—').substring(0,8))}</span>`,
      `<div class="td-actions">
        <button class="btn btn-sm btn-secondary" onclick="viewCatalogItem('productOffering','${esc(o.id)}',${esc(JSON.stringify(o))})">${I.eye}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteOffering('${esc(o.id)}','${esc(o.name)}')">${I.trash}</button>
      </div>`,
    ]),
    'No product offerings found. Create one after creating a specification.'
  );
}

window.viewCatalogItem = function (_r, _id, obj) {
  openModal({ title: obj.name || 'Detail', sub: obj.id, body: `<pre class="code-block">${esc(JSON.stringify(obj, null, 2))}</pre>`, noFooter: true, wide: true });
};

window.deleteSpec = async function (id, name) {
  if (!confirm(`Delete specification "${name}" (${id})?`)) return;
  const r = await del('tmf/productSpecification', { tmfUrl: CFG.urlTMF, id });
  if (r.status === 200 || r.status === 204 || r.ok) { toast('Specification deleted', 'success'); Pages.catalog('specs'); }
  else toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
};

window.deleteOffering = async function (id, name) {
  if (!confirm(`Delete offering "${name}" (${id})?`)) return;
  const r = await del('tmf/productOffering', { tmfUrl: CFG.urlTMF, id });
  if (r.status === 200 || r.status === 204 || r.ok) { toast('Offering deleted', 'success'); Pages.catalog('offers'); }
  else toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
};

window.openCreateSpec = function () {
  openModal({
    title: 'Create Product Specification', sub: 'POST to TMForum productCatalogManagement/v4/productSpecification',
    wide: true, submitLabel: 'Create',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'cs-name',   label: 'Name *',    placeholder: 'M&P K8S Cluster Service' },
        { id: 'cs-brand',  label: 'Brand',      placeholder: 'M&P Operations' },
        { id: 'cs-ver',    label: 'Version',     default: '1.0.0' },
        { id: 'cs-status', label: 'Status',      default: 'ACTIVE' },
        { id: 'cs-puid',   label: 'Policy UID suffix (for embedded ODRL)', default: 'k8s-custom', hint: 'Used in https://mp-operation.org/policy/common/{uid}' },
        { id: 'cs-creds',  label: 'Credential type for buyers', default: 'OperatorCredential' },
      ])}
    </div>`,
    onSubmit: async () => {
      const name = fval('cs-name');
      if (!name) { toast('Name is required', 'error'); return; }
      const puid = CFG.policyPrefix + fval('cs-puid');
      const body = {
        name, version: fval('cs-ver') || '1.0.0', lifecycleStatus: fval('cs-status') || 'ACTIVE',
        brand: fval('cs-brand'),
        productSpecCharacteristic: [
          {
            id: 'credentialsConfig', name: 'Credentials Config',
            valueType: 'credentialsConfiguration',
            productSpecCharacteristicValue: [{
              isDefault: true,
              value: { credentialsType: fval('cs-creds') || 'OperatorCredential', claims: [] },
            }],
          },
          {
            id: 'policyConfig', name: 'Policy Config',
            valueType: 'authorizationPolicy',
            productSpecCharacteristicValue: [{
              isDefault: true,
              value: {
                '@context': { odrl: 'http://www.w3.org/ns/odrl/2/' },
                '@id': puid, 'odrl:uid': puid, '@type': 'odrl:Policy',
                'odrl:permission': {
                  'odrl:assigner': 'https://www.mp-operation.org/',
                  'odrl:target': { '@type': 'odrl:AssetCollection', 'odrl:source': 'urn:asset' },
                  'odrl:assignee': { '@type': 'odrl:PartyCollection', 'odrl:source': 'urn:user' },
                  'odrl:action': 'odrl:use',
                },
              },
            }],
          },
        ],
      };
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productSpecification`, body, { 'Content-Type': 'application/json;charset=utf-8' });
      if (r.body?.id) {
        await saveState({ PRODUCT_SPEC_SMALL_ID: S.PRODUCT_SPEC_SMALL_ID || r.body.id });
        toast(`Spec created: ${r.body.id}`, 'success'); closeModal(); Pages.catalog('specs');
      } else toast(`Error ${r.status}: ${JSON.stringify(r.body)}`, 'error');
    },
  });
};

window.openCreateOffering = async function () {
  const specR = await get('tmf/productSpecification', { tmfUrl: CFG.urlTMF });
  const specs  = Array.isArray(specR.body) ? specR.body : [];
  openModal({
    title: 'Create Product Offering', sub: 'POST to TMForum productCatalogManagement/v4/productOffering',
    wide: true, submitLabel: 'Create',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'co-name',   label: 'Name *',    placeholder: 'M&P K8S Offering' },
        { id: 'co-ver',    label: 'Version',    default: '1.0.0' },
        { id: 'co-status', label: 'Status',     default: 'ACTIVE' },
        { id: 'co-spec',   label: 'Product Specification *', type: 'select',
          options: specs.map(s => ({ v: s.id, l: `${s.name} (${s.id.substring(0,8)})` })) },
      ])}
    </div>`,
    onSubmit: async () => {
      const name = fval('co-name'), specId = fval('co-spec');
      if (!name || !specId) { toast('Name and Specification are required', 'error'); return; }
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productOffering`,
        { name, version: fval('co-ver') || '1.0.0', lifecycleStatus: fval('co-status') || 'ACTIVE', productSpecification: { id: specId } },
        { 'Content-Type': 'application/json;charset=utf-8' });
      if (r.body?.id) {
        await saveState({ PRODUCT_OFFERING_FULL_ID: S.PRODUCT_OFFERING_FULL_ID || r.body.id });
        toast(`Offering created: ${r.body.id}`, 'success'); closeModal(); Pages.catalog('offers');
      } else toast(`Error ${r.status}: ${JSON.stringify(r.body)}`, 'error');
    },
  });
};

// ─────────────────────────────────────────────────────────────
// 6. MARKETPLACE  (consumer browse + order)
// ─────────────────────────────────────────────────────────────
Pages.marketplace = async function () {
  const el = document.getElementById('page-content');
  const readyRep = !!(S.REP_CREDENTIAL && S.holderDid);
  const readyOp  = !!(S.OPERATOR_CREDENTIAL && S.holderDid);

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Browse &amp; Order</div><div class="page-desc">Consumer-facing marketplace. Browse offerings and place orders using REP_CREDENTIAL.</div></div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="Pages.marketplace()">${I.refresh}</button>
      </div>
    </div>
    ${!readyRep ? `<div class="alert alert-warning">${I.warn}<div>REP_CREDENTIAL not set — complete Credentials page (generate DID + issue representative credential) and Policies page (5-1, 5-2, 5-3) first.</div></div>` : ''}
    <div class="section-title">Available Offerings</div>
    <div id="mp-offerings">${readyRep ? loading('Loading offerings…') : '<div class="empty-state">Credentials required — see warning above.</div>'}</div>
    <div class="section-title" style="margin-top:20px">Your K8S Clusters</div>
    <div id="mp-clusters">
      ${readyOp
        ? `<button class="btn btn-secondary btn-sm" onclick="loadMpClusters()">${I.refresh} Load Clusters</button>`
        : `<div class="empty-state" style="padding:12px">Requires OPERATOR_CREDENTIAL and a completed order. Run the Demo Wizard Phase 7–8.</div>`}
    </div>`;

  if (readyRep) await loadMpOfferings();
};

async function loadMpOfferings() {
  const area = document.getElementById('mp-offerings');
  if (!area) return;
  try {
    const tok = await getAccessToken(S.REP_CREDENTIAL, 'default', CFG.urlDataSvc);
    if (!tok.accessToken) throw new Error('Could not get REP access token — check OID4VP flow (Phase 4 policies).');
    const r = await httpProxy('GET', `${CFG.urlMpTMF}/tmf-api/productCatalogManagement/v4/productOffering`, null, { Authorization: `Bearer ${tok.accessToken}` });
    const list = Array.isArray(r.body) ? r.body : [];
    if (!list.length) { area.innerHTML = '<div class="empty-state">No offerings found. Create them in Product Catalog page first.</div>'; return; }
    area.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
      ${list.map((o, i) => `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">
          <div style="background:linear-gradient(135deg,#1a3a5c,#1e4d8c);padding:14px 16px;color:#e2eaf6">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(o.name||'Unnamed')}</div>
            <div style="font-size:11px;opacity:.7">v${esc(o.version||'1.0')} · ${esc(o.lifecycleStatus||'ACTIVE')}</div>
          </div>
          <div style="padding:12px 16px">
            <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${esc(o.description||'K8S Cluster service offering from M&P Operations.')}</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted)">${esc((o.id||'').substring(0,28))}…</div>
          </div>
          <div style="padding:10px 16px;border-top:1px solid var(--border)">
            <button class="btn btn-success" style="width:100%" onclick="placeMarketplaceOrder('${esc(o.id)}',${i})" id="mp-btn-${i}">${I.orders} Order</button>
            <div id="mp-status-${i}" style="text-align:center;font-size:11px;color:var(--muted);margin-top:6px"></div>
          </div>
        </div>`).join('')}
    </div>`;
  } catch (e) {
    if (area) area.innerHTML = `<div class="empty-state">${I.warn} ${esc(e.message)}</div>`;
  }
}

window.placeMarketplaceOrder = async function (offerId, idx) {
  if (!S.FANCY_MARKETPLACE_ID) { toast('Register your organization first (Participants → Register org or Demo Step 7-3)', 'warning'); return; }
  const btn = document.getElementById(`mp-btn-${idx}`);
  const status = document.getElementById(`mp-status-${idx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = `${I.spin} Ordering…`; }
  try {
    const tok = await getAccessToken(S.REP_CREDENTIAL, 'default', CFG.urlDataSvc);
    if (!tok.accessToken) throw new Error('REP access token failed');
    if (status) status.textContent = 'Placing order…';
    const orderR = await httpProxy('POST', `${CFG.urlMpTMF}/tmf-api/productOrderingManagement/v4/productOrder`,
      { productOrderItem:[{id:'item-1',action:'add',productOffering:{id:offerId}}], relatedParty:[{id:S.FANCY_MARKETPLACE_ID}] },
      { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
    if (!orderR.body?.id) throw new Error(`Order failed: ${JSON.stringify(orderR.body)}`);
    const orderId = orderR.body.id;
    await saveState({ ORDER_ID: orderId, OFFER_ID: offerId });
    if (status) status.textContent = 'Completing order…';
    await httpProxy('PATCH', `${CFG.urlTMF}/tmf-api/productOrderingManagement/v4/productOrder/${orderId}`,
      { state:'completed' }, { 'Content-Type':'application/json;charset=utf-8' });
    if (btn) { btn.disabled = false; btn.innerHTML = `${I.check} Ordered!`; btn.style.background = 'var(--green)'; }
    if (status) status.textContent = `Order ${orderId.substring(0,12)}… completed. Contract Mgmt processing (~3s).`;
    toast('Order placed & completed!', 'success');
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = `${I.orders} Retry`; }
    if (status) status.textContent = '';
    toast(e.message, 'error', 'Order failed');
  }
};

window.loadMpClusters = async function () {
  const area = document.getElementById('mp-clusters');
  if (!area) return;
  area.innerHTML = loading('Loading clusters…');
  try {
    const tok = await getAccessToken(S.OPERATOR_CREDENTIAL, 'operator');
    if (!tok.accessToken) throw new Error('Could not get OPERATOR token — complete Phase 8 first.');
    const r = await httpProxy('GET', `${CFG.urlDataSvc}/ngsi-ld/v1/entities?type=K8SCluster`, null, { Authorization:`Bearer ${tok.accessToken}` });
    const list = Array.isArray(r.body) ? r.body : [];
    area.innerHTML = `<button class="btn btn-secondary btn-sm" onclick="loadMpClusters()" style="margin-bottom:10px">${I.refresh} Reload</button>` + renderTable(
      ['ID','Name','Nodes'],
      list.map(c => [`<span class="id-pill">${esc((c.id||'').replace('urn:ngsi-ld:K8SCluster:',''))}</span>`, esc(c.name?.value||'—'), esc(String(c.numNodes?.value||'?'))]),
      'No K8SCluster entities found.'
    );
  } catch (e) {
    area.innerHTML = `<div class="empty-state">${I.warn} ${esc(e.message)}</div>`;
  }
};

// ─────────────────────────────────────────────────────────────
// 7. ENTITIES  (NGSI-LD browser with CRUD)
// ─────────────────────────────────────────────────────────────
let _entityType = '';

Pages.entities = async function () {
  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Entities (Scorpio)</div><div class="page-desc">Browse and manage NGSI-LD entities in the context broker. Direct Scorpio access — no auth required for demo.</div></div>
      <div class="page-actions"><button class="btn btn-primary" onclick="openCreateEntity()">${I.plus} Create Entity</button></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px;align-items:flex-end">
      <div class="field" style="flex:1;margin:0"><label>Entity Type (leave blank for all)</label>
        <input id="entity-type-filter" type="text" value="${esc(_entityType)}" placeholder="K8SCluster, EnergyReport, …"/>
      </div>
      <div class="field" style="width:80px;margin:0"><label>Page size</label>
        <input id="entity-pagesize" type="number" value="50" min="1" max="1000"/>
      </div>
      <button class="btn btn-primary" onclick="loadEntities()">${I.refresh} Query</button>
    </div>
    <div id="entities-table">${loading()}</div>`;
  await loadEntities();
};

window.loadEntities = async function () {
  _entityType = fval('entity-type-filter');
  const pageSize = document.getElementById('entity-pagesize')?.value || 50;
  const area = document.getElementById('entities-table');
  if (area) area.innerHTML = loading();
  const r = await get('ngsi/entities', { scorpioUrl: CFG.urlScorpio, type: _entityType || undefined, pageSize });
  const list = Array.isArray(r.body) ? r.body : [];
  if (area) area.innerHTML = renderTable(
    ['ID','Type','Properties','Actions'],
    list.map(e => {
      const props = Object.keys(e).filter(k => !['id','type','@context'].includes(k));
      return [
        `<div class="td-mono">${esc(e.id||'—')}</div>`,
        `<span class="tag">${esc(e.type||'—')}</span>`,
        props.slice(0,4).map(p => `<span class="tag">${esc(p)}</span>`).join(''),
        `<div class="td-actions">
          <button class="btn btn-sm btn-secondary" onclick="viewEntity(${esc(JSON.stringify(e))})">${I.eye}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEntity('${esc(e.id)}','${esc(e.type)}')">${I.trash}</button>
        </div>`,
      ];
    }),
    `No entities found${_entityType ? ` of type "${_entityType}"` : ''}.`
  );
};

window.viewEntity = function (e) {
  openModal({ title: e.type, sub: e.id, body: `<pre class="code-block">${esc(JSON.stringify(e, null, 2))}</pre>`, noFooter: true, wide: true });
};

window.deleteEntity = async function (id, type) {
  if (!confirm(`Delete ${type} entity:\n${id}`)) return;
  const r = await del('ngsi/entities', { scorpioUrl: CFG.urlScorpio, id });
  if (r.status === 204 || r.status === 200 || r.ok) { toast('Entity deleted', 'success'); loadEntities(); }
  else toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
};

window.openCreateEntity = function () {
  openModal({
    title: 'Create NGSI-LD Entity', sub: `POST to Scorpio at ${CFG.urlScorpio}`,
    wide: true, submitLabel: 'Create',
    body: `<div class="form-grid">
      ${renderFields([
        { id: 'ce-type', label: 'Entity Type *', placeholder: 'EnergyReport', default: _entityType || '' },
        { id: 'ce-id',   label: 'Entity ID (URN) *', placeholder: 'urn:ngsi-ld:EnergyReport:r1' },
      ])}
    </div>
    <div class="sep"></div>
    <div class="section-title">Properties</div>
    <div id="entity-props"></div>
    <button class="btn btn-ghost btn-sm" onclick="addEntityProp()">${I.plus} Add property</button>
    <div class="sep"></div>
    <div class="field form-full">
      <label>Or paste raw NGSI-LD JSON (overrides above)</label>
      <textarea id="ce-raw" placeholder='{"id":"urn:ngsi-ld:…","type":"…","name":{"type":"Property","value":"…"}}'></textarea>
    </div>`,
    onSubmit: async () => {
      let body;
      const raw = fval('ce-raw');
      if (raw) {
        try { body = JSON.parse(raw); } catch { toast('Invalid JSON', 'error'); return; }
      } else {
        const type = fval('ce-type'), id = fval('ce-id');
        if (!type || !id) { toast('Type and ID are required', 'error'); return; }
        body = { id, type };
        document.querySelectorAll('.ep-row').forEach(r => {
          const k = r.querySelector('.ep-key').value.trim();
          const v = r.querySelector('.ep-val').value;
          if (k) body[k] = { type: 'Property', value: v };
        });
      }
      const r = await httpProxy('POST', `${CFG.urlScorpio}/ngsi-ld/v1/entities`, body, { 'Content-Type': 'application/json' });
      if (r.status === 201 || r.status === 409) {
        toast(r.status === 409 ? 'Entity already exists' : 'Entity created!', r.status === 409 ? 'warning' : 'success');
        closeModal(); loadEntities();
      } else toast(`Error ${r.status}: ${JSON.stringify(r.body)}`, 'error');
    },
  });
  addEntityProp();
};

window.addEntityProp = function () {
  const c = document.getElementById('entity-props');
  if (!c) return;
  const d = document.createElement('div');
  d.className = 'ep-row';
  d.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center';
  d.innerHTML = `
    <input class="ep-key" placeholder="propertyName" style="background:var(--surface);border:1px solid var(--border-l);border-radius:var(--r);padding:7px 9px;color:var(--text);font-family:var(--font);font-size:12px"/>
    <input class="ep-val" placeholder="value"        style="background:var(--surface);border:1px solid var(--border-l);border-radius:var(--r);padding:7px 9px;color:var(--text);font-family:var(--font);font-size:12px"/>
    <button class="btn btn-danger btn-icon" onclick="this.closest('.ep-row').remove()">${I.trash}</button>`;
  c.appendChild(d);
};

// ─────────────────────────────────────────────────────────────
// 8. ORDERS
// ─────────────────────────────────────────────────────────────
Pages.orders = async function () {
  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Orders</div><div class="page-desc">View and manage TMForum product orders. Completing an order triggers Contract Management.</div></div>
      <div class="page-actions"><button class="btn btn-secondary" onclick="Pages.orders()">${I.refresh} Refresh</button></div>
    </div>
    <div id="orders-table">${loading()}</div>`;

  const r = await get('tmf/productOrder', { tmfUrl: CFG.urlTMF });
  const list = Array.isArray(r.body) ? r.body : [];
  document.getElementById('orders-table').innerHTML = renderTable(
    ['ID','State','Party','Offering Items','Ordered At','Actions'],
    list.map(o => [
      `<span class="id-pill">${esc((o.id||'').substring(0,12))}…</span>`,
      badge(o.state||'?', stateColor(o.state)),
      `<span class="id-pill">${esc((o.relatedParty?.[0]?.id||'—').substring(0,12))}</span>`,
      String(o.productOrderItem?.length||0),
      esc(o.orderDate ? new Date(o.orderDate).toLocaleString() : '—'),
      `<div class="td-actions">
        <button class="btn btn-sm btn-secondary" onclick="viewOrder(${esc(JSON.stringify(o))})">${I.eye}</button>
        ${o.state !== 'completed' ? `<button class="btn btn-sm btn-success" onclick="completeOrder('${esc(o.id)}')">${I.check} Complete</button>` : ''}
      </div>`,
    ]),
    'No orders found.'
  );
};

window.viewOrder = function (o) {
  openModal({ title: 'Order Detail', sub: o.id, body: `<pre class="code-block">${esc(JSON.stringify(o, null, 2))}</pre>`, noFooter: true, wide: true });
};

window.completeOrder = async function (id) {
  if (!confirm(`Complete order ${id}?\nThis triggers Contract Management to update TIR and register policies.`)) return;
  const r = await patch('tmf/productOrder', { tmfUrl: CFG.urlTMF, id }, { state: 'completed' });
  if (r.status === 200 || r.status === 201 || r.ok) {
    toast('Order completed! Contract Management processing…', 'success'); Pages.orders();
  } else toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
};

// ─────────────────────────────────────────────────────────────
// 9. ORGANIZATIONS  (TMForum Party API — org list + delete)
// ─────────────────────────────────────────────────────────────
Pages.organizations = async function () {
  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Organizations</div><div class="page-desc">TMForum Party API organizations. Shows registered participants and their DID characteristics.</div></div>
      <div class="page-actions"><button class="btn btn-secondary" onclick="Pages.organizations()">${I.refresh} Refresh</button></div>
    </div>
    <div id="orgs-table">${loading()}</div>`;

  try {
    const r = await get('tmf/organization', { tmfUrl: CFG.urlTMF });
    const list = Array.isArray(r.body) ? r.body : [];
    document.getElementById('orgs-table').innerHTML = renderTable(
      ['ID', 'Name', 'DID', 'Status', 'Actions'],
      list.map(o => {
        const did = (o.partyCharacteristic || []).find(c => c.name === 'did')?.value || '—';
        return [
          `<span class="id-pill">${esc((o.id || '').substring(0, 12))}…</span>`,
          `<strong>${esc(o.name || '—')}</strong>`,
          `<div class="td-mono">${esc(did)}</div>`,
          badge(o.status || 'initialized', stateColor(o.status)),
          `<div class="td-actions">
            <button class="btn btn-sm btn-secondary" onclick="viewOrg(${esc(JSON.stringify(o))})">${I.eye}</button>
            <button class="btn btn-sm btn-danger"    onclick="deleteOrg('${esc(o.id)}','${esc(o.name)}')">${I.trash}</button>
          </div>`,
        ];
      }),
      'No organizations found in TMForum Party API.'
    );
  } catch (e) {
    document.getElementById('orgs-table').innerHTML = `<div class="empty-state">${I.warn} ${esc(e.message)}</div>`;
  }
};

window.viewOrg = function (o) {
  openModal({ title: o.name || 'Organization', sub: o.id, body: `<pre class="code-block">${esc(JSON.stringify(o, null, 2))}</pre>`, noFooter: true, wide: true });
};

window.deleteOrg = async function (id, name) {
  if (!confirm(`Delete organization "${name}" (${id})?\n\nThis removes the party record from TMForum but does NOT remove the DID from TIR.`)) return;
  const r = await del('tmf/organization', { tmfUrl: CFG.urlTMF, id });
  if (r.status === 200 || r.status === 204 || r.ok) { toast('Organization deleted', 'success'); Pages.organizations(); }
  else toast(`Error ${r.status}: ${r.error || JSON.stringify(r.body)}`, 'error');
};

// ─────────────────────────────────────────────────────────────
// 10. SETTINGS
// ─────────────────────────────────────────────────────────────
Pages.settings = function () {
  document.getElementById('page-content').innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Settings</div><div class="page-desc">All configuration is stored in localStorage and survives page refresh. Changes apply immediately.</div></div>
      <div class="page-actions">
        <button class="btn btn-danger btn-sm" onclick="resetSettings()">Reset to Defaults</button>
        <button class="btn btn-primary" onclick="applySettings()">${I.check} Save Settings</button>
      </div>
    </div>

    <div class="card">
      <div class="section-title">Identities</div>
      <div class="form-grid">
        ${renderFields([
          { id: 's-providerDid',  label: 'Provider DID',  default: CFG.providerDid,  hint: 'Used in credentialsConfig of product specs' },
          { id: 's-consumerDid',  label: 'Consumer DID',  default: CFG.consumerDid,  hint: 'Default DID in org registration (step 7-3)' },
          { id: 's-policyPrefix', label: 'Policy UID prefix', default: CFG.policyPrefix, full: true, hint: 'All policy odrl:uid values = prefix + suffix' },
        ])}
      </div>
    </div>

    <div class="card">
      <div class="section-title">Keycloak (OID4VC credential issuance)</div>
      <div class="form-grid">
        ${renderFields([
          { id: 's-kcUrl',    label: 'Keycloak URL',  default: CFG.kcUrl,    hint: 'HTTPS — goes through Squid proxy' },
          { id: 's-kcRealm',  label: 'Realm',          default: CFG.kcRealm   },
          { id: 's-kcClient', label: 'Client ID',       default: CFG.kcClient  },
          { id: 's-kcPass',   label: 'Default Password',default: CFG.kcPassword },
        ])}
      </div>
    </div>

    <div class="card">
      <div class="section-title">Service URLs</div>
      <div class="form-grid">
        ${renderFields([
          { id: 's-urlTIR',     label: 'TIR base URL',              default: CFG.urlTIR     },
          { id: 's-urlTIL',     label: 'TIL base URL',              default: CFG.urlTIL     },
          { id: 's-urlPAP',     label: 'PAP base URL',              default: CFG.urlPAP     },
          { id: 's-urlScorpio', label: 'Scorpio (context broker)',   default: CFG.urlScorpio },
          { id: 's-urlDataSvc', label: 'Data Service (APISIX)',      default: CFG.urlDataSvc },
          { id: 's-urlTMF',     label: 'TMForum (admin)',            default: CFG.urlTMF     },
          { id: 's-urlMpTMF',   label: 'TMForum (marketplace)',      default: CFG.urlMpTMF   },
        ])}
      </div>
    </div>`;
};

window.applySettings = function () {
  saveCFG({
    providerDid:   fval('s-providerDid'),
    consumerDid:   fval('s-consumerDid'),
    policyPrefix:  fval('s-policyPrefix'),
    kcUrl:         fval('s-kcUrl'),
    kcRealm:       fval('s-kcRealm'),
    kcClient:      fval('s-kcClient'),
    kcPassword:    fval('s-kcPass'),
    urlTIR:        fval('s-urlTIR'),
    urlTIL:        fval('s-urlTIL'),
    urlPAP:        fval('s-urlPAP'),
    urlScorpio:    fval('s-urlScorpio'),
    urlDataSvc:    fval('s-urlDataSvc'),
    urlTMF:        fval('s-urlTMF'),
    urlMpTMF:      fval('s-urlMpTMF'),
  });
  toast('Settings saved and applied!', 'success');
};

window.resetSettings = function () {
  if (!confirm('Reset all settings to defaults?')) return;
  localStorage.removeItem('dsc-cfg');
  Object.assign(CFG, DEFAULTS);
  Pages.settings();
  toast('Settings reset to defaults', 'warning');
};

// ─────────────────────────────────────────────────────────────
// 11. DEMO WIZARD  (8-phase step-by-step walkthrough)
// ─────────────────────────────────────────────────────────────
const DEMO_PHASES = [
  { id: 1, title: 'Trust Anchor',        icon: '⚓', desc: 'Verify TIR is healthy' },
  { id: 2, title: 'Credentials',         icon: '🔑', desc: 'DID + 3 credentials' },
  { id: 3, title: 'Provider Setup',      icon: '🖥️', desc: 'ODRL policy + NGSI-LD entity' },
  { id: 4, title: 'Authenticated Access',icon: '🔓', desc: 'OID4VP → read entity' },
  { id: 5, title: 'Marketplace Policies',icon: '📋', desc: '4 ODRL policies' },
  { id: 6, title: 'Product Catalog',     icon: '📦', desc: '2 specs + 2 offerings' },
  { id: 7, title: 'Customer & Orders',   icon: '🛒', desc: 'Register org + place order' },
  { id: 8, title: 'Cluster Operations',  icon: '☸️', desc: 'Create K8S clusters + verify ACL' },
];

const STEPS = [
  {
    id:'1-1', phase:1, title:'Verify Trust Anchor Issuers',
    desc:'Confirms TIR is running with 2 pre-configured issuers.',
    run: async () => {
      const r = await httpProxy('GET', `${CFG.urlTIR}/v4/issuers`);
      if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
      if (!r.body?.items?.length) throw new Error('No issuers found');
      return r.body;
    },
  },
  {
    id:'2-1', phase:2, title:'Generate Holder DID',
    desc:'Runs did-helper Docker container to create EC key pair in cert/.',
    run: async () => {
      const r = await post('generate-did', {});
      if (!r.ok) throw new Error(r.error);
      await saveState({ holderDid: r.holderDid });
      return r;
    },
  },
  {
    id:'2-2', phase:2, title:'Issue USER_CREDENTIAL (employee)',
    desc:'OID4VC 5-step flow for employee / user-credential.',
    requires:['holderDid'],
    run: async () => {
      const r = await post('get-credential', { credentialType:'user-credential', username:'employee', keycloakUrl:CFG.kcUrl, realm:CFG.kcRealm, clientId:CFG.kcClient, password:CFG.kcPassword });
      if (!r.ok) throw new Error(r.error);
      await saveState({ USER_CREDENTIAL: r.credential });
      return { ok:true, preview: r.credential.substring(0,60)+'…' };
    },
  },
  {
    id:'2-3', phase:2, title:'Issue REP_CREDENTIAL (representative)',
    desc:'OID4VC for representative / user-credential.',
    requires:['holderDid'],
    run: async () => {
      const r = await post('get-credential', { credentialType:'user-credential', username:'representative', keycloakUrl:CFG.kcUrl, realm:CFG.kcRealm, clientId:CFG.kcClient, password:CFG.kcPassword });
      if (!r.ok) throw new Error(r.error);
      await saveState({ REP_CREDENTIAL: r.credential });
      return { ok:true };
    },
  },
  {
    id:'2-4', phase:2, title:'Issue OPERATOR_CREDENTIAL (operator)',
    desc:'OID4VC for operator / operator-credential.',
    requires:['holderDid'],
    run: async () => {
      const r = await post('get-credential', { credentialType:'operator-credential', username:'operator', keycloakUrl:CFG.kcUrl, realm:CFG.kcRealm, clientId:CFG.kcClient, password:CFG.kcPassword });
      if (!r.ok) throw new Error(r.error);
      await saveState({ OPERATOR_CREDENTIAL: r.credential });
      return { ok:true };
    },
  },
  {
    id:'3-1', phase:3, title:'Create Entity Access Policy (PAP)',
    desc:'ODRL policy allowing any authenticated participant to read entities.',
    form:[
      { id:'entityType', label:'Entity Type', placeholder:'EnergyReport' },
      { id:'policyUid',  label:'Full Policy UID', default: DEFAULTS.policyPrefix+'test', hint:'Must be unique — change suffix to re-run' },
    ],
    run: async (f) => {
      const policy = buildEntityReadPolicy(f.entityType||'EnergyReport', f.policyUid||CFG.policyPrefix+'test');
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, policy, { 'Content-Type':'application/json' });
      if (r.status===500) { const e=new Error('PAP 500 — policy UID already exists. Change suffix or use Policies page to delete it.'); e.isWarning=true; throw e; }
      if (r.status!==200&&r.status!==201&&r.status!==204) throw new Error(`PAP returned ${r.status}`);
      return { ok:true };
    },
  },
  {
    id:'3-2', phase:3, title:'Create NGSI-LD Entity in Scorpio',
    desc:'Direct POST to context broker (no auth required for demo).',
    form:[
      { id:'entityType', label:'Entity Type',    placeholder:'EnergyReport' },
      { id:'entityId',   label:'Entity ID (URN)', placeholder:'urn:ngsi-ld:EnergyReport:fms-1' },
      { id:'propName',   label:'name value',      placeholder:'Standard Server' },
      { id:'propValue',  label:'consumption value',placeholder:'94' },
    ],
    run: async (f) => {
      const body={ id:f.entityId||'urn:ngsi-ld:EnergyReport:fms-1', type:f.entityType||'EnergyReport',
        name:{type:'Property',value:f.propName||'Standard Server'},
        consumption:{type:'Property',value:f.propValue||'94'} };
      const r = await httpProxy('POST', `${CFG.urlScorpio}/ngsi-ld/v1/entities`, body, {'Content-Type':'application/json'});
      if (r.status!==201&&r.status!==409) throw new Error(`Expected 201/409, got ${r.status}`);
      return { status:r.status, note: r.status===409?'Entity already exists (ok)':'Created' };
    },
  },
  {
    id:'3-3', phase:3, title:'Verify APISIX Returns 401',
    desc:'Confirms APISIX gatekeeper is active. Expected: 401 Unauthorized.',
    form:[{ id:'entityId', label:'Entity ID', placeholder:'urn:ngsi-ld:EnergyReport:fms-1' }],
    run: async (f) => {
      const r = await httpProxy('GET', `${CFG.urlDataSvc}/ngsi-ld/v1/entities/${encodeURIComponent(f.entityId||'urn:ngsi-ld:EnergyReport:fms-1')}`);
      if (r.status!==401) throw new Error(`Expected 401, got ${r.status}. APISIX may not be guarding the endpoint.`);
      return { status:401, result:'APISIX is enforcing authentication.' };
    },
  },
  {
    id:'4-1', phase:4, title:'OID4VP Token + Read Entity',
    desc:'Exchange USER_CREDENTIAL for access token, then read entity via APISIX.',
    requires:['USER_CREDENTIAL','holderDid'],
    form:[{ id:'entityId', label:'Entity ID', placeholder:'urn:ngsi-ld:EnergyReport:fms-1' }],
    run: async (f) => {
      const tok = await getAccessToken(S.USER_CREDENTIAL, 'default');
      if (!tok.accessToken) throw new Error('OID4VP failed — check Phase 3 policies are in PAP.');
      const r = await httpProxy('GET', `${CFG.urlDataSvc}/ngsi-ld/v1/entities/${encodeURIComponent(f.entityId||'urn:ngsi-ld:EnergyReport:fms-1')}`,
        null, { Authorization:`Bearer ${tok.accessToken}` });
      if (r.status!==200) throw new Error(`Expected 200, got ${r.status}. Wait 5s for OPA, then retry.`);
      return { tokenObtained:true, entity:r.body };
    },
  },
  {
    id:'5-1', phase:5, title:'Policy: Read Product Offerings (vc:any)',
    desc:'Allows any authenticated participant to read TMForum product offerings.',
    run: async () => {
      const uid = CFG.policyPrefix+'offering';
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, buildTmfPolicy(uid,'productOffering','odrl:read'), {'Content-Type':'application/json'});
      if (r.status===500) { const e=new Error('Policy UID already exists — safe to continue.'); e.isWarning=true; throw e; }
      if (r.status!==200&&r.status!==201) throw new Error(`PAP ${r.status}`);
      return { ok:true };
    },
  },
  {
    id:'5-2', phase:5, title:'Policy: REPRESENTATIVE Self-Registration',
    desc:'Allows REPRESENTATIVE role to create organizations.',
    run: async () => {
      const uid = CFG.policyPrefix+'selfRegistration';
      const body = {
        '@context': ODRL_CTX, '@id':uid, 'odrl:uid':uid, '@type':'odrl:Policy',
        'odrl:permission':{ 'odrl:assigner':{'@id':'https://www.mp-operation.org/'},
          'odrl:target':{'@type':'odrl:AssetCollection','odrl:source':'urn:asset','odrl:refinement':[{'@type':'odrl:Constraint','odrl:leftOperand':'tmf:resource','odrl:operator':{'@id':'odrl:eq'},'odrl:rightOperand':'organization'}]},
          'odrl:assignee':{'@type':'odrl:PartyCollection','odrl:source':'urn:user','odrl:refinement':{'@type':'odrl:LogicalConstraint','odrl:and':[{'@type':'odrl:Constraint','odrl:leftOperand':{'@id':'vc:role'},'odrl:operator':{'@id':'odrl:hasPart'},'odrl:rightOperand':{'@value':'REPRESENTATIVE','@type':'xsd:string'}},{'@type':'odrl:Constraint','odrl:leftOperand':{'@id':'vc:type'},'odrl:operator':{'@id':'odrl:hasPart'},'odrl:rightOperand':{'@value':'UserCredential','@type':'xsd:string'}}]}},
          'odrl:action':{'@id':'tmf:create'} },
      };
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, body, {'Content-Type':'application/json'});
      if (r.status===500) { const e=new Error('Already exists.'); e.isWarning=true; throw e; }
      return { ok:true };
    },
  },
  {
    id:'5-3', phase:5, title:'Policy: REPRESENTATIVE Product Ordering',
    desc:'Allows REPRESENTATIVE role to create product orders.',
    run: async () => {
      const uid = CFG.policyPrefix+'ordering';
      const body = { '@context':ODRL_CTX,'@id':uid,'odrl:uid':uid,'@type':'odrl:Policy','odrl:permission':{'odrl:assigner':{'@id':'https://www.mp-operation.org/'},'odrl:target':{'@type':'odrl:AssetCollection','odrl:source':'urn:asset','odrl:refinement':[{'@type':'odrl:Constraint','odrl:leftOperand':'tmf:resource','odrl:operator':{'@id':'odrl:eq'},'odrl:rightOperand':'productOrder'}]},'odrl:assignee':{'@type':'odrl:PartyCollection','odrl:source':'urn:user','odrl:refinement':{'@type':'odrl:LogicalConstraint','odrl:and':[{'@type':'odrl:Constraint','odrl:leftOperand':{'@id':'vc:role'},'odrl:operator':{'@id':'odrl:hasPart'},'odrl:rightOperand':{'@value':'REPRESENTATIVE','@type':'xsd:string'}},{'@type':'odrl:Constraint','odrl:leftOperand':{'@id':'vc:type'},'odrl:operator':{'@id':'odrl:hasPart'},'odrl:rightOperand':{'@value':'UserCredential','@type':'xsd:string'}}]}},'odrl:action':{'@id':'tmf:create'}}};
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, body, {'Content-Type':'application/json'});
      if (r.status===500) { const e=new Error('Already exists.'); e.isWarning=true; throw e; }
      return { ok:true };
    },
  },
  {
    id:'5-4', phase:5, title:'Policy: OPERATOR Read K8SCluster',
    desc:'Allows OPERATOR role (OperatorCredential) to read K8SCluster entities.',
    run: async () => {
      const uid = CFG.policyPrefix+'allowRead';
      const body = buildRolePolicy(uid,'K8SCluster','odrl:read','OperatorCredential','OPERATOR');
      const r = await httpProxy('POST', `${CFG.urlPAP}/policy`, body, {'Content-Type':'application/json'});
      if (r.status===500) { const e=new Error('Already exists.'); e.isWarning=true; throw e; }
      return { ok:true };
    },
  },
  {
    id:'6-1', phase:6, title:'Create Product Spec (Small — 3 nodes max)',
    desc:'ProductSpecification with embedded ODRL k8s-small policy (numNodes ≤ 3).',
    form:[
      { id:'specName',  label:'Spec Name',      default:'M&P K8S Small' },
      { id:'brand',     label:'Brand',            default:'M&P Operations' },
      { id:'policyUid', label:'Policy UID suffix',default:'k8s-small' },
    ],
    run: async (f) => {
      const puid = CFG.policyPrefix+(f.policyUid||'k8s-small');
      const body = { brand:f.brand||'M&P Operations', version:'1.0.0', lifecycleStatus:'ACTIVE', name:f.specName||'M&P K8S Small',
        productSpecCharacteristic:[
          { id:'credentialsConfig', name:'Credentials Config', valueType:'credentialsConfiguration',
            productSpecCharacteristicValue:[{isDefault:true,value:{credentialsType:'OperatorCredential',claims:[{name:'roles',path:`$.roles[?(@.target=="${CFG.providerDid}")].names[*]`,allowedValues:['OPERATOR']}]}}]},
          { id:'policyConfig', name:'Policy', valueType:'authorizationPolicy',
            productSpecCharacteristicValue:[{isDefault:true,value:{
              '@context':{odrl:'http://www.w3.org/ns/odrl/2/'},'@id':puid,'odrl:uid':puid,'@type':'odrl:Policy',
              'odrl:permission':{'odrl:assigner':'https://www.mp-operation.org/','odrl:target':{'@type':'odrl:AssetCollection','odrl:source':'urn:asset','odrl:refinement':[{'@type':'odrl:Constraint','odrl:leftOperand':'ngsi-ld:entityType','odrl:operator':'odrl:eq','odrl:rightOperand':'K8SCluster'},{'@type':'odrl:Constraint','http:bodyValue':'$.numNodes.value','odrl:operator':'odrl:eq','odrl:rightOperand':'3'}]},'odrl:assignee':{'@type':'odrl:PartyCollection','odrl:source':'urn:user','odrl:refinement':{'@type':'odrl:LogicalConstraint','odrl:and':[{'@type':'odrl:Constraint','odrl:leftOperand':'vc:role','odrl:operator':'odrl:hasPart','odrl:rightOperand':{'@value':'OPERATOR','@type':'xsd:string'}},{'@type':'odrl:Constraint','odrl:leftOperand':'vc:type','odrl:operator':'odrl:hasPart','odrl:rightOperand':{'@value':'OperatorCredential','@type':'xsd:string'}}]}},'odrl:action':'odrl:use'},
            }}]},
        ]};
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productSpecification`, body, {'Content-Type':'application/json;charset=utf-8'});
      if (!r.body?.id) throw new Error(`No id returned. Status: ${r.status}`);
      await saveState({ PRODUCT_SPEC_SMALL_ID: r.body.id });
      return { id:r.body.id };
    },
  },
  {
    id:'6-2', phase:6, title:'Create Product Spec (Full — no node limit)',
    desc:'ProductSpecification with embedded ODRL k8s-full policy (no numNodes constraint).',
    form:[
      { id:'specName',  label:'Spec Name',      default:'M&P K8S' },
      { id:'brand',     label:'Brand',            default:'M&P Operations' },
      { id:'policyUid', label:'Policy UID suffix',default:'k8s-full' },
    ],
    run: async (f) => {
      const puid = CFG.policyPrefix+(f.policyUid||'k8s-full');
      const body = { brand:f.brand||'M&P Operations', version:'1.0.0', lifecycleStatus:'ACTIVE', name:f.specName||'M&P K8S',
        productSpecCharacteristic:[
          { id:'credentialsConfig', name:'Credentials Config', valueType:'credentialsConfiguration',
            productSpecCharacteristicValue:[{isDefault:true,value:{credentialsType:'OperatorCredential',claims:[{name:'roles',path:`$.roles[?(@.target=="${CFG.providerDid}")].names[*]`,allowedValues:['OPERATOR']}]}}]},
          { id:'policyConfig', name:'Policy', valueType:'authorizationPolicy',
            productSpecCharacteristicValue:[{isDefault:true,value:{
              '@context':{odrl:'http://www.w3.org/ns/odrl/2/'},'@id':puid,'odrl:uid':puid,'@type':'odrl:Policy',
              'odrl:permission':{'odrl:assigner':'https://www.mp-operation.org/','odrl:target':{'@type':'odrl:AssetCollection','odrl:source':'urn:asset','odrl:refinement':[{'@type':'odrl:Constraint','odrl:leftOperand':'ngsi-ld:entityType','odrl:operator':'odrl:eq','odrl:rightOperand':'K8SCluster'}]},'odrl:assignee':{'@type':'odrl:PartyCollection','odrl:source':'urn:user','odrl:refinement':{'@type':'odrl:LogicalConstraint','odrl:and':[{'@type':'odrl:Constraint','odrl:leftOperand':'vc:role','odrl:operator':'odrl:hasPart','odrl:rightOperand':{'@value':'OPERATOR','@type':'xsd:string'}},{'@type':'odrl:Constraint','odrl:leftOperand':'vc:type','odrl:operator':'odrl:hasPart','odrl:rightOperand':{'@value':'OperatorCredential','@type':'xsd:string'}}]}},'odrl:action':'odrl:use'},
            }}]},
        ]};
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productSpecification`, body, {'Content-Type':'application/json;charset=utf-8'});
      if (!r.body?.id) throw new Error(`No id returned. Status: ${r.status}`);
      await saveState({ PRODUCT_SPEC_FULL_ID: r.body.id });
      return { id:r.body.id };
    },
  },
  {
    id:'6-3', phase:6, title:'Create Product Offering (Small)',
    desc:'Wraps the small spec into a marketplace listing.',
    requires:['PRODUCT_SPEC_SMALL_ID'],
    run: async () => {
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productOffering`,
        { version:'1.0.0', lifecycleStatus:'ACTIVE', name:'M&P K8S Offering Small', productSpecification:{id:S.PRODUCT_SPEC_SMALL_ID} },
        {'Content-Type':'application/json;charset=utf-8'});
      if (!r.body?.id) throw new Error(`No id. Status: ${r.status}`);
      await saveState({ PRODUCT_OFFERING_SMALL_ID: r.body.id });
      return { id:r.body.id };
    },
  },
  {
    id:'6-4', phase:6, title:'Create Product Offering (Full)',
    desc:'Wraps the full spec into a marketplace listing.',
    requires:['PRODUCT_SPEC_FULL_ID'],
    run: async () => {
      const r = await httpProxy('POST', `${CFG.urlTMF}/tmf-api/productCatalogManagement/v4/productOffering`,
        { version:'1.0.0', lifecycleStatus:'ACTIVE', name:'M&P K8S Offering', productSpecification:{id:S.PRODUCT_SPEC_FULL_ID} },
        {'Content-Type':'application/json;charset=utf-8'});
      if (!r.body?.id) throw new Error(`No id. Status: ${r.status}`);
      await saveState({ PRODUCT_OFFERING_FULL_ID: r.body.id, OFFER_ID: r.body.id });
      return { id:r.body.id };
    },
  },
  {
    id:'7-1', phase:7, title:'Pre-check: USER → 403 on K8SCluster',
    desc:'Confirms employee credential cannot create K8SClusters. Expected: 403.',
    requires:['USER_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.USER_CREDENTIAL,'default');
      if (!tok.accessToken) throw new Error('Could not get USER access token.');
      const r = await httpProxy('POST', `${CFG.urlDataSvc}/ngsi-ld/v1/entities`,
        { id:'urn:ngsi-ld:K8SCluster:precheck', type:'K8SCluster', numNodes:{type:'Property',value:1} },
        { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
      if (r.status!==403) throw new Error(`Expected 403, got ${r.status}. OPA policies may not be loaded yet.`);
      return { status:403, result:'403 Forbidden — USER_CREDENTIAL cannot create K8SClusters.' };
    },
  },
  {
    id:'7-2', phase:7, title:'Pre-check: OPERATOR → null token (not trusted yet)',
    desc:'Confirms operator cannot get token before org is registered in TIR.',
    requires:['OPERATOR_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.OPERATOR_CREDENTIAL,'operator');
      if (tok.accessToken) { const e=new Error('Got a token already — TIR may be pre-populated. Skip this step.'); e.isWarning=true; throw e; }
      return { accessToken:null, result:'null token — Fancy Marketplace not yet in TIR.' };
    },
  },
  {
    id:'7-3', phase:7, title:'Register Customer Organization',
    desc:'Uses REP_CREDENTIAL + OID4VP to register org in TMForum Party API.',
    requires:['REP_CREDENTIAL','holderDid'],
    form:[
      { id:'orgName', label:'Organization Name', default:'Fancy Marketplace Inc.' },
      { id:'orgDid',  label:'Organization DID',  placeholder:'did:web:fancy-marketplace.biz', hint:'Blank = use Settings consumer DID' },
    ],
    run: async (f) => {
      const did = f.orgDid || CFG.consumerDid;
      const tok = await getAccessToken(S.REP_CREDENTIAL,'default');
      if (!tok.accessToken) throw new Error('REP access token failed.');
      const r = await httpProxy('POST', `${CFG.urlMpTMF}/tmf-api/party/v4/organization`,
        { name:f.orgName||'Fancy Marketplace Inc.', partyCharacteristic:[{name:'did',value:did}] },
        { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
      if (!r.body?.id) throw new Error(`Failed: ${r.status} ${JSON.stringify(r.body)}`);
      await saveState({ FANCY_MARKETPLACE_ID: r.body.id });
      return { organizationId:r.body.id, did };
    },
  },
  {
    id:'7-4', phase:7, title:'List Product Offerings (as REP)',
    desc:'Browse marketplace catalog and capture OFFER_ID.',
    requires:['REP_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.REP_CREDENTIAL,'default');
      if (!tok.accessToken) throw new Error('REP access token failed.');
      const r = await httpProxy('GET', `${CFG.urlMpTMF}/tmf-api/productCatalogManagement/v4/productOffering`,
        null, { Authorization:`Bearer ${tok.accessToken}` });
      if (!Array.isArray(r.body)) throw new Error(`Unexpected response: ${JSON.stringify(r.body)}`);
      if (r.body[1]?.id) await saveState({ OFFER_ID: r.body[1].id });
      return { count:r.body.length, capturedOfferID: r.body[1]?.id };
    },
  },
  {
    id:'7-5', phase:7, title:'Place Product Order',
    desc:'Creates a ProductOrder for the full K8S offering.',
    requires:['REP_CREDENTIAL','holderDid','FANCY_MARKETPLACE_ID','OFFER_ID'],
    run: async () => {
      const tok = await getAccessToken(S.REP_CREDENTIAL,'default');
      if (!tok.accessToken) throw new Error('REP access token failed.');
      const r = await httpProxy('POST', `${CFG.urlMpTMF}/tmf-api/productOrderingManagement/v4/productOrder`,
        { productOrderItem:[{id:'item-1',action:'add',productOffering:{id:S.OFFER_ID}}], relatedParty:[{id:S.FANCY_MARKETPLACE_ID}] },
        { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
      if (!r.body?.id) throw new Error(`Order failed: ${r.status} ${JSON.stringify(r.body)}`);
      await saveState({ ORDER_ID: r.body.id });
      return { orderId:r.body.id, state:r.body.state };
    },
  },
  {
    id:'7-6', phase:7, title:'Complete Order → triggers Contract Management',
    desc:'PATCH order state=completed. Triggers TIR update + policy registration. Wait ~3s before Phase 8.',
    requires:['ORDER_ID'],
    run: async () => {
      const r = await httpProxy('PATCH', `${CFG.urlTMF}/tmf-api/productOrderingManagement/v4/productOrder/${S.ORDER_ID}`,
        { state:'completed' }, {'Content-Type':'application/json;charset=utf-8',Accept:'application/json;charset=utf-8'});
      if (r.status!==200&&r.status!==201) throw new Error(`Expected 200/201, got ${r.status}`);
      return { state:r.body?.state, note:'Contract Management is processing asynchronously. Wait ~3s before Phase 8.' };
    },
  },
  {
    id:'8-1', phase:8, title:'Get OPERATOR Token (post-purchase)',
    desc:'Now that Contract Management updated TIR, OperatorCredential should yield a valid JWT.',
    requires:['OPERATOR_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.OPERATOR_CREDENTIAL,'operator');
      if (!tok.accessToken) throw new Error('Still null — wait a few seconds for Contract Management, then retry.');
      return { tokenPreview:tok.accessToken.substring(0,40)+'…', result:'Valid OPERATOR token!' };
    },
  },
  {
    id:'8-2', phase:8, title:'Create K8SCluster (3 nodes)',
    desc:'Create cluster with numNodes=3 using OPERATOR token. Expected: 201.',
    requires:['OPERATOR_CREDENTIAL','holderDid'],
    form:[
      { id:'clusterId',   label:'Cluster ID',   default:'urn:ngsi-ld:K8SCluster:test-1' },
      { id:'clusterName', label:'Cluster Name', default:'test-cluster' },
      { id:'numNodes',    label:'Nodes',         default:'3', type:'number' },
    ],
    run: async (f) => {
      const tok = await getAccessToken(S.OPERATOR_CREDENTIAL,'operator');
      if (!tok.accessToken) throw new Error('OPERATOR token null — run step 8-1 first.');
      const r = await httpProxy('POST', `${CFG.urlDataSvc}/ngsi-ld/v1/entities`,
        { id:f.clusterId, type:'K8SCluster', name:{type:'Property',value:f.clusterName}, numNodes:{type:'Property',value:parseInt(f.numNodes)||3} },
        { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
      if (r.status!==201&&r.status!==409) throw new Error(`Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
      return { status:r.status, note:r.status===409?'Already exists (ok)':'201 Created' };
    },
  },
  {
    id:'8-3', phase:8, title:'Create K8SCluster (4 nodes — full offering)',
    desc:'numNodes=4, no constraint in full offering policy. Expected: 201.',
    requires:['OPERATOR_CREDENTIAL','holderDid'],
    form:[
      { id:'clusterId',   label:'Cluster ID',   default:'urn:ngsi-ld:K8SCluster:test-2' },
      { id:'clusterName', label:'Cluster Name', default:'big-cluster' },
      { id:'numNodes',    label:'Nodes',         default:'4', type:'number' },
    ],
    run: async (f) => {
      const tok = await getAccessToken(S.OPERATOR_CREDENTIAL,'operator');
      if (!tok.accessToken) throw new Error('OPERATOR token null.');
      const r = await httpProxy('POST', `${CFG.urlDataSvc}/ngsi-ld/v1/entities`,
        { id:f.clusterId, type:'K8SCluster', name:{type:'Property',value:f.clusterName}, numNodes:{type:'Property',value:parseInt(f.numNodes)||4} },
        { Authorization:`Bearer ${tok.accessToken}`, 'Content-Type':'application/json' });
      if (r.status!==201&&r.status!==409) throw new Error(`Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
      return { status:r.status, note:r.status===409?'Already exists':'201 Created — full offering has no numNodes constraint!' };
    },
  },
  {
    id:'8-4', phase:8, title:'List K8SClusters (OPERATOR)',
    desc:'Read all K8SCluster entities. Expects 2 clusters.',
    requires:['OPERATOR_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.OPERATOR_CREDENTIAL,'operator');
      if (!tok.accessToken) throw new Error('OPERATOR token null.');
      const r = await httpProxy('GET', `${CFG.urlDataSvc}/ngsi-ld/v1/entities?type=K8SCluster`,
        null, { Authorization:`Bearer ${tok.accessToken}` });
      if (r.status!==200) throw new Error(`Expected 200, got ${r.status}`);
      return { count:Array.isArray(r.body)?r.body.length:'?', entities:r.body };
    },
  },
  {
    id:'8-5', phase:8, title:'Verify USER → 403 on K8SCluster List',
    desc:'Confirms plain USER credential cannot read K8SClusters. Expected: 403.',
    requires:['USER_CREDENTIAL','holderDid'],
    run: async () => {
      const tok = await getAccessToken(S.USER_CREDENTIAL,'default');
      if (!tok.accessToken) throw new Error('USER token failed.');
      const r = await httpProxy('GET', `${CFG.urlDataSvc}/ngsi-ld/v1/entities?type=K8SCluster`,
        null, { Authorization:`Bearer ${tok.accessToken}` });
      if (r.status!==403) throw new Error(`Expected 403, got ${r.status}`);
      return { status:403, result:'403 Forbidden — access control working correctly!' };
    },
  },
];

// Step execution state
const _stepStatus  = {};
const _stepResp    = {};

Pages.demo = function (jumpPhase) {
  let _phase = jumpPhase || 1;

  function render() {
    const phaseSteps = STEPS.filter(s => s.phase === _phase);
    document.getElementById('page-content').innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Demo Wizard</div><div class="page-desc">Step-by-step deployment walkthrough. All values pre-filled from Settings.</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
        ${DEMO_PHASES.map(p => `<button class="btn ${_phase===p.id?'btn-primary':'btn-secondary'} btn-sm" onclick="demoJumpPhase(${p.id})">${p.icon} ${p.id}: ${p.title}</button>`).join('')}
      </div>
      <div class="card" style="margin-bottom:12px;padding:14px 16px">
        <div style="font-size:15px;font-weight:700">${DEMO_PHASES[_phase-1].icon} Phase ${_phase}: ${DEMO_PHASES[_phase-1].title}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${DEMO_PHASES[_phase-1].desc}</div>
      </div>
      ${phaseSteps.map(step => renderStepCard(step)).join('')}`;
  }

  window.demoJumpPhase = function (id) { _phase = id; render(); };

  function renderStepCard(step) {
    const st   = _stepStatus[step.id] || 'idle';
    const hasMiss = (step.requires||[]).filter(k => !S[k]);
    const statusColors = { idle:'grey', running:'yellow', success:'green', error:'red', warning:'yellow' };
    const statusIcons  = { idle:I.demo, running:I.spin, success:I.check, error:I.x, warning:I.warn };
    return `<div id="step-${step.id}" style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(${st==='success'?'--green':st==='error'?'--red':st==='warning'?'--yellow':'--border'});border-radius:var(--r-lg);padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
        <span style="background:var(--surface);color:var(--accent);border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;flex-shrink:0">${esc(step.id)}</span>
        <div style="flex:1"><div style="font-size:13px;font-weight:600">${esc(step.title)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(step.desc)}</div>
        </div>
        <span class="badge badge-${statusColors[st]}">${statusIcons[st]} ${esc(st)}</span>
      </div>
      ${hasMiss.length ? `<div style="font-size:11px;color:var(--yellow);margin-bottom:8px">${I.warn} Requires: ${hasMiss.join(', ')}</div>` : ''}
      ${step.form ? renderStepForm(step) : ''}
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        ${step.form
          ? `<button class="btn btn-primary btn-sm" onclick="runDemoStep('${step.id}')">${I.demo} Run</button>`
          : `<button class="btn btn-primary btn-sm" onclick="runDemoStep('${step.id}')">${I.demo} Run</button>`
        }
        ${_stepResp[step.id] ? `<span style="font-size:11px;color:var(--muted)">Response cached — see below</span>` : ''}
      </div>
      ${_stepResp[step.id] ? `<details style="margin-top:8px"><summary style="font-size:11px;color:var(--muted);cursor:pointer">Response</summary><pre class="code-block" style="margin-top:6px">${esc(JSON.stringify(_stepResp[step.id],null,2))}</pre></details>` : ''}
    </div>`;
  }

  function renderStepForm(step) {
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px">${
      step.form.map(f => `<div class="field"><label>${esc(f.label)}</label>
        <input id="sf-${step.id}-${f.id}" type="${f.type||'text'}" value="${esc(f.default||'')}" placeholder="${esc(f.placeholder||f.default||'')}"/>
      </div>`).join('')
    }</div>`;
  }

  window.runDemoStep = async function (stepId) {
    const step = STEPS.find(s => s.id === stepId);
    if (!step) return;
    const miss = (step.requires||[]).filter(k => !S[k]);
    if (miss.length) { toast(`Missing: ${miss.join(', ')}`, 'warning'); return; }

    const formValues = {};
    if (step.form) {
      step.form.forEach(f => {
        formValues[f.id] = (document.getElementById(`sf-${step.id}-${f.id}`)?.value?.trim()) || f.default || '';
      });
    }

    _stepStatus[step.id] = 'running';
    renderStepInline(step.id, 'running', null);

    try {
      const result = await step.run(formValues);
      _stepStatus[step.id]  = 'success';
      _stepResp[step.id]    = result;
      renderStepInline(step.id, 'success', result);
      toast(`Step ${step.id} succeeded`, 'success');
    } catch (e) {
      _stepStatus[step.id]  = e.isWarning ? 'warning' : 'error';
      _stepResp[step.id]    = { message: e.message };
      renderStepInline(step.id, e.isWarning ? 'warning' : 'error', { message: e.message });
      toast(e.message, e.isWarning ? 'warning' : 'error', `Step ${step.id}`);
    }
  };

  function renderStepInline(stepId, status, resp) {
    const step = STEPS.find(s => s.id === stepId);
    if (!step) return;
    const el = document.getElementById(`step-${stepId}`);
    if (!el) return;
    const colors = { idle:'var(--border)', running:'var(--yellow)', success:'var(--green)', error:'var(--red)', warning:'var(--yellow)' };
    el.style.borderLeftColor = colors[status] || colors.idle;
    const badge = el.querySelector('.badge');
    const statusIcons = { running:I.spin, success:I.check, error:I.x, warning:I.warn, idle:I.demo };
    if (badge) { badge.className = `badge badge-${{running:'yellow',success:'green',error:'red',warning:'yellow',idle:'grey'}[status]}`; badge.innerHTML = `${statusIcons[status]} ${status}`; }
    if (resp) {
      let det = el.querySelector('details');
      if (!det) {
        det = document.createElement('details');
        det.style.marginTop = '8px';
        el.appendChild(det);
      }
      det.innerHTML = `<summary style="font-size:11px;color:var(--muted);cursor:pointer">Response</summary><pre class="code-block" style="margin-top:6px">${esc(JSON.stringify(resp,null,2))}</pre>`;
      det.open = true;
    }
  }

  render();
};
