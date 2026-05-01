# Project Memory

## Core
ALWAYS provide deploy + log-check command after every backend code change. User runs on VPS at /opt/nexus/nexus-x-panel — standard deploy is `bash deploy.sh`.
Production domain: nexus-x.site (frontend) + api.nexus-x.site (backend). Frontend `BASE` in src/lib/api.ts is hardcoded to https://api.nexus-x.site/api.
Active providers ONLY: Seven1Tel (lightweight axios on /ints panel). Mediatel was fully purged 2026-05-01 — DO NOT re-add. XISORA (94.23.31.29/sms) is the next provider to wire in.
Seven1Tel settings UI lives in Settings → Bots tab; allowed providers list in backend/routes/provider-ranges.js is `['seven1tel']`.

## Memories
- [Seven1Tel Portal](mem://reference/seven1tel-portal) — Login creds + /ints panel scrape flow for 94.23.120.156
- [XISORA Portal](mem://reference/xisora-portal) — XISORA SMS portal (94.23.31.29/sms): form fields, captcha behavior, login probe results
