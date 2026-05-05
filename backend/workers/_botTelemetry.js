// Lightweight per-bot telemetry: rolling error log + counters.
// Each bot creates one Telemetry instance and reports through it.

const RING_MAX = 20;
const EVENTS_MAX = 80;

class Telemetry {
  constructor() {
    this.errors = [];           // [{ at, message }]
    this.events = [];           // [{ at, level, type, message, phone? }] — failure-only ring for admin "Logs"
    this.lastLoginAt = null;    // unix sec
    this.lastOtpAt = null;      // unix sec — last OTP delivered through this bot
    this.totalTicks = 0;
    this.totalLoginAttempts = 0;
    this.totalLoginSuccesses = 0;
    this.totalMisses = 0;       // CDR rows whose phone had no active allocation
    this.totalDelivered = 0;    // OTPs successfully handed off to markOtpReceived
  }
  recordError(message) {
    this.errors.unshift({ at: Math.floor(Date.now() / 1000), message: String(message).slice(0, 240) });
    if (this.errors.length > RING_MAX) this.errors.length = RING_MAX;
    this.recordEvent('error', 'tick_error', String(message).slice(0, 240));
  }
  // Generic failure-only event recorder (used by /admin/bots/:bot/logs).
  // level: 'error' | 'warn' | 'miss'
  recordEvent(level, type, message, meta = {}) {
    this.events.unshift({
      at: Math.floor(Date.now() / 1000),
      level: String(level || 'error'),
      type: String(type || 'unknown'),
      message: String(message || '').slice(0, 300),
      ...meta,
    });
    if (this.events.length > EVENTS_MAX) this.events.length = EVENTS_MAX;
  }
  recordMiss(phone, reason = 'no active allocation') {
    this.totalMisses++;
    this.recordEvent('miss', 'no_active_alloc', `${phone}: ${reason}`, { phone });
  }
  recordTick() { this.totalTicks++; }
  recordLoginAttempt() { this.totalLoginAttempts++; }
  recordLoginSuccess() {
    this.totalLoginSuccesses++;
    this.lastLoginAt = Math.floor(Date.now() / 1000);
  }
  recordOtpDelivered() {
    this.lastOtpAt = Math.floor(Date.now() / 1000);
    this.totalDelivered++;
  }
  snapshot() {
    return {
      errors: this.errors,
      events: this.events,
      last_login_at: this.lastLoginAt,
      last_otp_at: this.lastOtpAt,
      total_ticks: this.totalTicks,
      total_login_attempts: this.totalLoginAttempts,
      total_login_successes: this.totalLoginSuccesses,
      total_misses: this.totalMisses,
      total_delivered: this.totalDelivered,
    };
  }
}

module.exports = { Telemetry };