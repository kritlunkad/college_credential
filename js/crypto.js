/**
 * crypto.js — ECDSA P-256 signing & verification via Web Crypto API
 * 
 * Key design decisions per user feedback:
 *   - Private key stored in sessionStorage (ephemeral, per-tab)
 *   - Public key embedded in every issued credential (self-contained verification)
 *   - SHA-256 commitment for ZKP simulation: commit = hash(value + nonce)
 */

const CryptoModule = (() => {
  const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' };

  // ── Key Generation ──────────────────────────────────────────────
  async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
    return keyPair;
  }

  async function exportPublicKey(key) {
    return await crypto.subtle.exportKey('jwk', key);
  }

  async function exportPrivateKey(key) {
    return await crypto.subtle.exportKey('jwk', key);
  }

  async function importPublicKey(jwk) {
    return await crypto.subtle.importKey('jwk', jwk, ALGO, true, ['verify']);
  }

  async function importPrivateKey(jwk) {
    return await crypto.subtle.importKey('jwk', jwk, ALGO, true, ['sign']);
  }

  // ── Signing ─────────────────────────────────────────────────────
  async function signData(privateKey, data) {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const signature = await crypto.subtle.sign(SIGN_ALGO, privateKey, encoded);
    return bufferToBase64(signature);
  }

  // ── Verification ────────────────────────────────────────────────
  async function verifySignature(publicKeyJwk, data, signatureBase64) {
    try {
      const pubKey = await importPublicKey(publicKeyJwk);
      const encoded = new TextEncoder().encode(JSON.stringify(data));
      const sigBuffer = base64ToBuffer(signatureBase64);
      return await crypto.subtle.verify(SIGN_ALGO, pubKey, sigBuffer, encoded);
    } catch (e) {
      console.error('Verification failed:', e);
      return false;
    }
  }

  // ── ZKP Commitment (SHA-256 hash-based) ─────────────────────────
  // commit = SHA-256(value || nonce)
  // Student holds nonce; verifier gets commit + range claim
  async function createCommitment(value, nonce) {
    const payload = `${value}:${nonce}`;
    const encoded = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return bufferToHex(hashBuffer);
  }

  async function verifyCommitment(value, nonce, expectedCommit) {
    const actual = await createCommitment(value, nonce);
    return actual === expectedCommit;
  }

  function generateNonce() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return bufferToHex(arr.buffer);
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function generateId() {
    return 'vc-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);
  }

  function generateVerificationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  return {
    generateKeyPair,
    exportPublicKey,
    exportPrivateKey,
    importPublicKey,
    importPrivateKey,
    signData,
    verifySignature,
    createCommitment,
    verifyCommitment,
    generateNonce,
    generateId,
    generateVerificationCode,
  };
})();
