// Lightweight per-bot telemetry: rolling error log + counters.
// Each bot creates one Telemetry instance and reports through it.

const RING_MAX = 20;

class Telemetry {
  constructor() {
    this.errors = [];           // [{ at, message }]
    this.lastLoginAt = null;    // unix sec
    this.lastOtpAt = null;      // unix sec — last OTP delivered through this bot
    this.totalTicks = 0;
    this.totalLoginAttempts = 0;
    this.totalLoginSuccesses = 0;
  }
  recordError(message) {
    this.errors.unshift({ at: Math.floor(Date.now() / 1000), message: String(message).slice(0, 240) });
    if (this.errors.length > RING_MAX) this.errors.length = RING_MAX;
  }
  recordTick() { this.totalTicks++; }
  recordLoginAttempt() { this.totalLoginAttempts++; }
  recordLoginSuccess() {
    this.totalLoginSuccesses++;
    this.lastLoginAt = Math.floor(Date.now() / 1000);
  }
  recordOtpDelivered() { this.lastOtpAt = Math.floor(Date.now() / 1000); }
  snapshot() {
    return {
      errors: this.errors,
      last_login_at: this.lastLoginAt,
      last_otp_at: this.lastOtpAt,
      total_ticks: this.totalTicks,
      total_login_attempts: this.totalLoginAttempts,
      total_login_successes: this.totalLoginSuccesses,
    };
  }
}

module.exports = { Telemetry };