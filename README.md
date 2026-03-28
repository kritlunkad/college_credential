# CredChain

Privacy-first academic credential issuance, sharing, and verification with:
- Verifiable Credentials (W3C-style JSON)
- ECDSA signatures
- Selective disclosure
- Groth16 ZK proofs
- blockchain hash anchoring (Polygon Amoy)
- Cloud sync + auth (Firebase + Vercel)

## What This Project Solves
Traditional credential verification is slow, manual, and privacy-heavy.
CredChain lets a college issue signed credentials, students share only required data, and verifiers validate cryptographic proof quickly.

## Key Features
- College admin login and issuance flow
- Student wallet with claim-by-enrollment and claim-by-code
- Share QR/verification code with selective fields
- Groth16 proof support for policy checks (example: GPA threshold)
- Verifier checks: replay, revocation, expiry, signature, issuer trust, source-doc hash evidence, anchor status
- MetaMask role separation checks (issuer wallet vs holder wallet)
- Email claim code delivery via SMTP
- Biometric gate (WebAuthn) with short session grace window
- Source document evidence in hash-only mode (no raw file storage)

## High-Level Architecture
```text
+------------------+          +--------------------------+
|  College Portal  |  POST    |  Vercel API (Node JS)   |
|  (college.html)  +--------->+  /api/issue, /api/*      |
+--------+---------+          +-----------+--------------+
         |                                |
         | signs VC (ECDSA)               | stores records
         v                                v
+-------------------+            +------------------------+
|  Student Wallet   |<---------->+  Firebase (Auth + DB)  |
|  (wallet.html)    |            +------------------------+
+---------+---------+
          |
          | VP + QR/code
          v
+-------------------+
| Verifier Portal   |
| (verifier.html)   |
+---------+---------+
          |
          | optional on-chain hash check
          v
+--------------------------+
| Polygon Amoy Contract    |
| TrustlessIDRegistry.sol  |
+--------------------------+
```

## End-to-End Flow
```text
1) Issue
College -> fill form -> sign credential -> save cloud -> email claim code

2) Claim
Student -> login -> enter enrollment/claim code -> fetch assigned credential

3) Share
Student -> choose fields -> generate VP (+ optional ZKP) -> get QR/code

4) Verify
Verifier -> enter/scan code -> fetch VP -> run checks -> verdict

5) Anchor (optional)
Student -> anchor credential hash on Polygon -> verifier confirms on-chain
```

## Detailed Verification Checks
The verifier currently evaluates:
1. Replay detection
2. Revocation status
3. Expiry status
4. Issuer signature validity (ECDSA P-256)
5. Issuer trust registry match (with key history handling)
6. Source document hash evidence presence
7. Blockchain anchor integrity/existence (if anchor exists)
8. Issuer-vs-holder wallet separation
9. ZK proof validation (when provided)

## Project Structure
```text
college_credential/
├── api/
│   ├── _lib/
│   │   ├── email.js
│   │   ├── firebaseAdmin.js
│   │   └── http.js
│   ├── credentials/
│   │   ├── [enrollmentId].js
│   │   └── claim/[claimCode].js
│   ├── presentations/
│   │   ├── [code].js
│   │   └── index.js
│   ├── student/bind-enrollment.js
│   ├── trusted-issuers/index.js
│   ├── issue.js
│   └── health.js
├── contract/
│   └── TrustlessIDRegistry.sol
├── css/
│   └── style.css
├── js/
│   ├── biometric-auth.js
│   ├── blockchain.js
│   ├── cloud-api.js
│   ├── cloud-auth.js
│   ├── college.js
│   ├── crypto.js
│   ├── data.js
│   ├── state.js
│   ├── store.js
│   ├── verifier.js
│   ├── wallet.js
│   └── firebase-config.example.js
├── zkp/
│   ├── gpa_range_proof.wasm
│   ├── gpa_range_proof.zkey
│   └── verification_key.json
├── college.html
├── wallet.html
├── verifier.html
├── index.html
├── vercel.json
└── DEPLOY_VERCEL_FIREBASE.md
```

## Prerequisites
- Node.js 18+
- npm
- MetaMask (for issuer/holder wallet flows and on-chain anchor)
- Firebase project (Auth + Firestore)
- Vercel CLI (for local serverless + deployment)

## Configuration

### 1) Frontend Firebase Config
Create `js/firebase-config.js` from example:

```bash
cp js/firebase-config.example.js js/firebase-config.js
```

Then fill:
- `apiKey`
- `authDomain`
- `projectId`
- `appId`

### 2) API Environment Variables
Set these in local `.env` and in Vercel env settings:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (with `\n` escaped newlines)
- `COLLEGE_ADMIN_EMAILS` (comma-separated admin emails)
- `APP_BASE_URL` (for email claim link)
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `CLAIM_EMAIL_FROM`

Optional:
- `FIREBASE_STORAGE_BUCKET` (not needed for current hash-only doc-evidence mode)

## How to Run (Local)

### Recommended (full system with API routes)
```bash
npm install
npx vercel dev
```

Open:
- `http://localhost:3000/college`
- `http://localhost:3000/wallet`
- `http://localhost:3000/verifier`

### Quick static-only mode (limited)
You can open HTML directly, but cloud APIs/auth will not function correctly without `vercel dev`.

## How to Deploy
```bash
npm install
npx vercel
# or
npx vercel --prod
```

Also see: `DEPLOY_VERCEL_FIREBASE.md`

## API Summary
- `POST /api/issue` -> issue credential, optional doc hash evidence, email claim code
- `GET /api/credentials/:enrollmentId` -> fetch credentials for authorized user
- `GET /api/credentials/claim/:claimCode` -> claim via code
- `POST /api/student/bind-enrollment` -> bind student uid/email to enrollment id
- `POST /api/presentations` -> save/update VP
- `GET /api/presentations/:code` -> fetch VP for verifier
- `GET|POST /api/trusted-issuers` -> list/add trusted issuer keys
- `GET /api/health` -> health check

## Source Document Evidence Mode
Current behavior is hash-only:
- UI accepts optional source file (max 2MB)
- System computes/keeps SHA-256 evidence metadata
- Raw document is **not** stored in Firebase Storage

## Security Notes
- Private key handling in this demo is browser-local and simplified.
- WebAuthn verification is client-side gated for speed.
- For production hardening:
  - move WebAuthn verification server-side
  - use HSM/KMS for issuer keys
  - add stricter nonce/session policies
  - add rate limits and audit retention policy

## Troubleshooting
- "Admin authentication required"
  - Ensure college admin email is included in `COLLEGE_ADMIN_EMAILS`.
- "Credential issued locally, cloud sync failed"
  - Check Firebase Admin env vars and `vercel dev` logs.
- Claim code email not sent
  - Verify SMTP env vars and sender credentials.
- MetaMask anchor failure (gas/min tip)
  - Switch to Polygon Amoy and retry with market gas settings.
- Passkey prompts too often
  - Biometric module now uses a short session grace window.

## License
ISC
