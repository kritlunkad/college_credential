/**
 * verifier.js — Third Party Verifier Portal logic
 * 
 * Verifies credential presentations by checking:
 * 1. Issuer signature (ECDSA P-256)
 * 2. Data integrity (original subject matches signature)
 * 3. Credential expiry
 * 4. Revocation status
 * 5. Replay detection (has this VP been used before?)
 * 6. REAL Groth16 ZKP proof verification via snarkjs
 */

(function VerifierPortal() {
  const verificationHistory = [];

  // Path to verification key (generated during trusted setup)
  const VK_PATH = 'zkp/verification_key.json';
  let verificationKeyCache = null;

  // Load verification key
  async function loadVerificationKey() {
    if (verificationKeyCache) return verificationKeyCache;
    try {
      const resp = await fetch(VK_PATH);
      verificationKeyCache = await resp.json();
      return verificationKeyCache;
    } catch (e) {
      console.error('Failed to load verification key:', e);
      return null;
    }
  }

  // ── Main Verification Flow ──────────────────────────────────────
  async function verifyPresentation() {
    const codeInput = document.getElementById('verify-code');
    const code = codeInput.value.trim().toUpperCase();
    const verifyBtn = document.getElementById('btn-verify');

    if (!code) {
      showToast('Enter a verification code', 'error');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = '⏳ Verifying...';

    try {
      const presentation = Store.getPresentationByCode(code);
      if (!presentation) {
        showResult({
          status: 'failure',
          icon: '❌',
          title: 'Presentation Not Found',
          subtitle: `No verifiable presentation found for code "${code}".`,
          checks: [{ label: 'Lookup', status: 'fail', detail: 'Code not found in any stored presentations' }],
        });
        Store.appendAuditLog({
          event: 'failed',
          actor: 'Verifier Portal',
          details: `Verification failed — code "${code}" not found`,
        });
        return;
      }

      const cred = presentation.credential;
      const checks = [];
      let overallStatus = 'success';
      const zkpProofs = { ...(cred.zkpProofs || {}) };

      // ── Check 1: Replay Detection ─────────────────────────────────
      if (presentation.usedAt) {
        checks.push({
          label: 'Replay Detection',
          status: 'warning',
          detail: `⚠️ This presentation was already verified on ${new Date(presentation.usedAt).toLocaleString()}. Possible replay.`,
        });
        overallStatus = 'warning';
      } else {
        checks.push({ label: 'Replay Detection', status: 'pass', detail: 'First-time verification — nonce is fresh' });
        Store.markPresentationUsed(code);
      }

      // ── Check 2: Revocation ───────────────────────────────────────
      if (Store.isRevoked(cred.id)) {
        checks.push({
          label: 'Revocation',
          status: 'fail',
          detail: '⛔ This credential has been REVOKED by the issuer.',
        });
        overallStatus = 'failure';
      } else {
        checks.push({ label: 'Revocation', status: 'pass', detail: 'Credential is not revoked' });
      }

      // ── Check 3: Expiry ───────────────────────────────────────────
      const expiry = getExpiryStatus(cred.expirationDate);
      if (expiry.status === 'expired') {
        checks.push({
          label: 'Expiry',
          status: 'fail',
          detail: `⏱️ Credential expired on ${new Date(cred.expirationDate).toLocaleDateString()}`,
        });
        if (overallStatus !== 'failure') overallStatus = 'failure';
      } else if (expiry.status === 'expiring') {
        checks.push({
          label: 'Expiry',
          status: 'warning',
          detail: `⚠️ Credential expires in ${expiry.daysLeft} days (${new Date(cred.expirationDate).toLocaleDateString()})`,
        });
        if (overallStatus === 'success') overallStatus = 'warning';
      } else {
        checks.push({
          label: 'Expiry',
          status: 'pass',
          detail: `Valid until ${new Date(cred.expirationDate).toLocaleDateString()} (${expiry.daysLeft} days remaining)`,
        });
      }

      // ── Check 4: Issuer Signature ─────────────────────────────────
      try {
        const publicKeyJwk = cred.issuerPublicKey;
        if (!publicKeyJwk) {
          checks.push({
            label: 'Issuer Signature',
            status: 'fail',
            detail: 'No issuer public key embedded in credential',
          });
          overallStatus = 'failure';
        } else {
          const isValid = await CryptoModule.verifySignature(
            publicKeyJwk,
            cred.originalSubject,
            cred.proof.signature
          );

          if (isValid) {
            checks.push({
              label: 'Issuer Signature',
              status: 'pass',
              detail: `✅ ECDSA P-256 signature valid — signed by ${cred.issuer.name} (${cred.issuer.id})`,
            });
          } else {
            checks.push({
              label: 'Issuer Signature',
              status: 'fail',
              detail: '❌ Signature verification FAILED — credential may be tampered or forged!',
            });
            overallStatus = 'failure';
          }
        }
      } catch (e) {
        checks.push({
          label: 'Issuer Signature',
          status: 'fail',
          detail: `Signature check error: ${e.message}`,
        });
        overallStatus = 'failure';
      }

      // ── Check 5: Issuer Trust ─────────────────────────────────────
      const issuerName = cred.issuer.name.trim();
      const registeredKey = Store.getPublicKey(issuerName);
      if (registeredKey) {
        const keysMatch = JSON.stringify(cred.issuerPublicKey) === JSON.stringify(registeredKey);
        checks.push({
          label: 'Issuer Trust',
          status: keysMatch ? 'pass' : 'warning',
          detail: keysMatch
            ? `Issuer "${issuerName}" is in the trusted registry with a matching public key`
            : `⚠️ Issuer key does not match the registered key for "${issuerName}"`,
        });
        if (!keysMatch && overallStatus === 'success') overallStatus = 'warning';
      } else {
        checks.push({
          label: 'Issuer Trust',
          status: 'warning',
          detail: `⚠️ Issuer "${cred.issuer.name}" is NOT in the local trusted registry. Signature is valid but issuer trust is unconfirmed.`,
        });
        if (overallStatus === 'success') overallStatus = 'warning';
      }

      // ── Check 6: Blockchain Anchor Verification ───────────────────
      const storedAnchorHash = presentation.blockchain?.anchorHash;
      if (storedAnchorHash) {
        if (typeof BlockchainModule === 'undefined') {
          checks.push({
            label: 'Blockchain Anchor',
            status: 'warning',
            detail: '⚠️ Blockchain module not loaded; on-chain verification skipped',
          });
          if (overallStatus === 'success') overallStatus = 'warning';
        } else {
          try {
            const recomputedHash = await BlockchainModule.computeCredentialHashFromPresentation(presentation);
            if (recomputedHash !== storedAnchorHash) {
              checks.push({
                label: 'Blockchain Anchor',
                status: 'fail',
                detail: '⛓️ ❌ Anchor hash mismatch — presentation payload was modified after creation',
              });
              overallStatus = 'failure';
            } else {
              const chainResult = await BlockchainModule.verifyHash(storedAnchorHash);
              if (chainResult.anchored) {
                const anchoredAt = chainResult.anchorTime
                  ? new Date(chainResult.anchorTime * 1000).toLocaleString()
                  : 'timestamp unavailable';
                checks.push({
                  label: 'Blockchain Anchor',
                  status: 'pass',
                  detail: `⛓️ ✅ Hash anchored on-chain (${presentation.blockchain?.network || 'Polygon Amoy'}) at ${anchoredAt}`,
                });
              } else {
                checks.push({
                  label: 'Blockchain Anchor',
                  status: 'warning',
                  detail: '⛓️ ⚠️ Anchor hash not found on-chain (credential remains cryptographically verifiable off-chain)',
                });
                if (overallStatus === 'success') overallStatus = 'warning';
              }
            }
          } catch (e) {
            checks.push({
              label: 'Blockchain Anchor',
              status: 'warning',
              detail: `⛓️ ⚠️ Could not verify on-chain anchor: ${e.message}`,
            });
            if (overallStatus === 'success') overallStatus = 'warning';
          }
        }
      } else {
        checks.push({
          label: 'Blockchain Anchor',
          status: 'warning',
          detail: '⛓️ No blockchain anchor hash attached to this presentation',
        });
        if (overallStatus === 'success') overallStatus = 'warning';
      }

      // ── Check 7: REAL Groth16 ZKP Proof Verification ──────────────
      for (const [field, proofData] of Object.entries(zkpProofs)) {
        if (proofData.type === 'Groth16' && proofData.proof && proofData.publicSignals) {
          try {
            // Load the verification key
            const vk = await loadVerificationKey();
            if (!vk) {
              checks.push({
                label: `ZKP: ${proofData.claim}`,
                status: 'fail',
                detail: `🧮 Cannot load verification key — unable to verify Groth16 proof`,
              });
              overallStatus = 'failure';
              continue;
            }

            // REAL snarkjs Groth16 verification
            console.log('[ZKP Verify] Verifying Groth16 proof...');
            console.log('[ZKP Verify] Proof:', proofData.proof);
            console.log('[ZKP Verify] Public signals:', proofData.publicSignals);

            const isValid = await snarkjs.groth16.verify(
              vk,
              proofData.publicSignals,
              proofData.proof
            );

            console.log('[ZKP Verify] Result:', isValid);
            proofData.result = isValid;

            if (isValid) {
              // Verify the public signal matches the claimed threshold
              const publicThreshold = parseInt(proofData.publicSignals[0], 10);
              const claimedThreshold = proofData.scaledThreshold;
              const thresholdMatch = Number.isFinite(publicThreshold) && publicThreshold === claimedThreshold;
              proofData.thresholdMatch = thresholdMatch;

              checks.push({
                label: `ZKP Groth16: ${proofData.claim}`,
                status: thresholdMatch ? 'pass' : 'warning',
                detail: thresholdMatch
                  ? `🧮 ✅ Groth16 proof VERIFIED — "${proofData.claim}" is mathematically proven TRUE. Protocol: groth16 on bn128. Public threshold: ${publicThreshold / 10}. Actual value NOT revealed.`
                  : `🧮 ⚠️ Groth16 proof valid but threshold mismatch: public=${publicThreshold}, claimed=${claimedThreshold}`,
              });
              if (!thresholdMatch && overallStatus === 'success') overallStatus = 'warning';
            } else {
              checks.push({
                label: `ZKP Groth16: ${proofData.claim}`,
                status: 'fail',
                detail: `🧮 ❌ Groth16 proof verification FAILED — the range claim "${proofData.claim}" is NOT proven.`,
              });
              overallStatus = 'failure';
            }
          } catch (e) {
            console.error('[ZKP Verify] Error:', e);
            checks.push({
              label: `ZKP: ${proofData.claim}`,
              status: 'fail',
              detail: `🧮 ZKP verification error: ${e.message}`,
            });
            overallStatus = 'failure';
          }
        } else {
          // Legacy/fallback for non-Groth16 proofs
          proofData.result = !!proofData.result;
          checks.push({
            label: `ZKP: ${proofData.claim}`,
            status: proofData.result ? 'pass' : 'fail',
            detail: `🧮 Legacy proof — claim "${proofData.claim}": ${proofData.result ? 'TRUE' : 'FALSE'}`,
          });
          if (!proofData.result) overallStatus = 'failure';
        }
      }

      // ── Build Result ──────────────────────────────────────────────
      const statusConfig = {
        success: { icon: '✅', title: 'Credential Verified', subtitle: 'All checks passed. This credential is authentic and valid.' },
        warning: { icon: '⚠️', title: 'Verified with Warnings', subtitle: 'The credential signature is valid but there are some concerns.' },
        failure: { icon: '❌', title: 'Verification Failed', subtitle: 'One or more critical checks failed. Do NOT trust this credential.' },
      };

      const config = statusConfig[overallStatus];

      showResult({
        status: overallStatus,
        icon: config.icon,
        title: config.title,
        subtitle: config.subtitle,
        checks: checks,
        credential: cred,
        disclosedFields: cred.disclosedFields,
        zkpProofs: zkpProofs,
        presentation: presentation,
      });

      Store.appendAuditLog({
        event: overallStatus === 'failure' ? 'failed' : 'verified',
        actor: 'Verifier Portal',
        details: `${config.title} — Code: ${code} — ${cred.issuer.name} → ${cred.disclosedFields?.name || cred.originalSubject?.name || 'Unknown'}`,
        credentialId: cred.id,
      });

      verificationHistory.unshift({
        code,
        status: overallStatus,
        issuer: cred.issuer.name,
        type: cred.type[1],
        timestamp: new Date().toISOString(),
      });
      renderHistory();
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = '🔍 Verify';
    }
  }

  // ── Render Verification Result ──────────────────────────────────
  function showResult(result) {
    const section = document.getElementById('result-section');
    const card = document.getElementById('result-card');
    section.style.display = 'block';

    const statusClass = result.status === 'success' ? 'success' : result.status === 'warning' ? 'warning' : 'failure';

    let checksHtml = result.checks.map(check => `
      <div style="display:flex; align-items:flex-start; gap: var(--space-sm); padding: var(--space-sm) 0; border-bottom: 1px solid var(--border-subtle);">
        <span style="flex-shrink:0; font-size:0.85rem;">
          ${check.status === 'pass' ? '✅' : check.status === 'warning' ? '⚠️' : '❌'}
        </span>
        <div>
          <div style="font-size: 0.85rem; font-weight: 600;">${check.label}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${check.detail}</div>
        </div>
      </div>
    `).join('');

    let disclosedHtml = '';
    if (result.disclosedFields && Object.keys(result.disclosedFields).length > 0) {
      disclosedHtml = `
        <div class="verification-details" style="margin-top: var(--space-xl);">
          <h3 style="font-size: 0.9rem; font-weight: 600; margin-bottom: var(--space-md);">📋 Disclosed Information</h3>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: var(--space-md);">
            Only the fields the student chose to share are shown below.
          </p>
          ${Object.entries(result.disclosedFields).map(([key, value]) => {
            const displayValue = Array.isArray(value) ? value.join(', ') : value;
            return `
              <div class="credential-field" style="margin-bottom: var(--space-sm);">
                <span class="credential-field-label">${formatFieldLabel(key)}</span>
                <span class="credential-field-value">${displayValue}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    let zkpHtml = '';
    if (result.zkpProofs && Object.keys(result.zkpProofs).length > 0) {
      zkpHtml = `
        <div class="verification-details" style="margin-top: var(--space-xl);">
          <h3 style="font-size: 0.9rem; font-weight: 600; margin-bottom: var(--space-md);">🧮 Zero-Knowledge Proofs (Groth16)</h3>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: var(--space-md);">
            These claims are mathematically proven using real Groth16 zk-SNARK proofs on the bn128 curve. The actual values are NEVER revealed.
          </p>
          ${Object.entries(result.zkpProofs).map(([key, proof]) => `
            <div class="toggle-row zkp-row">
              <div class="toggle-info">
                <span class="toggle-label">
                  <span class="zkp-badge">ZKP Groth16</span> ${proof.claim}
                </span>
                <span class="toggle-value" style="font-size:0.7rem;">
                  Protocol: ${proof.protocol || 'groth16'} · Curve: ${proof.curve || 'bn128'}
                  ${proof.proof ? ` · π_a: ${JSON.stringify(proof.proof.pi_a[0]).substring(0,16)}…` : ''}
                </span>
              </div>
              <span class="badge ${proof.result !== false ? 'badge-verified' : 'badge-failed'}">
                ${proof.result !== false ? '✅ Proven' : '❌ Failed'}
              </span>
            </div>
          `).join('')}
        </div>
      `;
    }

    let metaHtml = '';
    if (result.credential) {
      metaHtml = `
        <div class="verification-details" style="margin-top: var(--space-xl);">
          <h3 style="font-size: 0.9rem; font-weight: 600; margin-bottom: var(--space-md);">📝 Credential Metadata</h3>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Credential Type</span>
            <span class="credential-field-value">${result.credential.type.join(' › ')}</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Issuer</span>
            <span class="credential-field-value">${result.credential.issuer.name}</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Issued On</span>
            <span class="credential-field-value">${new Date(result.credential.issuanceDate).toLocaleDateString()}</span>
          </div>
          <div class="credential-field" style="margin-bottom: var(--space-sm);">
            <span class="credential-field-label">Expires On</span>
            <span class="credential-field-value">${new Date(result.credential.expirationDate).toLocaleDateString()}</span>
          </div>
          ${result.presentation ? `
            <div class="credential-field" style="margin-bottom: var(--space-sm);">
              <span class="credential-field-label">Presentation Created</span>
              <span class="credential-field-value">${new Date(result.presentation.created).toLocaleString()}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="verification-result">
        <div class="verification-icon ${statusClass}">${result.icon}</div>
        <h2 class="verification-title">${result.title}</h2>
        <p class="verification-subtitle">${result.subtitle}</p>
        <div class="verification-details">
          <h3 style="font-size: 0.9rem; font-weight: 600; margin-bottom: var(--space-md);">Verification Checks</h3>
          ${checksHtml}
        </div>
        ${disclosedHtml}
        ${zkpHtml}
        ${metaHtml}
      </div>
    `;

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Render Trusted Issuers ──────────────────────────────────────
  function renderIssuers() {
    const container = document.getElementById('issuers-list');
    const emptyEl = document.getElementById('issuers-empty');
    const issuers = Store.getIssuers();

    if (Object.keys(issuers).length === 0) {
      container.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    container.innerHTML = '';

    Object.entries(issuers).forEach(([name, data]) => {
      const item = document.createElement('div');
      item.className = 'credential-mini fade-in';
      item.innerHTML = `
        <div class="credential-mini-icon" style="background: rgba(99,102,241,0.15); color: var(--accent-indigo-light);">
          🏛️
        </div>
        <div class="credential-mini-info">
          <div class="credential-mini-title">${name}</div>
          <div class="credential-mini-sub">
            Registered: ${new Date(data.registeredAt).toLocaleString()} ·
            Key: ${data.publicKey?.kty || 'EC'} ${data.publicKey?.crv || 'P-256'}
          </div>
        </div>
        <span class="badge badge-valid">Trusted</span>
      `;
      container.appendChild(item);
    });
  }

  // ── Render Verification History ─────────────────────────────────
  function renderHistory() {
    const container = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');

    if (verificationHistory.length === 0) {
      container.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    container.innerHTML = '';

    verificationHistory.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'credential-mini fade-in';
      const statusBadge = entry.status === 'success' ? 'badge-valid' :
                          entry.status === 'warning' ? 'badge-expiring' : 'badge-failed';
      const statusIcon = entry.status === 'success' ? '✅' : entry.status === 'warning' ? '⚠️' : '❌';
      item.innerHTML = `
        <div class="credential-mini-icon" style="background: ${entry.status === 'success' ? 'rgba(16,185,129,0.15)' : entry.status === 'warning' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'};">
          ${statusIcon}
        </div>
        <div class="credential-mini-info">
          <div class="credential-mini-title">
            Code: ${entry.code}
            <span class="badge ${statusBadge}">${entry.status}</span>
          </div>
          <div class="credential-mini-sub">
            ${entry.issuer} · ${entry.type} · ${new Date(entry.timestamp).toLocaleString()}
          </div>
        </div>
      `;
      container.appendChild(item);
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function formatFieldLabel(key) {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .replace('Id', 'ID');
  }

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

  // ── Event Listeners ─────────────────────────────────────────────
  document.getElementById('btn-verify').addEventListener('click', verifyPresentation);
  document.getElementById('verify-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') verifyPresentation();
  });

  // Auto-fill from URL params (from QR code scan)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('code')) {
    document.getElementById('verify-code').value = urlParams.get('code');
    setTimeout(verifyPresentation, 500);
  }

  // Reactive updates
  StateManager.on('store:updated', renderIssuers);
  StateManager.enableCrossTabSync();

  // ── Init ────────────────────────────────────────────────────────
  loadVerificationKey(); // Pre-load for faster verification
  renderIssuers();
  renderHistory();
})();
