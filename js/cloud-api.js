/**
 * cloud-api.js — API client for Vercel serverless routes
 */

const CloudApi = (() => {
  async function getAuthHeader() {
    if (typeof CloudAuth === 'undefined') return {};
    const token = await CloudAuth.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(await getAuthHeader()),
      ...(options.headers || {}),
    };

    const res = await fetch(path, {
      ...options,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `API request failed: ${res.status}`);
    }
    return data;
  }

  async function issueCredential(credential, studentEmail = null, sourceDocument = null) {
    return await request('/api/issue', {
      method: 'POST',
      body: JSON.stringify({ credential, studentEmail, sourceDocument }),
    });
  }

  async function bindEnrollment(enrollmentId) {
    return await request('/api/student/bind-enrollment', {
      method: 'POST',
      body: JSON.stringify({ enrollmentId }),
    });
  }

  async function fetchCredentials(enrollmentId) {
    const encoded = encodeURIComponent(enrollmentId);
    return await request(`/api/credentials/${encoded}`, { method: 'GET' });
  }

  async function fetchCredentialByClaimCode(claimCode) {
    const encoded = encodeURIComponent(claimCode);
    return await request(`/api/credentials/claim/${encoded}`, { method: 'GET' });
  }

  async function savePresentation(presentation) {
    return await request('/api/presentations', {
      method: 'POST',
      body: JSON.stringify({ presentation }),
    });
  }

  async function fetchPresentationByCode(code) {
    const encoded = encodeURIComponent(code);
    return await request(`/api/presentations/${encoded}`, { method: 'GET' });
  }

  async function fetchTrustedIssuers() {
    return await request('/api/trusted-issuers', { method: 'GET' });
  }

  return {
    issueCredential,
    bindEnrollment,
    fetchCredentials,
    fetchCredentialByClaimCode,
    savePresentation,
    fetchPresentationByCode,
    fetchTrustedIssuers,
  };
})();
