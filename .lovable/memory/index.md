# Project Memory

## Core
ALWAYS provide deploy + log-check command after every backend code change. User runs on VPS at /opt/nexus — standard deploy is `bash deploy.sh`.
Production domain: nexus-x.site (frontend) + api.nexus-x.site (backend). Frontend `BASE` in src/lib/api.ts is hardcoded to https://api.nexus-x.site/api.
Active providers ONLY: Mediatel (puppeteer+stealth, CF-protected) + Seven1Tel (lightweight axios on /ints panel). All other bots (IMS/MSI/NumPanel/AccHub/Telegram) were purged in fresh-build phase — DO NOT re-add unless user explicitly asks.
Mediatel sits behind Cloudflare — use puppeteer-extra+stealth and persist cookies in DB (`mediatel_cookies` setting) so cf_clearance is reused.

## Memories
- [Mediatel Portal](mem://reference/mediatel-portal) — Login creds + CF-bypass arch for mediateluk.com/sms
- [Seven1Tel Portal](mem://reference/seven1tel-portal) — Login creds + /ints panel scrape flow for 94.23.120.156
