# SERENOVA Deployment

## Required secrets

Set these in Firebase/Bitrise before deploying:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_TOKEN` or your CI Firebase service-account auth
- `VITE_AI_BACKEND_URL`
- `VITE_ADMIN_EMAILS`

Optional LLM settings for Cloud Functions:

- `OLLAMA_URL`
- `OLLAMA_MODEL`

## Local build

From `frontend-react`:

```bash
npm ci
npm run build
```

From `functions`:

```bash
npm install
```

## Firebase deploy

From the project root:

```bash
firebase deploy --project SERENOVA-ai
```

For legacy Firebase Functions config instead of environment variables:

```bash
firebase functions:config:set razorpay.key_id="rzp_live_xxx" razorpay.key_secret="xxx"
firebase deploy --only functions
```

## Bitrise

Use the `deploy` workflow in `bitrise.yml`. It installs frontend and function dependencies, builds Vite into `frontend-react/dist`, then deploys Hosting, Functions, Firestore rules, and Realtime Database rules.
