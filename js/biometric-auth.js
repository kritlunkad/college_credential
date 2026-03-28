/**
 * biometric-auth.js — lightweight WebAuthn gate for sensitive actions
 *
 * Note: This is client-side gating for hackathon speed. For production,
 * verify attestation/assertion signatures on the backend.
 */

const BiometricAuth = (() => {
  const KEY_ID = 'cc_webauthn_credential_id';
  const KEY_ENABLED = 'cc_biometric_enabled';

  function toBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    bytes.forEach((b) => (str += String.fromCharCode(b)));
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function fromBase64Url(base64url) {
    const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr.buffer;
  }

  function randomChallenge(bytes = 32) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return arr.buffer;
  }

  function isSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  function isEnabled() {
    return localStorage.getItem(KEY_ENABLED) === 'true';
  }

  function hasCredential() {
    return !!localStorage.getItem(KEY_ID);
  }

  async function enroll() {
    if (!isSupported()) throw new Error('WebAuthn not supported on this device');

    const publicKey = {
      challenge: randomChallenge(),
      rp: { name: 'CredChain' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'credchain-user',
        displayName: 'CredChain User',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
      attestation: 'none',
    };

    const cred = await navigator.credentials.create({ publicKey });
    if (!cred || !cred.rawId) throw new Error('Biometric enrollment failed');
    localStorage.setItem(KEY_ID, toBase64Url(cred.rawId));
    localStorage.setItem(KEY_ENABLED, 'true');
    return true;
  }

  async function verify() {
    if (!isSupported()) return true;
    if (!isEnabled() || !hasCredential()) return true;

    const id = localStorage.getItem(KEY_ID);
    const publicKey = {
      challenge: randomChallenge(),
      allowCredentials: [{ type: 'public-key', id: fromBase64Url(id) }],
      userVerification: 'required',
      timeout: 60000,
    };

    const assertion = await navigator.credentials.get({ publicKey });
    return !!assertion;
  }

  function disable() {
    localStorage.removeItem(KEY_ENABLED);
  }

  return {
    isSupported,
    isEnabled,
    hasCredential,
    enroll,
    verify,
    disable,
  };
})();
