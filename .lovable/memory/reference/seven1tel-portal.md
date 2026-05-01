---
name: Seven1Tel Portal
description: Login + scrape flow for the "ints" panel at 94.23.120.156 — seven1telBot architecture
type: reference
---
# Seven1Tel (http://94.23.120.156/ints)

Credentials: Sayedahmed / Rumon1275
No Cloudflare, no captcha for agent role. Plain PHP "ints" panel
(same software family as old MSI 145.239.130.45/ints).

## Pages
- `GET  /ints/login`              — login form
- `POST /ints/signin`             — submits username/password (form-urlencoded). Falls back to `/signin.php` on 404.
- `GET  /ints/agent`              — dashboard (used as "logged in?" probe)
- `GET  /ints/agent/SMSCDRStats`  — CDR DataTable page (HTML)
- `GET  /ints/res/data_smscdr.php?fdate1=Y-m-d H:i:s&fdate2=...&iDisplayLength=N`
         — AJAX endpoint returning `{ aaData: [[date, range, number, cli, msg], ...] }`

## Bot architecture (`backend/workers/seven1telBot.js`)
- Pure axios + tough-cookie. NO puppeteer (saves ~150MB RAM vs Mediatel).
- Login persists `PHPSESSID` to DB setting `seven1tel_session_cookie` for fast restart.
- Polls `data_smscdr.php` every `seven1tel_otp_interval` sec (default 4, min 3).
- Matches incoming SMS phone → active allocation by **last-9-digit suffix**
  (so "+44…" vs "44…" is irrelevant), then calls `markOtpReceived()`.
- In-process `_seenIds` set (5k cap) de-dupes overlapping 10-min poll windows.
- Backoff escalates on consecutive fails: 5 + (consec_fail × 2) sec, capped at 60s.

## DB settings (override .env)
- `seven1tel_enabled`            true|false
- `seven1tel_base_url`           http://94.23.120.156/ints
- `seven1tel_username`           Sayedahmed
- `seven1tel_password`           Rumon1275
- `seven1tel_otp_interval`       4
- `seven1tel_session_cookie`     (auto-saved)

## Rate-limit
NONE needed — agent role on /ints panels has no per-IP throttle. 3-5s scrape interval is safe.
If `cdr_session_lost` errors appear, login is auto-retried on next tick.