---
name: Mediatel Portal
description: Mediatel SMS portal login + scrape architecture (CF-protected)
type: reference
---
# Mediatel Portal (mediateluk.com)

**Login URL:** https://mediateluk.com/sms/index.php
**Base URL (settings):** https://mediateluk.com/sms
**Username:** 2673
**Password:** shahriya9900

**Protection:** Cloudflare "Just a moment..." managed challenge.
**Bypass:** puppeteer-extra + stealth plugin + persistent cookie jar in DB
(cookies saved as setting `mediatel_cookies`, restored on every restart so
cf_clearance is reused for ~24h).

**Bot file:** backend/workers/mediatelBot.js
**Settings keys (DB):**
- mediatel_enabled (true/false)
- mediatel_base_url
- mediatel_username
- mediatel_password
- mediatel_otp_interval (sec, min 5, default 8)
- mediatel_cookies (JSON array, managed by bot)

**Phase status:**
- Phase A: login + persist session + log post-login DOM (DONE)
- Phase B: CDR scrape selectors — pending real DOM logs from VPS
