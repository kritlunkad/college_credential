/**
 * college.js — College Issuer Portal logic
 */

(async function CollegePortal() {
  // ── State ───────────────────────────────────────────────────────
  let privateKey = null;
  let publicKeyJwk = null;
  let selectedType = null;
  let issuerWalletAddress = null;
  const ISSUER_WALLET_KEY = 'cc_selected_issuer_wallet';

  function formatAddress(addr) {
    if (!addr || typeof addr !== 'string') return '—';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function renderIssuerWallet() {
    const statusEl = document.getElementById('issuer-wallet-status');
    const addressEl = document.getElementById('issuer-wallet-address');
    if (!statusEl || !addressEl) return;

    if (issuerWalletAddress) {
      statusEl.textContent = `Connected: ${formatAddress(issuerWalletAddress)}`;
      statusEl.style.color = 'var(--accent-green-light)';
      addressEl.textContent = issuerWalletAddress;
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.style.color = 'var(--text-secondary)';
      addressEl.textContent = '—';
    }
  }

  function loadIssuerWalletSelection() {
    try {
      const v = localStorage.getItem(ISSUER_WALLET_KEY);
      issuerWalletAddress = v || null;
    } catch {
      issuerWalletAddress = null;
    }
  }

  function saveIssuerWalletSelection(addr) {
    try {
      if (addr) localStorage.setItem(ISSUER_WALLET_KEY, addr);
      else localStorage.removeItem(ISSUER_WALLET_KEY);
    } catch {
      // ignore storage failures
    }
  }

  async function connectIssuerWallet(requestAccess = true) {
    if (typeof BlockchainModule === 'undefined') {
      if (requestAccess) showToast('Blockchain module not loaded', 'error');
      return null;
    }
    if (!window.ethereum) {
      if (requestAccess) showToast('MetaMask not detected', 'error');
      return null;
    }

    try {
      const addr = await BlockchainModule.getConnectedAddress(requestAccess);
      issuerWalletAddress = addr || null;
      saveIssuerWalletSelection(issuerWalletAddress);
      renderIssuerWallet();
      if (addr && requestAccess) {
        showToast(`Issuer wallet connected: ${formatAddress(addr)}`, 'success');
      }
      return issuerWalletAddress;
    } catch (e) {
      if (requestAccess) showToast(`Wallet connect failed: ${e.message}`, 'error');
      issuerWalletAddress = null;
      saveIssuerWalletSelection(null);
      renderIssuerWallet();
      return null;
    }
  }

  // ── Initialize keys ─────────────────────────────────────────────
  async function initKeys() {
    const statusEl = document.getElementById('key-status');
    const statusText = document.getElementById('key-status-text');

    try {
      // Check if we already have keys in session
      const storedPriv = Store.getPrivateKey();
      if (storedPriv) {
        privateKey = await CryptoModule.importPrivateKey(storedPriv);
        // Derive public key from stored private JWK
        publicKeyJwk = { ...storedPriv };
        delete publicKeyJwk.d; // Remove private component for the public key
        publicKeyJwk.key_ops = ['verify'];
      } else {
        // Generate fresh key pair
        const keyPair = await CryptoModule.generateKeyPair();
        privateKey = keyPair.privateKey;
        publicKeyJwk = await CryptoModule.exportPublicKey(keyPair.publicKey);

        // Store private key in sessionStorage (ephemeral)
        const privJwk = await CryptoModule.exportPrivateKey(keyPair.privateKey);
        Store.savePrivateKey(privJwk);
      }

      // Register public key for the issuer
      const issuerName = document.getElementById('issuer-name').value.trim();
      Store.savePublicKey(issuerName, publicKeyJwk);

      statusEl.classList.add('active');
      statusText.textContent = `Key pair active — ECDSA P-256 · Public key registered for ${issuerName}`;

      Store.appendAuditLog({
        event: 'key_generated',
        actor: 'College Portal',
        details: `ECDSA P-256 key pair initialized for ${issuerName}`,
      });
    } catch (e) {
      statusEl.style.color = 'var(--accent-red)';
      statusText.textContent = 'Failed to initialize keys: ' + e.message;
      console.error(e);
    }
  }

  // ── Render type selector ────────────────────────────────────────
  function renderTypeSelector() {
    const container = document.getElementById('type-selector');
    container.innerHTML = '';

    Object.entries(CredentialTypes).forEach(([key, type]) => {
      const btn = document.createElement('button');
      btn.className = 'type-option';
      btn.innerHTML = `${type.icon} ${type.label}`;
      btn.dataset.type = key;
      btn.addEventListener('click', () => selectType(key));
      container.appendChild(btn);
    });
  }

  function selectType(key) {
    selectedType = key;
    // Update selector UI
    document.querySelectorAll('.type-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.type === key);
    });
    renderForm(CredentialTypes[key]);
    document.getElementById('btn-issue').disabled = false;
  }

  // ── Render dynamic form ─────────────────────────────────────────
  function renderForm(type) {
    const formEl = document.getElementById('credential-form');
    const titleEl = document.getElementById('form-title');
    titleEl.innerHTML = `${type.icon} ${type.label} Fields`;
    formEl.innerHTML = '';

    type.fields.forEach(field => {
      const group = document.createElement('div');
      group.className = 'form-group' + (field.type === 'textarea' ? ' full-width' : '');

      let input;
      if (field.type === 'select') {
        input = document.createElement('select');
        input.className = 'form-select';
        field.options.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt;
          o.textContent = opt;
          input.appendChild(o);
        });
      } else if (field.type === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'form-textarea';
      } else {
        input = document.createElement('input');
        input.className = 'form-input';
        input.type = field.type;
      }

      input.id = 'field-' + field.key;
      input.placeholder = field.label;
      if (field.type === 'number' && field.key === 'gpa') {
        input.min = 0;
        input.max = 10;
        input.step = 0.1;
      }

      const label = document.createElement('label');
      label.className = 'form-label';
      label.htmlFor = input.id;
      label.innerHTML = field.label + (field.required ? ' <span class="required">*</span>' : '');

      group.appendChild(label);
      group.appendChild(input);
      formEl.appendChild(group);
    });
  }

  // ── Fill sample data ────────────────────────────────────────────
  function fillSampleData() {
    if (!selectedType) {
      showToast('Select a credential type first', 'error');
      return;
    }
    const sample = SAMPLE_STUDENTS[0]; // Use first sample student
    const type = CredentialTypes[selectedType];

    type.fields.forEach(field => {
      const el = document.getElementById('field-' + field.key);
      if (el && sample[field.key] !== undefined) {
        el.value = sample[field.key];
      }
    });

    showToast('Sample data filled', 'info');
  }

  // ── Issue credential ────────────────────────────────────────────
  async function issueCredential() {
    if (!selectedType || !privateKey) return;

    const type = CredentialTypes[selectedType];
    const subjectData = {};

    // Collect form data
    for (const field of type.fields) {
      const el = document.getElementById('field-' + field.key);
      if (!el) continue;

      let value = el.value.trim();

      if (field.required && !value) {
        showToast(`${field.label} is required`, 'error');
        el.focus();
        return;
      }

      // Type coercion
      if (field.type === 'number' && value) {
        value = parseFloat(value);
      }
      if (field.key === 'courses' && value) {
        value = value.split(',').map(s => s.trim()).filter(Boolean);
      }

      subjectData[field.key] = value;
    }

    const issuerName = document.getElementById('issuer-name').value.trim();
    const issuerDid = document.getElementById('issuer-did').value.trim();
    const expiryDays = parseInt(document.getElementById('expiry-days').value) || 365;

    if (!issuerWalletAddress) {
      showToast('Connect the issuer MetaMask wallet before issuing', 'error');
      return;
    }

    const issuer = { id: issuerDid, name: issuerName, walletAddress: issuerWalletAddress };

    // Build credential
    const credential = buildCredential(type, subjectData, issuer, expiryDays);

    // Embed issuer's public key for self-contained verification
    credential.issuerPublicKey = publicKeyJwk;

    // Sign the credential subject
    const signature = await CryptoModule.signData(privateKey, credential.credentialSubject);

    credential.proof = {
      type: 'EcdsaSecp256r1Signature2019',
      created: new Date().toISOString(),
      verificationMethod: `${issuerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      signature: signature,
    };

    // Save
    Store.saveCredential(credential);
    Store.appendAuditLog({
      event: 'issued',
      actor: issuerName,
      details: `${type.label} issued to ${subjectData.name} (${subjectData.enrollmentId})`,
      credentialId: credential.id,
    });

    showToast(`✅ ${type.label} issued to ${subjectData.name}`, 'success');

    // Reset form
    document.getElementById('credential-form').querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'select-one') el.selectedIndex = 0;
      else el.value = '';
    });

    renderIssuedList();
    renderStats();
    renderAuditLog();
  }

  // ── Render issued credentials ───────────────────────────────────
  function renderIssuedList() {
    const container = document.getElementById('issued-list');
    const credentials = Store.getAllCredentials();

    if (credentials.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📄</div>
          <div class="empty-state-title">No credentials issued yet</div>
          <p style="color: var(--text-muted); font-size: 0.85rem;">Select a credential type above and fill in the student details.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    credentials.slice().reverse().forEach(cred => {
      const typeInfo = getCredentialTypeInfo(cred.type[1]) || { icon: '📄', label: cred.type[1], color: '#666' };
      const isRevoked = Store.isRevoked(cred.id);
      const isClaimed = Store.isCredentialClaimed(cred.id);
      const expiry = getExpiryStatus(cred.expirationDate);

      const card = document.createElement('div');
      card.className = 'credential-mini fade-in';
      card.innerHTML = `
        <div class="credential-mini-icon" style="background: ${typeInfo.color}22; color: ${typeInfo.color};">
          ${typeInfo.icon}
        </div>
        <div class="credential-mini-info">
          <div class="credential-mini-title">
            ${typeInfo.label} — ${cred.credentialSubject.name}
            ${isRevoked ? '<span class="badge badge-revoked">Revoked</span>' : ''}
            ${isClaimed ? '<span class="badge badge-valid">Claimed</span>' : ''}
            <span class="badge ${expiry.class}">${expiry.label}</span>
          </div>
          <div class="credential-mini-sub">
            ${cred.credentialSubject.enrollmentId} · ID: ${cred.id} · Issued: ${new Date(cred.issuanceDate).toLocaleDateString()}
          </div>
        </div>
        ${!isRevoked ? `<button class="btn btn-danger btn-sm" data-revoke="${cred.id}">Revoke</button>` : ''}
      `;
      container.appendChild(card);
    });

    // Attach revoke handlers
    container.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.revoke;
        Store.revokeCredential(id);
        Store.appendAuditLog({
          event: 'revoked',
          actor: document.getElementById('issuer-name').value,
          details: `Credential ${id} revoked`,
          credentialId: id,
        });
        showToast('Credential revoked', 'info');
        renderIssuedList();
        renderStats();
        renderAuditLog();
      });
    });
  }

  // ── Render stats ────────────────────────────────────────────────
  function renderStats() {
    const all = Store.getAllCredentials();
    const claimed = Store.getClaimedCredentials();
    const revoked = Store.getRevokedIds();

    document.getElementById('stat-total').textContent = all.length;
    document.getElementById('stat-claimed').textContent = claimed.length;
    document.getElementById('stat-revoked').textContent = revoked.length;
  }

  // ── Render audit log ────────────────────────────────────────────
  function renderAuditLog() {
    const log = Store.getAuditLog();
    const body = document.getElementById('audit-body');
    const empty = document.getElementById('audit-empty');

    if (log.length === 0) {
      body.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    body.innerHTML = log.slice().reverse().slice(0, 50).map(entry => `
      <tr>
        <td style="white-space:nowrap; font-size:0.75rem;">${new Date(entry.timestamp).toLocaleString()}</td>
        <td><span class="audit-event ${entry.event}">${entry.event}</span></td>
        <td>${entry.details || '—'}</td>
        <td>${entry.actor || '—'}</td>
      </tr>
    `).join('');
  }

  // ── Toast notifications ─────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type]}</span>
      <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── Export audit log ────────────────────────────────────────────
  function exportLog() {
    const data = Store.exportAuditLog();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credchain-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Audit log exported', 'success');
  }

  // ── Event listeners ─────────────────────────────────────────────
  document.getElementById('btn-issue').addEventListener('click', issueCredential);
  document.getElementById('btn-fill-sample').addEventListener('click', fillSampleData);
  document.getElementById('btn-export-log').addEventListener('click', exportLog);
  document.getElementById('btn-connect-issuer-wallet').addEventListener('click', () => connectIssuerWallet(true));

  // Re-register public key when issuer name changes
  document.getElementById('issuer-name').addEventListener('change', () => {
    const name = document.getElementById('issuer-name').value.trim();
    if (publicKeyJwk) {
      Store.savePublicKey(name, publicKeyJwk);
    }
  });

  // Reactive updates
  StateManager.on('credential:issued', () => { renderIssuedList(); renderStats(); });
  StateManager.on('store:updated', () => { renderIssuedList(); renderStats(); renderAuditLog(); });
  StateManager.enableCrossTabSync();

  // ── Init ────────────────────────────────────────────────────────
  loadIssuerWalletSelection();
  renderIssuerWallet();

  await initKeys();
  renderTypeSelector();
  renderIssuedList();
  renderStats();
  renderAuditLog();
})();
