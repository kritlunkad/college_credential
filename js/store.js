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

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => {
        if (typeof value[k] !== 'undefined') out[k] = canonicalize(value[k]);
      });
      return out;
    }
    return value;
  }

  function fingerprintJwk(jwk) {
    try {
      return JSON.stringify(canonicalize(jwk || {}));
    } catch {
      return '';
    }
  }

  // ── Issuer Keys ──────────────────────────────────────────────────
  function savePrivateKey(jwk) {
    setJSON(localStorage, KEYS.ISSUER_PRIVATE_KEY, jwk);
  }

  function getPrivateKey() {
    return getJSON(localStorage, KEYS.ISSUER_PRIVATE_KEY);
  }

  function savePublicKey(issuerName, jwk) {
    if (!issuerName || !jwk) return;
    // Save to issuers registry (multi-issuer support)
    const issuers = getIssuers();
    const now = new Date().toISOString();
    const prev = issuers[issuerName] || {};
    const nextFp = fingerprintJwk(jwk);
    const history = Array.isArray(prev.publicKeys) ? [...prev.publicKeys] : [];

    if (prev.publicKey) {
      const prevFp = fingerprintJwk(prev.publicKey);
      if (prevFp && !history.some((k) => k.fingerprint === prevFp)) {
        history.push({
          jwk: prev.publicKey,
          fingerprint: prevFp,
          registeredAt: prev.registeredAt || now,
        });
      }
    }

    if (nextFp && !history.some((k) => k.fingerprint === nextFp)) {
      history.push({
        jwk,
        fingerprint: nextFp,
        registeredAt: now,
      });
    }

    issuers[issuerName] = {
      ...prev,
      publicKey: jwk,
      publicKeys: history,
      registeredAt: now,
    };
    setJSON(localStorage, KEYS.ISSUERS, issuers);
  }

  function getPublicKey(issuerName) {
    const issuers = getIssuers();
    return issuers[issuerName]?.publicKey || null;
  }

  function getPublicKeys(issuerName) {
    const issuers = getIssuers();
    const issuer = issuers[issuerName];
    if (!issuer) return [];
    const out = [];
    const seen = new Set();

    const pushKey = (key) => {
      const fp = fingerprintJwk(key);
      if (!fp || seen.has(fp)) return;
      seen.add(fp);
      out.push(key);
    };

    if (Array.isArray(issuer.publicKeys)) {
      issuer.publicKeys.forEach((entry) => pushKey(entry?.jwk || null));
    }
    pushKey(issuer.publicKey || null);
    return out;
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

  function updateCredentialById(id, updater) {
    const all = getAllCredentials();
    const idx = all.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const current = all[idx];
    const updated = typeof updater === 'function'
      ? updater(current)
      : { ...current, ...updater };
    if (!updated) return null;
    all[idx] = updated;
    setJSON(localStorage, KEYS.CREDENTIALS, all);
    StateManager.emit('credential:issued', updated);
    return updated;
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

  function getLatestPresentationByCredentialId(credentialId) {
    const all = getAllPresentations();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]?.credential?.id === credentialId) return all[i];
    }
    return null;
  }

  function updatePresentationByCode(code, updater) {
    const all = getAllPresentations();
    const idx = all.findIndex(p => p.verificationCode === code);
    if (idx === -1) return null;

    const current = all[idx];
    const updated = typeof updater === 'function'
      ? updater(current)
      : { ...current, ...updater };

    if (!updated) return null;
    all[idx] = updated;
    setJSON(localStorage, KEYS.PRESENTATIONS, all);
    StateManager.emit('presentation:updated', updated);
    return updated;
  }

  function saveOrReplacePresentationForCredential(credentialId, presentation) {
    const all = getAllPresentations().filter(p => p?.credential?.id !== credentialId);
    all.push(presentation);
    setJSON(localStorage, KEYS.PRESENTATIONS, all);
    StateManager.emit('presentation:updated', presentation);
    return presentation;
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
    savePublicKey, getPublicKey, getPublicKeys, getIssuers,
    saveIssuerMeta, getIssuerMeta,
    getAllCredentials, saveCredential, getCredentialsByEnrollment, getCredentialById, updateCredentialById,
    getClaimedCredentials, claimCredential, isCredentialClaimed,
    getAllPresentations, savePresentation, getPresentationByCode, getLatestPresentationByCredentialId, updatePresentationByCode, saveOrReplacePresentationForCredential, markPresentationUsed,
    getRevokedIds, revokeCredential, isRevoked,
    getAuditLog, appendAuditLog, exportAuditLog,
    clearAll,
  };
})();
