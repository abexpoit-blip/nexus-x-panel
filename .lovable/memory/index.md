# Project Memory

## Core
ALWAYS provide deploy + log-check command after every backend code change. User runs on VPS at /opt/nexus — standard deploy is `bash deploy.sh`.
IMS bot rate-limit: 15s minimum between any interactive action on imssms.org CDR page.
MSI bot: NO rate-limit needed (instant), 3–5s scrape interval is fine.
Mediatel sits behind Cloudflare — use puppeteer-extra+stealth and persist cookies in DB (`mediatel_cookies` setting) so cf_clearance is reused.

## Memories
- [IMS Portal](mem://reference/ims-portal) — Login creds + scrape flow rules for imssms.org
- [MSI Portal](mem://reference/msi-portal) — Login creds + page URLs + msiBot architecture for 145.239.130.45/ints
- [NumPanel Portal](mem://reference/numpanel-portal) — Login + REST CDR API + Self Allocation REQUEST flow for 51.89.99.105
- [Mediatel Portal](mem://reference/mediatel-portal) — Login creds + CF-bypass arch for mediateluk.com/sms
