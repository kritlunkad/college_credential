# CredChain Cloud Deployment (Vercel + Firebase)

## 1) Firebase setup
1. Create a Firebase project.
2. Enable Authentication:
   - Google provider (for students)
   - Email/Password provider (for college admins)
3. Create a Web App in Firebase and copy config values.
4. Create a Service Account key in Firebase Console -> Project Settings -> Service Accounts.

## 2) Frontend config
1. Copy `js/firebase-config.example.js` to `js/firebase-config.js`.
2. Fill `window.FIREBASE_CONFIG`.

## 3) Vercel env vars
Set these in Vercel Project Settings -> Environment Variables:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (paste with `\n` escaped newlines)
- `COLLEGE_ADMIN_EMAILS` (comma-separated emails allowed to issue credentials)
- `APP_BASE_URL` (your public app URL, e.g. `https://your-app.vercel.app`)
- `SMTP_HOST` (e.g. `smtp.gmail.com`)
- `SMTP_PORT` (usually `587` for TLS or `465` for SSL)
- `SMTP_SECURE` (`true` for SSL/465, otherwise `false`)
- `SMTP_USER` (SMTP username/login email)
- `SMTP_PASS` (SMTP password or app password)
- `CLAIM_EMAIL_FROM` (sender, e.g. `CredChain <no-reply@yourdomain.com>`)

You can use `.env.example` as reference.

## 4) Deploy
```bash
npm install
npx vercel
```

For local API + static testing:
```bash
npx vercel dev
```

## 5) End-to-end production flow
1. College page:
   - Admin login (email/password)
   - Connect issuer wallet
   - (Optional) enable biometric
   - Issue credential (saved to cloud via `/api/issue`)
   - Claim code + claim link emailed automatically if student email + SMTP env vars are configured
2. Student page:
   - Sign in with Google
   - Enter enrollment ID and claim (`/api/student/bind-enrollment` + `/api/credentials/:enrollmentId`)
   - Share presentation and save to cloud (`/api/presentations`)
   - Anchor hash on chain
3. Verifier page:
   - Enter code
   - Fetch presentation via `/api/presentations/:code`
   - Verify signature + anchor + role separation + ZKP

## 6) Biometric auth notes
- Browser WebAuthn biometric gating is enabled via UI buttons.
- Current implementation is client-side challenge verification for speed.
- For high-security production, move WebAuthn attestation/assertion verification to backend (e.g. SimpleWebAuthn server).
