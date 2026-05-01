---
name: XISORA Portal
description: XISORA SMS portal (94.23.31.29/sms) login + captcha behavior probe results
type: reference
---
# XISORA SMS Portal

**Base URL:** http://94.23.31.29/sms
**Login URL:** http://94.23.31.29/sms/SignIn
**Login POST:** http://94.23.31.29/sms/signmein
**Form fields:** `username`, `password`, `capt`
**Session cookie:** `PHPSESSID`
**Test creds:** mamun33 / mamun@12aa

## Protection
- Plain Apache, no Cloudflare, no CSRF token.
- 5-char image captcha at `/sms/captcha.php?rand=x` — bound to the requester's PHPSESSID.
- Italic distorted font, alphanumeric (e.g. N5SO6, SKH8E). Tesseract-hostile but workable with retry.

## Behavior verified 2026-05-01
- Pasted PHPSESSID alone → 302 redirect to /SignIn (cookie expires fast or invalid without successful signmein).
- Captcha is mandatory on every login POST; cannot pre-solve.

## Two viable bot architectures
1. **Cookie-only manual:** user logs in via real browser, copies post-login PHPSESSID into Settings.
2. **OCR auto-login:** bot fetches captcha.php with same PHPSESSID, solves with tesseract, POSTs signmein, retries on fail. Requires `tesseract-ocr` on VPS.

**Status:** not yet wired into a worker. To replace the slot Mediatel left in src/pages/admin/Settings.tsx Bots tab and backend/routes/provider-ranges.js ALLOWED_PROVIDERS.
