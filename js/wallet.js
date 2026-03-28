/**
 * wallet.js — Student Wallet (Holder) logic
 * 
 * Claim credentials, view them as cards, selectively share
 * with toggle switches, generate REAL Groth16 ZKP proofs via snarkjs,
 * and create QR codes for verification.
 */

(function WalletPortal() {
  let currentShareCredential = null;
  let holderWalletAddress = null;
  let studentUser = null;
  const HOLDER_WALLET_KEY = 'cc_selected_holder_wallet';
  const cloudAuthEnabled = !!window.FIREBASE_CONFIG?.apiKey;

  // ZKP artifacts paths
  const ZKP_WASM = 'zkp/gpa_range_proof.wasm';
  const ZKP_ZKEY = 'zkp/gpa_range_proof.zkey';

  function formatAddress(addr) {
    if (!addr || typeof addr !== 'string') return '—';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function renderHolderWallet() {
    const statusEl = document.getElementById('holder-wallet-status');
    const addressEl = document.getElementById('holder-wallet-address');
    if (!statusEl || !addressEl) return;

    if (holderWalletAddress) {
      statusEl.textContent = `Connected: ${formatAddress(holderWalletAddress)}`;
      statusEl.style.color = 'var(--accent-green-light)';
      addressEl.textContent = holderWalletAddress;
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.style.color = 'var(--text-secondary)';
      addressEl.textContent = '—';
    }
  }

  function loadHolderWalletSelection() {
    try {
      const v = localStorage.getItem(HOLDER_WALLET_KEY);
      holderWalletAddress = v || null;
    } catch {
      holderWalletAddress = null;
    }
  }

  function saveHolderWalletSelection(addr) {
    try {
      if (addr) localStorage.setItem(HOLDER_WALLET_KEY, addr);
      else localStorage.removeItem(HOLDER_WALLET_KEY);
    } catch {
      // ignore storage failures
    }
  }

  async function connectHolderWallet(requestAccess = true) {
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
      holderWalletAddress = addr || null;
      saveHolderWalletSelection(holderWalletAddress);
      renderHolderWallet();
      if (addr && requestAccess) showToast(`Student wallet connected: ${formatAddress(addr)}`, 'success');
      return holderWalletAddress;
    } catch (e) {
      if (requestAccess) showToast(`Wallet connect failed: ${e.message}`, 'error');
      holderWalletAddress = null;
      saveHolderWalletSelection(null);
      renderHolderWallet();
      return null;
    }
  }

  function renderStudentAuth() {
    const el = document.getElementById('student-auth-status');
    if (!el) return;
    if (studentUser) {
      el.textContent = `Authenticated as ${studentUser.email || studentUser.uid}`;
      el.style.color = 'var(--accent-green-light)';
    } else {
      el.textContent = 'Not authenticated';
      el.style.color = 'var(--text-secondary)';
    }
  }

  async function studentLogin() {
    if (typeof CloudAuth === 'undefined') {
      showToast('Cloud auth not configured', 'error');
      return;
    }
    try {
      await CloudAuth.signInStudentGoogle();
      showToast('Student login successful', 'success');
    } catch (e) {
      showToast(`Student login failed: ${e.message}`, 'error');
    }
  }

  async function studentLogout() {
    if (typeof CloudAuth === 'undefined') return;
    try {
      await CloudAuth.signOut();
      showToast('Logged out', 'info');
    } catch (e) {
      showToast(`Logout failed: ${e.message}`, 'error');
    }
  }

  // ── Claim Credentials ───────────────────────────────────────────
  function claimCredentialLocally(cred) {
    if (!cred || !cred.id) return false;
    if (!Store.getCredentialById(cred.id)) {
      Store.saveCredential(cred);
    }
    if (!Store.isCredentialClaimed(cred.id)) {
      Store.claimCredential(cred.id);
      Store.appendAuditLog({
        event: 'claimed',
        actor: 'Student Wallet',
        details: `Claimed ${cred.type?.[1] || 'Credential'} (${cred.id})`,
        credentialId: cred.id,
      });
      return true;
    }
    return false;
  }

  async function claimCredentials() {
    const enrollmentId = document.getElementById('claim-enrollment-id').value.trim();
    const resultEl = document.getElementById('claim-result');

    if (!enrollmentId) {
      showToast('Enter an enrollment ID', 'error');
      return;
    }

    if (cloudAuthEnabled && !studentUser) {
      showToast('Student login required before claiming', 'error');
      return;
    }

    if (cloudAuthEnabled && typeof CloudApi !== 'undefined') {
      try {
        await CloudApi.bindEnrollment(enrollmentId);
        const remote = await CloudApi.fetchCredentials(enrollmentId);
        (remote.credentials || []).forEach((cred) => {
          if (!Store.getCredentialById(cred.id)) {
            Store.saveCredential(cred);
          }
        });
      } catch (e) {
        showToast(`Cloud fetch failed, using local data: ${e.message}`, 'error');
      }
    }

    const matching = Store.getCredentialsByEnrollment(enrollmentId);
    if (matching.length === 0) {
      resultEl.innerHTML = `<span style="color:var(--accent-red); font-size:0.85rem;">No credentials found for "${enrollmentId}". Make sure the college has issued them first.</span>`;
      return;
    }

    let claimedCount = 0;
    matching.forEach(cred => {
      if (claimCredentialLocally(cred)) claimedCount++;
    });

    if (claimedCount > 0) {
      resultEl.innerHTML = `<span style="color:var(--accent-green-light); font-size:0.85rem;">✅ Claimed ${claimedCount} new credential(s)!</span>`;
      showToast(`Claimed ${claimedCount} credential(s)`, 'success');
    } else {
      resultEl.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">All credentials already claimed.</span>`;
    }

    renderWalletCards();
  }

  async function claimByCode() {
    const codeInput = document.getElementById('claim-code');
    const raw = (codeInput.value || '').trim().toUpperCase();
    if (!raw) {
      showToast('Enter claim code', 'error');
      return;
    }
    if (cloudAuthEnabled && !studentUser) {
      showToast('Student login required before claim-by-code', 'error');
      return;
    }
    if (!cloudAuthEnabled || typeof CloudApi === 'undefined') {
      showToast('Claim-by-code is available in cloud mode only', 'error');
      return;
    }

    try {
      const res = await CloudApi.fetchCredentialByClaimCode(raw);
      const cred = res.credential;
      if (!cred) {
        showToast('No credential found for claim code', 'error');
        return;
      }
      const claimed = claimCredentialLocally(cred);
      const enrollmentId = cred.credentialSubject?.enrollmentId || '';
      if (enrollmentId) {
        document.getElementById('claim-enrollment-id').value = enrollmentId;
      }
      renderWalletCards();
      showToast(claimed ? `Credential claimed via code ${raw}` : 'Credential already claimed', claimed ? 'success' : 'info');
    } catch (e) {
      showToast(`Claim-by-code failed: ${e.message}`, 'error');
    }
  }

  // ── Render Wallet Cards ─────────────────────────────────────────
  function renderWalletCards() {
    const container = document.getElementById('wallet-cards');
    const emptyEl = document.getElementById('wallet-empty');
    const claimedIds = Store.getClaimedCredentials();

    if (claimedIds.length === 0) {
      container.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    container.innerHTML = '';

    claimedIds.forEach(id => {
      const cred = Store.getCredentialById(id);
      if (!cred) return;

      const typeInfo = getCredentialTypeInfo(cred.type[1]) || { icon: '📄', label: cred.type[1], color: '#666', gradient: 'linear-gradient(135deg, #666 0%, #888 100%)' };
      const isRevoked = Store.isRevoked(cred.id);
      const expiry = getExpiryStatus(cred.expirationDate);

      // Wrapper for the whole item
      const wrapperDiv = document.createElement('div');
      wrapperDiv.style.display = 'flex';
      wrapperDiv.style.flexDirection = 'column';

      const containerDiv = document.createElement('div');
      containerDiv.className = 'wallet-card-container fade-in';
      containerDiv.style.width = '100%';
      containerDiv.style.height = '220px';
      containerDiv.style.margin = '0';
      containerDiv.style.perspective = '1000px';

      const card = document.createElement('div');
      card.className = 'cred-3d-card';
      const colorHint = typeInfo.color || '#c084fc';

      card.style.background = `linear-gradient(135deg, ${colorHint}33 0%, rgba(5, 5, 5, 0.9) 100%), var(--obsidian)`;
      card.style.borderColor = `${colorHint}66`;

      let statusHtml = '';
      if (isRevoked) statusHtml = 'REVOKED';
      else if (expiry.status === 'expired') statusHtml = 'EXPIRED';
      else statusHtml = 'VERIFIED';

      const badgeColor = isRevoked ? 'rgba(239,68,68,0.2)' : (expiry.status === 'expired' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.1)');
      const badgeBorder = isRevoked ? 'var(--accent-red)' : (expiry.status === 'expired' ? 'var(--accent-amber)' : 'rgba(255,255,255,0.3)');

      const subject = cred.credentialSubject || {};
      const cardName = subject.studentName || subject.name || subject.degree || typeInfo.label;
      const shortId = cred.id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
      const padId = shortId.padEnd(16, '0');
      const formattedId = padId.substring(0, 4) + ' ' + padId.substring(4, 8) + ' ' + padId.substring(8, 12) + ' ' + padId.substring(12, 16);
      const expStr = new Date(cred.expirationDate).toLocaleString('default', { month: '2-digit', year: '2-digit' });

      card.innerHTML = `
        <div class="cred-card-top">
          <div class="cred-card-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;color:${colorHint};"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            CredChain
          </div>
          <div class="cred-card-nfc">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a12 12 0 0 1 16 0"/><path d="M7 14.5a7 7 0 0 1 10 0"/><path d="M10 19a3 3 0 0 1 4 0"/></svg>
          </div>
        </div>
        <div class="cred-card-middle" style="transform: translateZ(35px); flex: 1; padding: 12px 0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-size:0.65rem; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:1px; margin-bottom:2px;">${typeInfo.label}</div>
          <div style="font-size:1rem; font-weight:500;">${cardName}</div>
        </div>
        <div class="cred-card-bottom">
          <div class="cred-card-name">
            <span>ID: ${cred.id.substring(0, 6)}...</span>
            <span>${expiry.status !== 'expired' ? 'Exp: ' : ''}${expStr}</span>
          </div>
          <div class="cred-card-number">
             ${formattedId.toUpperCase()}
          </div>
        </div>
        <div class="cred-card-stamp" style="background:${badgeColor}; border-color:${badgeBorder};">${statusHtml}</div>
      `;

      containerDiv.addEventListener('mousemove', (e) => {
        const rect = containerDiv.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        const rotateX = (-y / (rect.height / 2)) * 15;
        const rotateY = (x / (rect.width / 2)) * 15;
        card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      });
      containerDiv.addEventListener('mouseleave', () => {
        card.style.transform = 'rotateX(0deg) rotateY(0deg)';
        card.style.transition = 'transform 0.5s ease';
      });
      containerDiv.addEventListener('mouseenter', () => {
        card.style.transition = 'transform 0.1s ease';
      });

      containerDiv.appendChild(card);
      wrapperDiv.appendChild(containerDiv);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'credential-card-actions';
      actionsDiv.style.borderTop = 'none';
      actionsDiv.style.justifyContent = 'center';
      actionsDiv.style.marginTop = '8px';

      const detailBtn = document.createElement('button');
      detailBtn.type = 'button';
      detailBtn.className = 'btn btn-ghost btn-sm';
      detailBtn.textContent = '👁️ Details';
      detailBtn.dataset.action = 'details';
      detailBtn.dataset.credId = cred.id;
      detailBtn.addEventListener('click', () => openDetailModal(cred.id));
      actionsDiv.appendChild(detailBtn);

      if (!isRevoked && expiry.status !== 'expired') {
        const shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'btn btn-success btn-sm';
        shareBtn.textContent = '📤 Share';
        shareBtn.dataset.action = 'share';
        shareBtn.dataset.credId = cred.id;
        shareBtn.addEventListener('click', () => openShareModal(cred.id));
        actionsDiv.appendChild(shareBtn);
      } else {
        const disabledBtn = document.createElement('button');
        disabledBtn.className = 'btn btn-ghost btn-sm';
        disabledBtn.disabled = true;
        disabledBtn.textContent = 'Cannot share';
        actionsDiv.appendChild(disabledBtn);
      }

      wrapperDiv.appendChild(actionsDiv);
      container.appendChild(wrapperDiv);
    });
  }

  function renderCardFields(cred, typeInfo) {
    const subject = cred.credentialSubject;
    const type = Object.values(CredentialTypes).find(t => t.key === cred.type[1]);
    if (!type) return '';

    const visibleFields = type.fields.filter(f => !f.sensitive).slice(0, 4);
    return visibleFields.map(f => {
      let value = subject[f.key];
      if (Array.isArray(value)) value = value.join(', ');
      if (value === undefined || value === '') return '';
      return `
        <div class="credential-field">
          <span class="credential-field-label">${f.label}</span>
          <span class="credential-field-value">${value}</span>
        </div>
      `;
    }).join('');
  }

  // ── Detail Modal ────────────────────────────────────────────────
  function openDetailModal(credId) {
    try {
      const cred = Store.getCredentialById(credId);
      if (!cred) return;

      const typeInfo = getCredentialTypeInfo(cred.type[1]) || { label: 'Credential' };
      const type = Object.values(CredentialTypes).find(t => t.key === cred.type[1]);

      document.getElementById('detail-modal-title').textContent = typeInfo.label + ' — Details';
      const body = document.getElementById('detail-modal-body');

      let fieldsHtml = '';
      if (type) {
        fieldsHtml = type.fields.map(f => {
          let value = cred.credentialSubject[f.key];
          if (Array.isArray(value)) value = value.join(', ');
          if (value === undefined) return '';
          return `
            <div class="credential-field" style="margin-bottom: var(--space-sm);">
              <span class="credential-field-label">${f.label} ${f.sensitive ? '<span class="toggle-sensitive">sensitive</span>' : ''}</span>
              <span class="credential-field-value">${value}</span>
            </div>
          `;
        }).join('');
      }

      const signature = typeof cred.proof?.signature === 'string' ? cred.proof.signature : 'Unavailable';
      body.innerHTML = `
        <div style="margin-bottom: var(--space-md);">
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Credential ID</span>
            <span class="credential-field-value" style="font-size:0.75rem; word-break:break-all;">${cred.id}</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Issuer</span>
            <span class="credential-field-value">${cred.issuer.name} (${cred.issuer.id})</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Issued</span>
            <span class="credential-field-value">${new Date(cred.issuanceDate).toLocaleString()}</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Expires</span>
            <span class="credential-field-value">${new Date(cred.expirationDate).toLocaleString()}</span>
          </div>
        </div>
        <hr style="border-color: var(--border-subtle); margin: var(--space-md) 0;">
        <h4 style="font-size: 0.85rem; font-weight: 600; margin-bottom: var(--space-md);">Subject Data</h4>
        ${fieldsHtml}
        <hr style="border-color: var(--border-subtle); margin: var(--space-md) 0;">
        <h4 style="font-size: 0.85rem; font-weight: 600; margin-bottom: var(--space-md);">Proof</h4>
        <div class="credential-field">
          <span class="credential-field-label">Signature (truncated)</span>
          <span class="credential-field-value" style="font-size:0.7rem; word-break:break-all; color:var(--text-muted);">${signature.substring(0, 60)}${signature === 'Unavailable' ? '' : '…'}</span>
        </div>
      `;

      document.getElementById('detail-modal-share').onclick = () => {
        closeModal('detail-modal');
        openShareModal(credId);
      };

      openModal('detail-modal');
    } catch (e) {
      console.error('[OpenDetailModal Error]', e);
      showToast('Error opening details: ' + e.message, 'error');
    }
  }

  // ── Share Modal (Selective Disclosure) ──────────────────────────
  function openShareModal(credId) {
    try {
      const cred = Store.getCredentialById(credId);
      if (!cred) {
        alert('Error: Credential not found');
        return;
      }

      currentShareCredential = cred;
      const type = Object.values(CredentialTypes).find(t => t.key === cred.type[1]);
      const typeInfo = getCredentialTypeInfo(cred.type[1]) || { label: 'Credential', icon: '📄' };

      document.getElementById('share-modal-title').textContent = `Share ${typeInfo.label}`;

      const body = document.getElementById('share-modal-body');
      body.innerHTML = `
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: var(--space-lg);">
          Choose which fields to include in your verifiable presentation.
          Sensitive fields are marked — use ZKP range proofs when available.
        </p>
        <div id="share-toggles"></div>
      `;

      const togglesContainer = document.getElementById('share-toggles');

      if (type) {
        type.fields.forEach(field => {
          const value = cred.credentialSubject[field.key];
          if (value === undefined || value === '') return;

          const displayValue = Array.isArray(value) ? value.join(', ') : value;

          // Regular toggle
          const row = document.createElement('div');
          row.className = 'toggle-row';

          const infoDiv = document.createElement('div');
          infoDiv.className = 'toggle-info';
          infoDiv.innerHTML = `
            <span class="toggle-label">${field.label} ${field.sensitive ? '<span class="toggle-sensitive">sensitive</span>' : ''}</span>
            <span class="toggle-value">${displayValue}</span>
          `;

          const toggleLabel = document.createElement('label');
          toggleLabel.className = 'toggle-switch';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.dataset.field = field.key;
          if (!field.sensitive) checkbox.checked = true;
          const slider = document.createElement('span');
          slider.className = 'toggle-slider';
          toggleLabel.appendChild(checkbox);
          toggleLabel.appendChild(slider);

          row.appendChild(infoDiv);
          row.appendChild(toggleLabel);
          togglesContainer.appendChild(row);

          // ZKP toggle for eligible fields (REAL Groth16 proof)
          if (field.zkpEligible && typeof value === 'number') {
            const zkpRow = document.createElement('div');
            zkpRow.className = 'toggle-row zkp-row';

            const zkpInfo = document.createElement('div');
            zkpInfo.className = 'toggle-info';
            zkpInfo.innerHTML = `
              <span class="toggle-label">
                <span class="zkp-badge">ZKP — REAL Groth16</span> Prove ${field.label} > threshold
              </span>
              <span class="toggle-value">
                Threshold: <input type="number" class="form-input" id="zkp-threshold-${field.key}"
                  value="80" min="0" max="100" step="1"
                  style="width:70px; display:inline-block; padding:2px 8px; font-size:0.8rem;">
                <span style="font-size:0.7rem; color:var(--text-muted);">(scaled: GPA × 10)</span>
              </span>
            `;

            const zkpToggle = document.createElement('label');
            zkpToggle.className = 'toggle-switch';
            const zkpCheckbox = document.createElement('input');
            zkpCheckbox.type = 'checkbox';
            zkpCheckbox.dataset.zkp = field.key;
            const zkpSlider = document.createElement('span');
            zkpSlider.className = 'toggle-slider';
            zkpToggle.appendChild(zkpCheckbox);
            zkpToggle.appendChild(zkpSlider);

            zkpRow.appendChild(zkpInfo);
            zkpRow.appendChild(zkpToggle);
            togglesContainer.appendChild(zkpRow);
          }
        });
      }

      openModal('share-modal');
    } catch (e) {
      console.error('[OpenShareModal Error]', e);
      alert('Error opening share modal: ' + e.message + '\n\nPlease Hard Refresh (Cmd+Shift+R or Ctrl+F5) your browser.');
    }
  }

  // ── Generate Presentation with REAL Groth16 ZKP ─────────────────
  async function generatePresentation() {
    if (!currentShareCredential) return;
    if (cloudAuthEnabled && !studentUser) {
      showToast('Student login required before sharing', 'error');
      return;
    }

    const cred = currentShareCredential;
    const confirmBtn = document.getElementById('share-modal-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ Generating proof...';

    try {
      if (typeof BiometricAuth !== 'undefined' && BiometricAuth.isEnabled()) {
        const bioOk = await BiometricAuth.verify();
        if (!bioOk) {
          throw new Error('Biometric authentication failed');
        }
      }

      // Collect selected fields
      const selectedFields = {};
      const zkpProofs = {};

      document.querySelectorAll('#share-toggles input[data-field]').forEach(toggle => {
        if (toggle.checked) {
          const key = toggle.dataset.field;
          selectedFields[key] = cred.credentialSubject[key];
        }
      });

      // Process ZKP toggles — REAL Groth16 proofs via snarkjs
      const zkpToggles = document.querySelectorAll('#share-toggles input[data-zkp]');
      for (const toggle of zkpToggles) {
        if (toggle.checked) {
          const key = toggle.dataset.zkp;
          const thresholdInput = document.getElementById(`zkp-threshold-${key}`);
          const threshold = parseInt(thresholdInput?.value || '80', 10);
          const actualValue = cred.credentialSubject[key];

          if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
            showToast(`Invalid threshold for ${key}. Use a value between 0 and 100.`, 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = '📤 Generate Presentation';
            return;
          }

          // Scale GPA: 8.7 → 87 (multiply by 10, round to int)
          const scaledGpa = Math.round(actualValue * 10);

          // Remove exact value — student doesn't share raw GPA
          delete selectedFields[key];

          // Generate REAL Groth16 proof using snarkjs
          console.log(`[ZKP] Generating Groth16 proof: gpa=${scaledGpa} > threshold=${threshold}`);

          if (scaledGpa <= threshold) {
            showToast(`Cannot prove ${key} > ${threshold / 10}: actual value doesn't satisfy the constraint`, 'error');
            confirmBtn.disabled = false;
            confirmBtn.textContent = '📤 Generate Presentation';
            return;
          }

          const input = {
            gpa: scaledGpa.toString(),
            threshold: threshold.toString(),
          };

          // Real snarkjs Groth16 proof generation
          const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            ZKP_WASM,
            ZKP_ZKEY
          );

          console.log('[ZKP] Groth16 proof generated:', proof);
          console.log('[ZKP] Public signals:', publicSignals);

          zkpProofs[key] = {
            type: 'Groth16',
            protocol: 'groth16',
            curve: 'bn128',
            claim: `${key} > ${threshold / 10}`,
            threshold: threshold,
            scaledThreshold: threshold,
            proof: proof,
            publicSignals: publicSignals,
            // The proof is REAL — the actual GPA value is NOT in publicSignals
            // Only the threshold (public input) is revealed
          };
        }
      }

      if (Object.keys(selectedFields).length === 0 && Object.keys(zkpProofs).length === 0) {
        showToast('Select at least one field to share', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '📤 Generate Presentation';
        return;
      }

      // Reuse one presentation code per credential so selective re-sharing
      // updates the same share identity instead of minting new codes each time.
      const existingPresentation = Store.getLatestPresentationByCredentialId(cred.id);
      const verificationCode = existingPresentation?.verificationCode || CryptoModule.generateVerificationCode();
      const nonce = CryptoModule.generateNonce();
      const nowIso = new Date().toISOString();

      const presentation = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verificationCode: verificationCode,
        created: existingPresentation?.created || nowIso,
        updatedAt: nowIso,
        nonce: nonce,
        usedAt: null,
        credential: {
          id: cred.id,
          type: cred.type,
          issuer: cred.issuer,
          issuerPublicKey: cred.issuerPublicKey,
          issuanceDate: cred.issuanceDate,
          expirationDate: cred.expirationDate,
          documentEvidence: cred.documentEvidence || null,
          originalSubject: cred.credentialSubject,
          disclosedFields: selectedFields,
          zkpProofs: zkpProofs,
          proof: cred.proof,
        },
      };

      if (typeof BlockchainModule !== 'undefined') {
        const cfg = BlockchainModule.getConfig();
        try {
          const anchorHash = existingPresentation?.blockchain?.anchorHash
            || await BlockchainModule.computeCredentialHashFromPresentation(presentation);
          presentation.blockchain = {
            chainId: cfg.CHAIN_ID,
            network: cfg.NETWORK_NAME,
            contractAddress: cfg.CONTRACT_ADDRESS,
            anchorHash,
            anchored: existingPresentation?.blockchain?.anchored || false,
            txHash: existingPresentation?.blockchain?.txHash || null,
            anchorTime: existingPresentation?.blockchain?.anchorTime || null,
            anchoredAt: existingPresentation?.blockchain?.anchoredAt || null,
            holderWalletAddress: existingPresentation?.blockchain?.holderWalletAddress || null,
          };
        } catch (e) {
          console.error('[Blockchain] Failed to compute anchor hash:', e);
          presentation.blockchain = {
            chainId: cfg.CHAIN_ID,
            network: cfg.NETWORK_NAME,
            contractAddress: cfg.CONTRACT_ADDRESS,
            anchorHash: null,
            anchored: existingPresentation?.blockchain?.anchored || false,
            txHash: existingPresentation?.blockchain?.txHash || null,
            anchorTime: existingPresentation?.blockchain?.anchorTime || null,
            anchoredAt: existingPresentation?.blockchain?.anchoredAt || null,
            holderWalletAddress: existingPresentation?.blockchain?.holderWalletAddress || null,
            error: e.message,
          };
        }
      }

      Store.saveOrReplacePresentationForCredential(cred.id, presentation);
      if (cloudAuthEnabled && typeof CloudApi !== 'undefined') {
        try {
          await CloudApi.savePresentation(presentation);
        } catch (e) {
          showToast(`Presentation saved locally; cloud sync failed: ${e.message}`, 'error');
        }
      }
      Store.appendAuditLog({
        event: 'shared',
        actor: 'Student Wallet',
        details: `Presentation ${existingPresentation ? 'updated' : 'created'} for ${cred.type[1]} — Code: ${verificationCode} — Fields: ${Object.keys(selectedFields).join(', ')}${Object.keys(zkpProofs).length > 0 ? ' + ZKP(Groth16): ' + Object.keys(zkpProofs).join(', ') : ''}`,
        credentialId: cred.id,
      });

      closeModal('share-modal');
      showPresentationResult(verificationCode, presentation);
      renderPresentations();
      showToast(existingPresentation ? 'Presentation updated' : 'Presentation generated with real Groth16 proof!', 'success');
    } catch (err) {
      console.error('[ZKP] Error generating proof:', err);
      showToast('Error generating ZKP proof: ' + err.message, 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '📤 Generate Presentation';
    }
  }

  // ── Show Presentation Result (with QR) ─────────────────────────
  function showPresentationResult(code, presentation) {
    const body = document.getElementById('result-modal-body');

    const zkpFields = Object.keys(presentation.credential.zkpProofs);
    const zkpInfo = zkpFields.length > 0
      ? zkpFields.map(k => {
        const p = presentation.credential.zkpProofs[k];
        return `<br><span class="zkp-badge">ZKP Groth16</span> ${p.claim}`;
      }).join('')
      : '';

    const blockchain = presentation.blockchain || {};
    const issuerWallet = presentation.credential?.issuer?.walletAddress || null;
    const holderWallet = blockchain.holderWalletAddress || null;
    const separationOk = issuerWallet && holderWallet
      ? !BlockchainModule?.addressesEqual(issuerWallet, holderWallet)
      : null;
    const canAnchor = typeof BlockchainModule !== 'undefined' && BlockchainModule.isConfigured() && !!blockchain.anchorHash;
    const anchorState = blockchain.anchored
      ? `✅ Anchored on ${blockchain.network || 'chain'}`
      : canAnchor
        ? 'Not anchored yet'
        : 'Blockchain contract not configured';
    const anchorButton = canAnchor
      ? `<button class="btn ${blockchain.anchored ? 'btn-ghost' : 'btn-primary'}" id="anchor-onchain-btn" ${blockchain.anchored ? 'disabled' : ''}>${blockchain.anchored ? '✅ Anchored' : '⬡ Anchor On-Chain'}</button>`
      : '';
    const txInfo = blockchain.txHash
      ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">Tx: ${blockchain.txHash.substring(0, 18)}...</span>`
      : '';

    body.innerHTML = `
      <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: var(--space-lg);">
        Share this code or QR with the verifier. They can verify it on the
        <a href="verifier.html" style="color: var(--accent-indigo-light);">Verifier Portal</a>.
      </p>
      <div class="verification-code-display" id="vcode-display" title="Click to copy">${code}</div>
      <div class="qr-container" id="qr-container" style="display:flex; flex-direction:column; align-items:center;">
        <div id="qr-canvas" style="display:flex; justify-content:center; background:white; padding:10px; border-radius:8px;"></div>
        <span class="qr-code-label" style="margin-top:10px;">Scan to verify</span>
      </div>
      <p style="font-size: 0.75rem; color: var(--text-muted);">
        Fields shared: ${Object.keys(presentation.credential.disclosedFields).join(', ') || 'None (ZKP only)'}
        ${zkpInfo}
      </p>
      <div class="card" style="text-align:left; margin-top: var(--space-lg); padding: var(--space-md);">
        <div style="font-size:0.8rem; font-weight:600; margin-bottom: var(--space-xs);">Blockchain Anchor (Polygon Amoy)</div>
        <div style="font-size:0.72rem; color:var(--text-muted); word-break:break-all; margin-bottom: var(--space-sm);">
          Hash: ${blockchain.anchorHash || 'Unavailable'}
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom: var(--space-sm);">
          Issuer Wallet: ${issuerWallet || 'Not set on credential'}<br>
          Student Wallet: ${holderWallet || 'Not anchored yet'}${separationOk === null ? '' : `<br>Separation: ${separationOk ? '✅ Different wallets' : '❌ Same wallet'}`}
        </div>
        ${anchorButton}
        <div id="anchor-status" style="font-size:0.75rem; color:var(--text-secondary); margin-top: var(--space-sm);">
          ${anchorState}${txInfo}
        </div>
      </div>
    `;

    // Generate QR code
    try {
      const verifierUrl = `${window.location.origin}${window.location.pathname.replace('wallet.html', 'verifier.html')}?code=${code}`;
      if (typeof QRCode !== 'undefined') {
        const qrContainer = document.getElementById('qr-canvas');
        qrContainer.innerHTML = ''; // Clear previous
        new QRCode(qrContainer, {
          text: verifierUrl,
          width: 160,
          height: 160,
          colorDark: '#1a1a2e',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.L
        });
      } else {
        console.warn('QRCode library not loaded');
        document.getElementById('qr-canvas').innerHTML = `
          <p style="color:#666; font-size:0.75rem;">QR library loading... Reload to retry.</p>
        `;
      }
    } catch (e) {
      console.error('QR generation failed:', e);
    }

    // Copy on click
    document.getElementById('vcode-display').addEventListener('click', () => {
      navigator.clipboard?.writeText(code);
      showToast('Code copied!', 'info');
    });

    const anchorBtn = document.getElementById('anchor-onchain-btn');
    if (anchorBtn && !blockchain.anchored) {
      anchorBtn.addEventListener('click', async () => {
        await anchorPresentationOnChain(code);
      });
    }

    openModal('result-modal');
  }

  async function anchorPresentationOnChain(code) {
    if (typeof BlockchainModule === 'undefined') {
      showToast('Blockchain module not loaded', 'error');
      return;
    }

    const presentation = Store.getPresentationByCode(code);
    if (!presentation) {
      showToast('Presentation not found', 'error');
      return;
    }
    const hash = presentation.blockchain?.anchorHash;
    if (!hash) {
      showToast('No anchor hash available for this presentation', 'error');
      return;
    }
    const issuerWallet = presentation.credential?.issuer?.walletAddress || null;

    const anchorBtn = document.getElementById('anchor-onchain-btn');
    const statusEl = document.getElementById('anchor-status');
    if (anchorBtn) {
      anchorBtn.disabled = true;
      anchorBtn.textContent = '⏳ Anchoring...';
    }
    if (statusEl) statusEl.textContent = 'Connecting to wallet...';

    try {
      const holderWallet = holderWalletAddress || await connectHolderWallet(true);
      if (!holderWallet) {
        throw new Error('No MetaMask account connected');
      }
      const activeWallet = await BlockchainModule.getConnectedAddress(false);
      if (!activeWallet || !BlockchainModule.addressesEqual(activeWallet, holderWallet)) {
        throw new Error(`MetaMask active account is ${activeWallet || 'not connected'}. Switch to selected Student wallet ${holderWallet} and retry.`);
      }
      if (issuerWallet && BlockchainModule.addressesEqual(holderWallet, issuerWallet)) {
        throw new Error('Issuer and Student wallets must be different. Switch MetaMask to student account and retry.');
      }

      const res = await BlockchainModule.anchorHash(hash);
      Store.updatePresentationByCode(code, (current) => ({
        ...current,
        blockchain: {
          ...(current.blockchain || {}),
          anchored: true,
          txHash: res.txHash,
          anchorTime: res.anchorTime,
          anchoredAt: new Date().toISOString(),
          holderWalletAddress: res.from || holderWallet,
        },
      }));

      if (statusEl) {
        statusEl.innerHTML = `✅ Anchored on-chain${res.txHash ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">Tx: ${res.txHash.substring(0, 18)}...</span>` : ''}`;
      }
      if (anchorBtn) {
        anchorBtn.textContent = '✅ Anchored';
        anchorBtn.className = 'btn btn-ghost';
      }
      renderPresentations();
      showToast('Presentation hash anchored on Polygon Amoy', 'success');
    } catch (e) {
      const msg = e?.reason || e?.message || 'Anchor transaction failed';
      const alreadyAnchored = typeof msg === 'string' && msg.toLowerCase().includes('already anchored');
      if (alreadyAnchored) {
        Store.updatePresentationByCode(code, (current) => ({
          ...current,
          blockchain: {
            ...(current.blockchain || {}),
            anchored: true,
            anchoredAt: current.blockchain?.anchoredAt || new Date().toISOString(),
          },
        }));
        if (statusEl) statusEl.textContent = 'ℹ️ Hash already anchored on-chain';
        if (anchorBtn) {
          anchorBtn.textContent = '✅ Anchored';
          anchorBtn.className = 'btn btn-ghost';
        }
        showToast('Hash already anchored on-chain', 'info');
      } else {
        if (statusEl) statusEl.textContent = `❌ ${msg}`;
        if (anchorBtn) {
          anchorBtn.disabled = false;
          anchorBtn.textContent = '⬡ Anchor On-Chain';
        }
        showToast(`Blockchain anchor failed: ${msg}`, 'error');
      }
    }
  }

  // ── Render Presentations List ───────────────────────────────────
  function renderPresentations() {
    const container = document.getElementById('presentations-list');
    const emptyEl = document.getElementById('presentations-empty');
    const presentations = Store.getAllPresentations();

    if (presentations.length === 0) {
      container.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    container.innerHTML = '';

    presentations.slice().reverse().forEach(p => {
      const typeKey = p.credential.type[1];
      const typeInfo = getCredentialTypeInfo(typeKey) || { icon: '📄', label: typeKey, color: '#666' };
      const wasUsed = !!p.usedAt;
      const hasZkp = Object.keys(p.credential.zkpProofs || {}).length > 0;
      const isAnchored = !!p.blockchain?.anchored;

      const item = document.createElement('div');
      item.className = 'credential-mini fade-in';
      item.innerHTML = `
        <div class="credential-mini-icon" style="background:${typeInfo.color}22; color:${typeInfo.color};">
          📤
        </div>
        <div class="credential-mini-info">
          <div class="credential-mini-title">
            ${typeInfo.label}
            <span class="badge ${wasUsed ? 'badge-replay' : 'badge-valid'}">${wasUsed ? '⚡ Used' : '🟢 Active'}</span>
            ${hasZkp ? '<span class="zkp-badge">ZKP Groth16</span>' : ''}
            ${isAnchored ? '<span class="badge badge-verified">⛓️ Anchored</span>' : ''}
          </div>
          <div class="credential-mini-sub">
            Code: <strong>${p.verificationCode}</strong> ·
            Created: ${new Date(p.created).toLocaleString()} ·
            Fields: ${Object.keys(p.credential.disclosedFields).join(', ') || 'ZKP only'}
          </div>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // ── Modal Helpers ───────────────────────────────────────────────
  function openModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  // ── Toast ───────────────────────────────────────────────────────
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = {
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4ade80;"><path d="M20 6L9 17L4 12"></path></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #f87171;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #c084fc;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };
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

  // ── Event Listeners ─────────────────────────────────────────────
  document.getElementById('btn-claim').addEventListener('click', claimCredentials);
  document.getElementById('btn-claim-code').addEventListener('click', claimByCode);
  document.getElementById('btn-connect-holder-wallet').addEventListener('click', () => connectHolderWallet(true));
  document.getElementById('btn-student-login').addEventListener('click', studentLogin);
  document.getElementById('btn-student-logout').addEventListener('click', studentLogout);
  const navLogoutBtn = document.getElementById('nav-logout-btn');
  if (navLogoutBtn) navLogoutBtn.addEventListener('click', studentLogout);
  document.getElementById('btn-student-biometric').addEventListener('click', async () => {
    if (typeof BiometricAuth === 'undefined') {
      showToast('Biometric module not loaded', 'error');
      return;
    }
    try {
      await BiometricAuth.enroll();
      showToast('Biometric enabled for student actions', 'success');
    } catch (e) {
      showToast(`Biometric enrollment failed: ${e.message}`, 'error');
    }
  });
  document.getElementById('claim-enrollment-id').addEventListener('keydown', e => {
    if (e.key === 'Enter') claimCredentials();
  });
  document.getElementById('claim-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') claimByCode();
  });
  document.getElementById('share-modal-close').addEventListener('click', () => closeModal('share-modal'));
  document.getElementById('share-modal-cancel').addEventListener('click', () => closeModal('share-modal'));
  document.getElementById('share-modal-confirm').addEventListener('click', generatePresentation);
  document.getElementById('result-modal-close').addEventListener('click', () => closeModal('result-modal'));
  document.getElementById('detail-modal-close').addEventListener('click', () => closeModal('detail-modal'));
  document.getElementById('detail-modal-dismiss').addEventListener('click', () => closeModal('detail-modal'));

  // Close modals on overlay click
  ['share-modal', 'result-modal', 'detail-modal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  // Delegated click handler as a fallback for dynamically rendered cards
  document.getElementById('wallet-cards').addEventListener('click', (e) => {
    const actionButton = e.target.closest('button[data-action][data-cred-id]');
    if (!actionButton) return;
    e.preventDefault();
    e.stopPropagation();

    const credId = actionButton.dataset.credId;
    if (actionButton.dataset.action === 'details') {
      openDetailModal(credId);
    } else if (actionButton.dataset.action === 'share') {
      openShareModal(credId);
    }
  });

  // Reactive updates
  StateManager.on('credential:issued', renderWalletCards);
  StateManager.on('credential:revoked', renderWalletCards);
  StateManager.on('store:updated', () => { renderWalletCards(); renderPresentations(); });
  StateManager.enableCrossTabSync();

  // Check URL for pre-filled enrollment ID
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('enrollment')) {
    document.getElementById('claim-enrollment-id').value = urlParams.get('enrollment');
  }
  if (urlParams.has('claimCode')) {
    const code = (urlParams.get('claimCode') || '').toUpperCase();
    document.getElementById('claim-code').value = code;
  }

  // ── Init ────────────────────────────────────────────────────────
  if (typeof CloudAuth !== 'undefined') {
    CloudAuth.onChange((user) => {
      studentUser = user || null;
      renderStudentAuth();
    });
  } else {
    renderStudentAuth();
  }
  loadHolderWalletSelection();
  renderHolderWallet();
  renderWalletCards();
  renderPresentations();
})();
