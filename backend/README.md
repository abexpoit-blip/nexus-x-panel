# NexusX Backend

Self-contained Node.js + Express + SQLite backend for the NexusX SMS/OTP platform.
**No external services required** — runs on any VPS with Node.js 18+.

---

## 🚀 Quick start (local development)

```bash
cd backend
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD, JWT_SECRET, CORS_ORIGIN, and provider credentials
npm install
npm start
```

Server will start on `http://localhost:4000`. Default admin: `admin / admin123` (change in `.env`!).

---

## 📦 Deploy to VPS (Ubuntu 22.04)

### 1. Install Node.js 20 + pm2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Upload backend folder

```bash
scp -r backend/ user@YOUR_VPS_IP:/var/www/nexus-backend/
ssh user@YOUR_VPS_IP
cd /var/www/nexus-backend
```

### 3. Configure & install

```bash
cp .env.example .env
nano .env                       # set ALL real values: passwords, JWT_SECRET, CORS_ORIGIN
npm install --omit=dev
mkdir -p data
```

### 4. Start with pm2

```bash
pm2 start server.js --name nexus-api
pm2 save
pm2 startup                     # follow the printed command
```

Backend now runs on `localhost:4000` permanently. Logs: `pm2 logs nexus-api`.

### 5. nginx reverse proxy + SSL

```nginx
# /etc/nginx/sites-available/api.yourdomain.com
server {
  listen 80;
  server_name api.yourdomain.com;
  location / {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api.yourdomain.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
```

### 6. Frontend env

In your frontend repo, set:
```
VITE_API_URL=https://api.yourdomain.com/api
```
Then `npm run build` and serve `dist/` via nginx on `yourdomain.com`.

---

## 🗂 Folder layout

```
backend/
├── server.js              # entry point
├── db/
│   ├── schema.sql         # all tables
│   └── init.js            # auto-runs on boot
├── data/nexus.db          # SQLite file (auto-created)
├── lib/
│   ├── db.js              # singleton connection
│   ├── audit.js           # audit logger
│   └── commission.js      # agent payout calc
├── middleware/auth.js     # JWT verify + role check
├── routes/                # all API endpoints
└── workers/               # Seven1Tel bot + fake OTP broadcaster
```

---

## 🔌 Provider integration

### Seven1Tel
Seven1Tel uses an axios + cookie scraper for the `/ints` panel, so no Chromium/Puppeteer process is required.

Set in `.env` or from Admin → Settings → Bots:
```
SEVEN1TEL_ENABLED=false
SEVEN1TEL_BASE_URL=http://94.23.120.156/ints
SEVEN1TEL_USERNAME=
SEVEN1TEL_PASSWORD=
SEVEN1TEL_OTP_INTERVAL=4
```

Live bot logs: `pm2 logs nexus-backend | grep seven1tel`

---

## 💰 Agent payout flow

1. Admin sets a Rate in Rate Card: `provider`, `country_code`, `operator`, `price_bdt` (your cost), `agent_commission_percent`.
2. When an OTP arrives from the provider bot:
   - CDR row inserted (status `billed`, amount = `price_bdt * commission% / 100`)
   - Agent's `balance` increased by that amount
   - `payments` row written (`type: credit`, `method: auto`)
   - Notification sent to agent

---

## 💾 Backup

```bash
# Daily backup cron
0 3 * * * cp /var/www/nexus-backend/data/nexus.db /var/backups/nexus-$(date +\%F).db
```

---

## 🛠 Useful commands

```bash
pm2 logs nexus-backend          # live logs
pm2 restart nexus-backend       # restart after .env change
pm2 monit                       # CPU / memory
sqlite3 data/nexus.db           # interactive DB shell
```
