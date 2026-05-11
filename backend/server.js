// NexusX Backend — Express + SQLite
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// Ensure DB exists & schema applied + admin seeded
require('./db/init');

const app = express();

// Trust proxy (nginx) so req.ip is the real client IP
app.set('trust proxy', 1);

// Security headers (helmet)
app.use(helmet({
  contentSecurityPolicy: false,             // SPA + external CDNs — handled by nginx
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS — explicit allow-list in production
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : null;

if (process.env.NODE_ENV === 'production' && !corsOrigins) {
  console.error('FATAL: CORS_ORIGIN env var required in production (comma-separated origins).');
  process.exit(1);
}

app.use(cors({
  // When credentials:true the browser requires an explicit origin (no '*'),
  // so in dev we reflect the request origin instead of using `true`.
  origin: corsOrigins || ((origin, cb) => cb(null, origin || true)),
  credentials: true,
}));

app.use(cookieParser());                     // read httpOnly auth cookie
app.use(express.json({ limit: '256kb' }));   // tighter body cap

// HTTP logs — production: only errors/4xx/5xx + skip noisy polling endpoints.
// Dev: full 'dev' format.
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('tiny', {
    skip: (req, res) => {
      // skip 2xx/3xx (success/redirect) — keep only errors
      if (res.statusCode < 400) return true;
      return false;
    },
  }));
} else {
  app.use(morgan('dev', {
    skip: (req) => {
      // even in dev, mute the loudest pollers
      const url = req.originalUrl || req.url || '';
      return /^\/api\/(notifications|health)(\?|$)/.test(url);
    },
  }));
}

// Global rate limiter
app.use('/api', rateLimit({
  windowMs: +(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: +(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
}));

// Strict limiter on auth endpoints (brute force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,                    // 15 minutes
  max: 10,                                  // 10 login/register attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,             // only count failures
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Health — MUST be registered BEFORE the security catch-all router (which
// mounts `router.use(authRequired, adminOnly)` on `/api`). Otherwise unauth
// callers (smoke tests, uptime probes) get 401 here.
app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/numbers', require('./routes/numbers'));
app.use('/api/rates', require('./routes/rates'));
app.use('/api/cdr', require('./routes/cdr'));
app.use('/api', require('./routes/payments'));            // /payments + /withdrawals
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api', require('./routes/provider-ranges'));     // /admin/provider-ranges + /numbers/v2/*
app.use('/api', require('./routes/services'));            // /services + /admin/services
// IMPORTANT: security must be mounted LAST among '/api' catchalls because it uses
// `router.use(authRequired, adminOnly)` globally — any unmatched /api/* request
// that falls into this router gets blocked with 403 before later routers can match.
app.use('/api', require('./routes/security'));            // /audit + /sessions + /settings

// 404
app.use('/api', (_, res) => res.status(404).json({ error: 'Not found' }));

// Error handler — never leak stack traces in production
app.use((err, req, res, next) => {
  console.error(err);
  const safeMsg = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(err.status || 500).json({ error: safeMsg });
});

const PORT = +(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`\n🚀 NexusX backend listening on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS origin: ${corsOrigins ? corsOrigins.join(', ') : '(allow all — dev only)'}\n`);

  // Start Seven1Tel bot (no-op if seven1tel_enabled=false)
  try { require('./workers/seven1telBot').start(); }
  catch (e) { console.warn('seven1tel bot start error:', e.message); }

  // Start SMS Hadi bot (no-op if smshadi_enabled=false)
  try { require('./workers/smshadiBot').start(); }
  catch (e) { console.warn('smshadi bot start error:', e.message); }

  // Start XISORA bot (no-op if xisora_enabled=false or token missing)
  try { require('./workers/xisoraBot').start(); }
  catch (e) { console.warn('xisora bot start error:', e.message); }

  // Start IMS bot (no-op if ims_enabled=false)
  try { require('./workers/imsBot').start(); }
  catch (e) { console.warn('ims bot start error:', e.message); }

  // Start IMS-2 bot (second imssms.org account; no-op if ims2_enabled=false)
  try { require('./workers/imsBot2').start(); }
  catch (e) { console.warn('ims2 bot start error:', e.message); }

  // Start IPRN bot (no-op if iprn_enabled=false)
  try { require('./workers/iprnBot').start(); }
  catch (e) { console.warn('iprn bot start error:', e.message); }

  // Start Fake OTP broadcaster (idles until fake_otp_enabled=true)
  try { require('./workers/fakeOtpBroadcaster').start(); }
  catch (e) { console.warn('fake-otp broadcaster start error:', e.message); }

  // Allocation expiry sweeper — frees stale active allocations after otp_expiry_sec
  try { require('./workers/allocationExpiry').start(); }
  catch (e) { console.warn('allocation expiry start error:', e.message); }

  // Range Health + Auto-pause sweeper (1-min interval, opt-in via settings)
  try { require('./workers/rangeHealth').start(); }
  catch (e) { console.warn('range health start error:', e.message); }
});
