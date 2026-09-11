# Trackd Release Hold — v1.0.1 (Chrome Web Store)

Status: **HOLDING** — waiting on Google OAuth client Production review.

## Timeline
- 2026-09-10: OAuth client `203055523241-mbu3641iktfppqfo90nju506rjtgs29i.apps.googleusercontent.com`
  submitted for Google Production verification (bound to store extension ID
  `lenaajfmejfgdjjdepbcnpakmakcbkgc`).
- Google review window: ~4-6 weeks.

## What ships the moment Google approves the OAuth client
1. Upload `trackd-extension.zip` (v1.0.1) to the Chrome Web Store.
   - This package is key-free (correct for CWS submission).
   - Contains the version-fix: popup + analytics now read version from
     `chrome.runtime.getManifest().version` (no hardcoded v0.1.0).
   - Contains the correct OAuth client_id bound to the store ID.
2. Submit → review → ships as 1.0.1 to real users.

## Release package (in repo, key-free)
- `trackd-extension.zip` — v1.0.1, the file to upload to CWS.

## Testing-only (DO NOT ship to CWS)
- `trackd-extension-test-keyed.zip` — local test build with `key` so it runs
  under the store ID. A `key` field is rejected by the CWS; this is for local
  verification / recording Google's OAuth verification video only.
- `extension_test/` — same, extracted folder for Load-Unpacked.
- Keep the `key` out of any committed package; never submit a keyed zip.

## What was fixed
- OAuth connect failing on store build → root cause: extension-ID mismatch
  / OAuth client not bound to the store ID during testing. Resolved by binding
  the new client to `lenaajf...` and verifying a keyed test build loads under it.
- Wrong version string "v0.1.0" → hardcoded literal replaced with
  `getManifest().version` render.