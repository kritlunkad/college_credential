/**
 * college.js — College Issuer Portal logic
 */

(async function CollegePortal() {
  // ── State ───────────────────────────────────────────────────────
  let privateKey = null;
  let publicKeyJwk = null;
  let selectedType = null;
  let issuerWalletAddress = null;
  let adminUser = null;
  const ISSUER_WALLET_KEY = 'cc_selected_issuer_wallet';
  const cloudAuthEnabled = !!window.FIREBASE_CONFIG?.apiKey;
  const MAX_SOURCE_DOC_BYTES = 2 * 1024 * 1024; // 2MB

  function renderAdminAuth() {
    const el = document.getElementById('admin-auth-status');
    if (!el) return;
    if (adminUser) {
      el.textContent = `Authenticated as ${adminUser.email || adminUser.uid}`;
      el.style.color = 'var(--accent-green-light)';
    } else {
      el.textContent = 'Not authenticated';
      el.style.color = 'var(--text-secondary)';
    }
  }

  async function adminLogin() {
    if (typeof CloudAuth === 'undefined') {
      showToast('Cloud auth not configured', 'error');
      return;
    }
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-password').value;
    if (!email || !password) {
      showToast('Enter admin email and password', 'error');
      return;
    }
    try {
      await CloudAuth.signInAdminEmailPassword(email, password);
      showToast('Admin login successful', 'success');
    } catch (e) {
      showToast(`Admin login failed: ${e.message}`, 'error');
    }
  }

  async function adminLogout() {
    if (typeof CloudAuth === 'undefined') return;
    try {
      await CloudAuth.signOut();
      showToast('Logged out', 'info');
    } catch (e) {
      showToast(`Logout failed: ${e.message}`, 'error');
    }
  }

  function formatAddress(addr) {
    if (!addr || typeof addr !== 'string') return '—';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function generateClaimCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  async function sha256OfBuffer(arrayBuffer) {
    const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function prepareSourceDocumentUpload() {
    const fileInput = document.getElementById('source-doc-file');
    const typeInput = document.getElementById('source-doc-type');
    const selectedType = typeInput?.value?.trim() || null;
    const file = fileInput?.files?.[0];

    if (!file) return { payload: null, evidence: null };
    if (file.size > MAX_SOURCE_DOC_BYTES) {
      throw new Error('Source document must be 2MB or smaller');
    }

    const arrayBuffer = await file.arrayBuffer();
    const sha256 = await sha256OfBuffer(arrayBuffer);
    const evidence = {
      type: selectedType,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      sha256,
      storagePath: null,
      uploadedAt: new Date().toISOString(),
      status: 'local_only',
      reason: null,
    };

    return { payload: null, evidence };
  }

  function renderIssuerWallet() {
    const statusEl = document.getElementById('issuer-wallet-status');
    const dotEl = statusEl?.querySelector('.dot');
    const labelEl = statusEl?.querySelector('span:not(.dot)');
    const addressEl = document.getElementById('issuer-wallet-address');
    if (!statusEl || !addressEl) return;

    if (issuerWalletAddress) {
      if (dotEl) dotEl.className = 'dot';
      if (labelEl) labelEl.textContent = 'Active Engine';
      addressEl.textContent = issuerWalletAddress;
      addressEl.style.color = 'var(--bone)';
    } else {
      if (dotEl) dotEl.className = 'dot inactive';
      if (labelEl) labelEl.textContent = 'Disconnected';
      addressEl.textContent = 'Not connected to engine';
      addressEl.style.color = 'var(--silver)';
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

      if (statusEl) statusEl.classList.add('active');
      if (statusText) statusText.textContent = `Key pair active — ECDSA P-256 · Public key registered for ${issuerName}`;

      Store.appendAuditLog({
        event: 'key_generated',
        actor: 'College Portal',
        details: `ECDSA P-256 key pair initialized for ${issuerName}`,
      });
    } catch (e) {
      if (statusEl) statusEl.style.color = 'var(--accent-red)';
      if (statusText) statusText.textContent = 'Failed to initialize keys: ' + e.message;
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
    if (cloudAuthEnabled && !adminUser) {
      showToast('Admin login required before issuing', 'error');
      return;
    }

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
    const assignedStudentEmail = document.getElementById('assigned-student-email').value.trim().toLowerCase();
    let sourceDoc = { evidence: null };

    if (!issuerWalletAddress) {
      showToast('Connect the issuer MetaMask wallet before issuing', 'error');
      return;
    }
    if (cloudAuthEnabled && !assignedStudentEmail) {
      showToast('Assigned Student Email is required in cloud mode', 'error');
      return;
    }
    if (assignedStudentEmail) {
      subjectData.studentEmail = assignedStudentEmail;
    }
    try {
      sourceDoc = await prepareSourceDocumentUpload();
    } catch (e) {
      showToast(`Document upload preparation failed: ${e.message}`, 'error');
      return;
    }

    if (typeof BiometricAuth !== 'undefined' && BiometricAuth.isEnabled()) {
      try {
        const ok = await BiometricAuth.verify();
        if (!ok) {
          showToast('Biometric authentication failed', 'error');
          return;
        }
      } catch (e) {
        showToast(`Biometric authentication failed: ${e.message}`, 'error');
        return;
      }
    }

    const issuer = { id: issuerDid, name: issuerName, walletAddress: issuerWalletAddress };

    // Build credential
    const credential = buildCredential(type, subjectData, issuer, expiryDays);
    credential.claimCode = generateClaimCode();
    credential.emailDelivery = assignedStudentEmail
      ? { status: 'pending', reason: null, sentAt: null, email: assignedStudentEmail }
      : { status: 'not_configured', reason: 'student email missing', sentAt: null, email: null };
    if (sourceDoc.evidence) {
      credential.documentEvidence = sourceDoc.evidence;
    }

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
    if (cloudAuthEnabled && typeof CloudApi !== 'undefined') {
      try {
        const cloudRes = await CloudApi.issueCredential(credential, assignedStudentEmail, null);
        if (cloudRes.claimCode) {
          credential.claimCode = cloudRes.claimCode;
          Store.updateCredentialById(credential.id, { claimCode: cloudRes.claimCode });
        }
        if (cloudRes.email?.sent) {
          const sentAt = cloudRes.email?.sentAt || new Date().toISOString();
          credential.emailDelivery = { status: 'sent', reason: null, sentAt, email: assignedStudentEmail || null };
          Store.updateCredentialById(credential.id, { emailDelivery: credential.emailDelivery });
          showToast(`Claim code emailed to ${assignedStudentEmail}`, 'success');
        } else if (assignedStudentEmail) {
          const reason = cloudRes.email?.reason || 'email not configured';
          credential.emailDelivery = { status: 'failed', reason, sentAt: null, email: assignedStudentEmail };
          Store.updateCredentialById(credential.id, { emailDelivery: credential.emailDelivery });
          showToast(`Issued, but email not sent: ${reason}`, 'error');
        }
      } catch (e) {
        credential.emailDelivery = { status: 'failed', reason: e.message || 'cloud sync failed', sentAt: null, email: assignedStudentEmail || null };
        Store.updateCredentialById(credential.id, { emailDelivery: credential.emailDelivery });
        showToast(`Credential issued locally, cloud sync failed: ${e.message}`, 'error');
      }
    }
    if (sourceDoc.evidence) {
      showToast('Upload doc successful', 'success');
    }
    Store.appendAuditLog({
      event: 'issued',
      actor: issuerName,
      details: `${type.label} issued to ${subjectData.name} (${subjectData.enrollmentId}) · ClaimCode: ${credential.claimCode}`,
      credentialId: credential.id,
    });

    showToast(`✅ ${type.label} issued to ${subjectData.name}`, 'success');

    // Reset form
    document.getElementById('credential-form').querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'select-one') el.selectedIndex = 0;
      else el.value = '';
    });
    const docTypeEl = document.getElementById('source-doc-type');
    if (docTypeEl) docTypeEl.selectedIndex = 0;
    const docFileEl = document.getElementById('source-doc-file');
    if (docFileEl) docFileEl.value = '';

    renderIssuedList();
    renderStats();
    renderAuditLog();
  }

  // ── Render issued credentials ───────────────────────────────────
  function renderIssuedList(filterTerm = '') {
    const container = document.getElementById('issued-list');
    const searchInfo = document.getElementById('search-info');
    const searchQuery = document.getElementById('search-query');
    let credentials = Store.getAllCredentials();

    if (filterTerm) {
      const term = filterTerm.toLowerCase();
      credentials = credentials.filter(c => 
        c.credentialSubject.name.toLowerCase().includes(term) ||
        c.credentialSubject.enrollmentId.toLowerCase().includes(term) ||
        c.id.toLowerCase().includes(term)
      );
      if (searchInfo && searchQuery) {
        searchInfo.style.display = 'block';
        searchQuery.textContent = filterTerm;
      }
    } else if (searchInfo) {
      searchInfo.style.display = 'none';
    }

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
      const emailStatus = cred.emailDelivery?.status;
      const docStatus = cred.documentEvidence?.status;
      let emailBadge = '';
      if (emailStatus === 'sent') emailBadge = '<span class="badge badge-valid">Email Sent</span>';
      else if (emailStatus === 'failed') emailBadge = '<span class="badge badge-failed">Email Failed</span>';
      else if (emailStatus === 'pending') emailBadge = '<span class="badge badge-expiring">Email Pending</span>';
      else if (emailStatus === 'not_configured') emailBadge = '<span class="badge badge-expiring">Email Not Set</span>';
      const emailReason = cred.emailDelivery?.reason ? ` · Email: ${cred.emailDelivery.reason}` : '';
      let docBadge = '';
      if (docStatus === 'linked' || docStatus === 'local_only' || docStatus === 'hash_only') docBadge = '<span class="badge badge-valid">Doc Uploaded</span>';
      else if (docStatus === 'failed') docBadge = '<span class="badge badge-failed">Doc Upload Failed</span>';
      else if (docStatus === 'pending') docBadge = '<span class="badge badge-expiring">Doc Pending</span>';
      const docReason = cred.documentEvidence?.reason ? ` · Doc: ${cred.documentEvidence.reason}` : '';

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
            ${emailBadge}
            ${docBadge}
            <span class="badge ${expiry.class}">${expiry.label}</span>
          </div>
          <div class="credential-mini-sub">
            ${cred.credentialSubject.enrollmentId} · Claim Code: <strong>${cred.claimCode || '—'}</strong> · Issued: ${new Date(cred.issuanceDate).toLocaleDateString()}${emailReason}${docReason}
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
  document.getElementById('btn-admin-login').addEventListener('click', adminLogin);
  document.getElementById('btn-admin-logout').addEventListener('click', adminLogout);
  document.getElementById('btn-admin-biometric').addEventListener('click', async () => {
    if (typeof BiometricAuth === 'undefined') {
      showToast('Biometric module not loaded', 'error');
      return;
    }
    try {
      await BiometricAuth.enroll();
      showToast('Biometric enabled for issuer actions', 'success');
    } catch (e) {
      showToast(`Biometric enrollment failed: ${e.message}`, 'error');
    }
  });
  const sourceDocInput = document.getElementById('source-doc-file');
  if (sourceDocInput) {
    sourceDocInput.addEventListener('change', () => {
      const file = sourceDocInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_SOURCE_DOC_BYTES) {
        showToast('Source document must be 2MB or smaller', 'error');
        sourceDocInput.value = '';
        return;
      }
      showToast('Upload doc successful', 'success');
    });
  }

  // Re-register public key when issuer name changes
  document.getElementById('issuer-name').addEventListener('change', () => {
    const name = document.getElementById('issuer-name').value.trim();
    if (publicKeyJwk) {
      Store.savePublicKey(name, publicKeyJwk);
    }
  });

  const searchInput = document.getElementById('search-credentials');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderIssuedList(e.target.value.trim());
    });
  }

  // Reactive updates
  StateManager.on('credential:issued', () => { renderIssuedList(searchInput?.value); renderStats(); });
  StateManager.on('store:updated', () => { renderIssuedList(searchInput?.value); renderStats(); renderAuditLog(); });
  StateManager.enableCrossTabSync();

  // ── Init ────────────────────────────────────────────────────────
  if (typeof CloudAuth !== 'undefined') {
    CloudAuth.onChange((user) => {
      adminUser = user || null;
      renderAdminAuth();
    });
  } else {
    renderAdminAuth();
  }
  loadIssuerWalletSelection();
  renderIssuerWallet();

  await initKeys();
  renderTypeSelector();
  renderIssuedList();
  renderStats();
  renderAuditLog();
})();
