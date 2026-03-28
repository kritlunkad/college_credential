/**
 * store.js — Namespaced storage wrapper
 * 
 * Design:
 *   - Private keys → sessionStorage (ephemeral, per-tab, never persisted)
 *   - Everything else → localStorage (shared across tabs on same origin)
 *   - Namespaced keys to avoid collisions
 */

const Store = (() => {
  const KEYS = {
    ISSUER_PRIVATE_KEY: 'cc_issuer_private_key',     // sessionStorage
    ISSUER_PUBLIC_KEY: 'cc_issuer_public_key',        // localStorage (shared)
    ISSUER_META: 'cc_issuer_meta',                    // localStorage
    CREDENTIALS: 'cc_credentials',                     // localStorage
    CLAIMED_CREDENTIALS: 'cc_claimed_credentials',     // localStorage
    PRESENTATIONS: 'cc_presentations',                 // localStorage
    REVOKED: 'cc_revoked',                             // localStorage
    AUDIT_LOG: 'cc_audit_log',                         // localStorage
    ISSUERS: 'cc_issuers',                             // localStorage (multi-issuer registry)
  };

  // ── Generic helpers ──────────────────────────────────────────────
  function getJSON(storage, key, fallback = null) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function setJSON(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  // ── Issuer Keys ──────────────────────────────────────────────────
  function savePrivateKey(jwk) {
    setJSON(localStorage, KEYS.ISSUER_PRIVATE_KEY, jwk);
  }

  function getPrivateKey() {
    return getJSON(localStorage, KEYS.ISSUER_PRIVATE_KEY);
  }

  function savePublicKey(issuerName, jwk) {
    // Save to issuers registry (multi-issuer support)
    const issuers = getIssuers();
    issuers[issuerName] = { publicKey: jwk, registeredAt: new Date().toISOString() };
    setJSON(localStorage, KEYS.ISSUERS, issuers);
  }

  function getPublicKey(issuerName) {
    const issuers = getIssuers();
    return issuers[issuerName]?.publicKey || null;
  }

  function getIssuers() {
    return getJSON(localStorage, KEYS.ISSUERS, {});
  }

  // ── Issuer Metadata ──────────────────────────────────────────────
  function saveIssuerMeta(meta) {
    setJSON(localStorage, KEYS.ISSUER_META, meta);
  }

  function getIssuerMeta() {
    return getJSON(localStorage, KEYS.ISSUER_META);
  }

  // ── Credentials ──────────────────────────────────────────────────
  function getAllCredentials() {
    return getJSON(localStorage, KEYS.CREDENTIALS, []);
  }

  function saveCredential(credential) {
    const all = getAllCredentials();
    all.push(credential);
    setJSON(localStorage, KEYS.CREDENTIALS, all);
    StateManager.emit('credential:issued', credential);
  }

  function getCredentialsByEnrollment(enrollmentId) {
    return getAllCredentials().filter(
      c => c.credentialSubject.enrollmentId === enrollmentId
    );
  }

  function getCredentialById(id) {
    return getAllCredentials().find(c => c.id === id);
  }

  // ── Claimed Credentials (Student Wallet) ──────────────────────
  function getClaimedCredentials() {
    return getJSON(localStorage, KEYS.CLAIMED_CREDENTIALS, []);
  }

  function claimCredential(credentialId) {
    const claimed = getClaimedCredentials();
    if (!claimed.includes(credentialId)) {
      claimed.push(credentialId);
      setJSON(localStorage, KEYS.CLAIMED_CREDENTIALS, claimed);
      StateManager.emit('credential:claimed', credentialId);
    }
  }

  function isCredentialClaimed(credentialId) {
    return getClaimedCredentials().includes(credentialId);
  }

  // ── Presentations ────────────────────────────────────────────────
  function getAllPresentations() {
    return getJSON(localStorage, KEYS.PRESENTATIONS, []);
  }

  function savePresentation(presentation) {
    const all = getAllPresentations();
    all.push(presentation);
    setJSON(localStorage, KEYS.PRESENTATIONS, all);
    StateManager.emit('presentation:created', presentation);
  }

  function getPresentationByCode(code) {
    return getAllPresentations().find(p => p.verificationCode === code);
  }

  function markPresentationUsed(code) {
    const all = getAllPresentations();
    const p = all.find(p => p.verificationCode === code);
    if (p) {
      p.usedAt = new Date().toISOString();
      setJSON(localStorage, KEYS.PRESENTATIONS, all);
    }
  }

  // ── Revocation ───────────────────────────────────────────────────
  function getRevokedIds() {
    return getJSON(localStorage, KEYS.REVOKED, []);
  }

  function revokeCredential(credentialId) {
    const revoked = getRevokedIds();
    if (!revoked.includes(credentialId)) {
      revoked.push(credentialId);
      setJSON(localStorage, KEYS.REVOKED, revoked);
      StateManager.emit('credential:revoked', credentialId);
    }
  }

  function isRevoked(credentialId) {
    return getRevokedIds().includes(credentialId);
  }

  // ── Audit Log ────────────────────────────────────────────────────
  function getAuditLog() {
    return getJSON(localStorage, KEYS.AUDIT_LOG, []);
  }

  function appendAuditLog(entry) {
    const log = getAuditLog();
    log.push({
      ...entry,
      timestamp: new Date().toISOString(),
      id: 'evt-' + Date.now().toString(36),
    });
    setJSON(localStorage, KEYS.AUDIT_LOG, log);
    StateManager.emit('audit:new', entry);
  }

  function exportAuditLog() {
    return JSON.stringify(getAuditLog(), null, 2);
  }

  // ── Reset (for demo) ────────────────────────────────────────────
  function clearAll() {
    Object.values(KEYS).forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    StateManager.emit('store:cleared');
  }

  return {
    savePrivateKey, getPrivateKey,
    savePublicKey, getPublicKey, getIssuers,
    saveIssuerMeta, getIssuerMeta,
    getAllCredentials, saveCredential, getCredentialsByEnrollment, getCredentialById,
    getClaimedCredentials, claimCredential, isCredentialClaimed,
    getAllPresentations, savePresentation, getPresentationByCode, markPresentationUsed,
    getRevokedIds, revokeCredential, isRevoked,
    getAuditLog, appendAuditLog, exportAuditLog,
    clearAll,
  };
})();
