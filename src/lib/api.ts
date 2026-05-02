// API client for nexus-backend

const BASE = (import.meta.env.VITE_API_URL as string) || "https://api.nexus-x.site/api";
const TOKEN_KEY = "nexus_token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  let token = tokenStore.get();

  // Auto-clean stale demo tokens (legacy from preview/dev). Demo mode is fully off in production.
  if (token && token.startsWith("demo_")) {
    tokenStore.clear();
    localStorage.removeItem("nexus_demo_mode");
    token = null;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: "include",                    // ← send/receive httpOnly cookie
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed: ${res.status}`);
  return data as T;
}

export type Agent = {
  id: number; username: string; role: string; balance: number; otp_count: number;
  daily_limit: number; per_request_limit: number; status: string;
  telegram?: string; phone?: string; full_name?: string; created_at: number;
};
export type Allocation = {
  id: number; user_id: number; username?: string; provider: string;
  country_code?: string; operator?: string; phone_number: string;
  otp?: string | null; status: string; allocated_at: number; otp_received_at?: number;
};
export type Rate = {
  id: number; provider: string; country_code?: string; country_name?: string;
  operator?: string; price_bdt: number; agent_commission_percent?: number;
  active: number; updated_at: number;
};
export type CDR = {
  id: number; user_id: number; username?: string; provider: string;
  country_code?: string; operator?: string; phone_number: string; otp_code?: string;
  cli?: string | null;
  price_bdt: number; status: string; note?: string; created_at: number;
};
export type Payment = {
  id: number; user_id: number; username?: string; amount_bdt: number;
  type: string; method?: string; reference?: string; note?: string; created_at: number;
};
export type Withdrawal = {
  id: number; user_id: number; username?: string; amount_bdt: number;
  method: string; account_name?: string; account_number: string;
  status: "pending" | "approved" | "rejected"; note?: string;
  admin_note?: string; reviewed_by?: number; reviewed_at?: number;
  processed_at?: number;
  created_at: number;
};
export type Notification = {
  id: number; user_id: number | null; title: string; message: string;
  type: string; is_read: number; created_at: number;
};
export type AuditLog = {
  id: number; user_id: number | null; username?: string; action: string;
  target_type?: string; target_id?: string | number; meta?: string;
  ip?: string; user_agent?: string; created_at: number;
};
export type Session = {
  id: number; user_id: number; username?: string; ip: string;
  user_agent: string; device?: string; browser?: string;
  created_at: number; last_seen_at: number; current?: boolean;
};
export type ProviderRange = {
  id: number;
  provider: string;
  country_code: string;
  country_name?: string | null;
  range_label: string;
  range_prefix?: string | null;
  operator?: string | null;
  price_bdt: number;
  enabled?: 0 | 1 | boolean;
  hot?: 0 | 1 | boolean;
  free_count?: number;
  notes?: string | null;
  created_at?: number;
  updated_at?: number;
};

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ token: string; user: any }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (body: { username: string; password: string; full_name?: string; phone?: string; telegram?: string }) =>
    request<{ pending?: boolean; message?: string; token?: string; user?: any }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<{ user: any; impersonator?: { id: number; username: string } | null }>("/auth/me"),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  exitImpersonation: () =>
    request<{ token: string; user: any }>("/auth/exit-impersonation", { method: "POST" }),
  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean; message: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  // Numbers
  providers: () => request<{ providers: { id: string; name: string }[] }>("/numbers/providers"),
  numbersConfig: () => request<{ otp_expiry_sec: number; server_now: number }>("/numbers/config"),
  countries: (provider: string) => request<{ countries: any[] }>(`/numbers/countries/${provider}`),
  operators: (provider: string, countryId: number) =>
    request<{ operators: any[] }>(`/numbers/operators/${provider}/${countryId}`),
  getNumber: (body: { range_id?: number; provider?: string; country_id?: number; operator_id?: number; country_code?: string; operator?: string; range?: string; count?: number }) =>
    request<{ allocated: any[]; errors: string[] }>("/numbers/get", { method: "POST", body: JSON.stringify(body) }),
  myNumbers: () => request<{ numbers: Allocation[]; recent_window_hours?: number; otp_expiry_sec?: number; server_now?: number }>("/numbers/my"),
  numberHistory: (params: {
    page?: number; page_size?: number; q?: string; from?: string; to?: string;
    status?: string;       // comma-separated: billed,refunded
    countries?: string;    // comma-separated country codes
    operators?: string;    // comma-separated operator names
    facets?: boolean;      // include distinct country/operator lists
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.page_size) qs.set("page_size", String(params.page_size));
    if (params.q) qs.set("q", params.q);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.status) qs.set("status", params.status);
    if (params.countries) qs.set("countries", params.countries);
    if (params.operators) qs.set("operators", params.operators);
    if (params.facets) qs.set("facets", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      rows: Array<{
        id: number; allocation_id: number | null; country_code: string | null;
        operator: string | null; phone_number: string; otp_code: string;
        cli: string | null; status?: string;
        price_bdt: number; created_at: number;
      }>;
      page: number; page_size: number; total: number; total_pages: number;
      summary: { count: number; earnings_bdt: number };
      facets?: {
        countries: Array<{ value: string; count: number }>;
        operators: Array<{ value: string; count: number }>;
      };
    }>(`/numbers/history${suffix}`);
  },
  // CSV export — fetches with auth header, triggers browser download via Blob URL.
  // Returns the row count downloaded so the UI can toast it.
  numberHistoryCsv: async (params: {
    q?: string; from?: string; to?: string;
    status?: string; countries?: string; operators?: string;
  } = {}) => {
    const qs = new URLSearchParams({ format: "csv" });
    if (params.q) qs.set("q", params.q);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.status) qs.set("status", params.status);
    if (params.countries) qs.set("countries", params.countries);
    if (params.operators) qs.set("operators", params.operators);
    const token = tokenStore.get();
    const res = await fetch(`${BASE}/numbers/history?${qs.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`CSV export failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `otp-history-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // Each non-empty line is one Number|OTP record (no header row anymore)
    const text = await blob.text();
    const lines = text.split("\n").filter(Boolean).length;
    return { rows: Math.max(0, lines) };
  },
  releaseNumber: (id: number) => request(`/numbers/release/${id}`, { method: "POST" }),
  numberSummary: () => request<{
    today: { c: number; s: number };
    week: { c: number; s: number };
    month: { c: number; s: number };
    active: number;
    wait_time?: {
      today: WaitStat; week: WaitStat; month: WaitStat; all_time: WaitStat;
    };
  }>("/numbers/summary"),
  syncOtp: () => request<{ updated: number }>("/numbers/sync", { method: "POST" }),
  pricing: () => request<{ pricing: { id: number; name: string; code: string; flag: string; price_bdt: number; operator_count: number }[] }>("/numbers/pricing"),

  // Rates
  rates: {
    list: () => request<{ rates: Rate[] }>("/rates"),
    create: (body: Partial<Rate>) => request<{ id: number }>("/rates", { method: "POST", body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Rate>) => request(`/rates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: number) => request(`/rates/${id}`, { method: "DELETE" }),
  },

  // CDR
  cdr: {
    mine: () => request<{ cdr: CDR[] }>("/cdr/mine"),
    all: () => request<{ cdr: CDR[] }>("/cdr"),
    feed: () => request<{ feed: Array<{
      id: number; phone_masked: string; otp_length: number;
      operator: string | null; country_code: string | null;
      cli: string | null;
      provider: string | null; created_at: number;
    }> }>("/cdr/feed"),
    refund: (id: number, note?: string) => request(`/cdr/${id}/refund`, { method: "POST", body: JSON.stringify({ note }) }),
  },

  // Payments
  payments: {
    mine: () => request<{ payments: Payment[] }>("/payments/mine"),
    all: () => request<{ payments: Payment[] }>("/payments"),
    topup: (body: { user_id: number; amount_bdt: number; method?: string; reference?: string; note?: string }) =>
      request("/payments/topup", { method: "POST", body: JSON.stringify(body) }),
  },

  // Withdrawals (Phase 3 — Revenue auto-engine)
  withdrawals: {
    policy: () => request<{
      min_amount: number; fee_percent: number; sla_hours: number;
      methods?: Record<string, boolean>; methods_enabled?: string[];
    }>("/withdrawals/policy"),
    mine: () => request<{ withdrawals: Withdrawal[] }>("/withdrawals/mine"),
    pending: () => request<{ withdrawals: Withdrawal[] }>("/withdrawals/pending"),
    all: (status?: string) => request<{ withdrawals: Withdrawal[] }>(`/withdrawals${status ? `?status=${status}` : ""}`),
    request: (body: { amount_bdt: number; method: string; account_name?: string; account_number: string; note?: string }) =>
      request<{ id: number; fee: number; net: number }>("/withdrawals/request", { method: "POST", body: JSON.stringify(body) }),
    approve: (id: number, admin_note?: string) =>
      request(`/withdrawals/${id}/approve`, { method: "POST", body: JSON.stringify({ admin_note }) }),
    reject: (id: number, admin_note?: string) =>
      request(`/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ admin_note }) }),
    config: () => request<PaymentConfig>("/admin/payment-config"),
    saveConfig: (body: Partial<PaymentConfig>) =>
      request<PaymentConfig>("/admin/payment-config", { method: "PUT", body: JSON.stringify(body) }),
  },

  // Notifications
  notifications: {
    list: () => request<{ notifications: Notification[]; unread: number }>("/notifications"),
    markRead: (id: number) => request(`/notifications/${id}/read`, { method: "POST" }),
    markAllRead: () => request("/notifications/read-all", { method: "POST" }),
    broadcast: (body: { title: string; message: string; type?: string; user_id?: number | null }) =>
      request("/notifications/broadcast", { method: "POST", body: JSON.stringify(body) }),
  },

  // Public leaderboard (any authenticated user)
  leaderboard: (period: "today" | "7d" | "all" = "today") =>
    request<{
      leaderboard: { id: number; username: string; otp_count: number; numbers_used?: number; earnings_bdt?: number }[];
      period: string;
    }>(`/leaderboard?period=${period}`),

  // Audit Logs (Phase 4 — Enterprise security)
  audit: {
    list: (params?: { limit?: number; user_id?: number; action?: string }) => {
      const q = new URLSearchParams();
      if (params?.limit) q.set("limit", String(params.limit));
      if (params?.user_id) q.set("user_id", String(params.user_id));
      if (params?.action) q.set("action", params.action);
      const qs = q.toString();
      return request<{ logs: AuditLog[] }>(`/audit${qs ? "?" + qs : ""}`);
    },
  },

  // Sessions (Phase 4 — active devices, remote logout)
  sessions: {
    mine: () => request<{ sessions: Session[] }>("/sessions/mine"),
    all: () => request<{ sessions: Session[] }>("/sessions"),
    revoke: (id: number) => request(`/sessions/${id}`, { method: "DELETE" }),
    revokeAllOthers: () => request(`/sessions/others`, { method: "DELETE" }),
  },
  settings: {
    getPublic: () => request<{ signup_enabled: boolean }>("/settings/public"),
    getAll: () => request<{ settings: Record<string, string> }>("/settings"),
    set: (key: string, value: string) => request(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  },

  // Admin
  admin: {
    agents: () => request<{ agents: Agent[] }>("/admin/agents"),
    createAgent: (body: any) => request<{ id: number }>("/admin/agents", { method: "POST", body: JSON.stringify(body) }),
    updateAgent: (id: number, body: any) => request(`/admin/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteAgent: (id: number) => request(`/admin/agents/${id}`, { method: "DELETE" }),
    approveAgent: (id: number) => request(`/admin/agents/${id}/approve`, { method: "POST" }),
    rejectAgent: (id: number) => request(`/admin/agents/${id}/reject`, { method: "POST" }),
    loginAs: (id: number) =>
      request<{ token: string; user: any; impersonator: { id: number; username: string } }>(
        `/admin/login-as/${id}`, { method: "POST" }
      ),
    impersonations: () => request<{
      impersonations: {
        id: number; created_at: number; action: string;
        admin_id: number | null; agent_id: number | null;
        admin_username?: string; agent_username?: string;
        ip?: string; meta?: string;
      }[];
    }>("/admin/impersonations"),
    stats: () => request<{
      totalAgents: number; activeAgents: number; totalAlloc: number; activeAlloc: number;
      totalOtp: number; todayOtp: number; todayRevenue: number; totalRevenue: number;
      todayCommission?: number; totalCommission?: number; pendingWithdrawals?: number;
    }>("/admin/stats"),
    leaderboard: () => request<{ leaderboard: { id: number; username: string; otp_count: number; numbers_used?: number; earnings_bdt?: number }[] }>("/admin/leaderboard"),
    commissionTrend: (days = 14) => request<{ series: { label: string; value: number; count: number }[] }>(`/admin/commission-trend?days=${days}`),
    allocations: () => request<{ allocations: Allocation[] }>("/admin/allocations"),
    // ---- Global provider settings ----
    systemHealth: () => request<SystemHealth>("/admin/system-health"),
    otpExpiry: () => request<{ expiry_min: number; source: string; options_min: number[] }>("/admin/otp-expiry"),
    otpExpirySave: (expiry_min: number) =>
      request<{ ok: boolean; expiry_min: number }>("/admin/otp-expiry", {
        method: "PUT", body: JSON.stringify({ expiry_min }),
      }),
    recentOtpWindow: () => request<{ hours: number; source: string; options_hours: number[] }>("/admin/recent-otp-window"),
    recentOtpWindowSave: (hours: number) =>
      request<{ ok: boolean; hours: number }>("/admin/recent-otp-window", {
        method: "PUT", body: JSON.stringify({ hours }),
      }),

    // ─── Generic provider ranges (provider-agnostic) ────────────────
    rangesList: (params: { provider?: string; country_code?: string; enabled?: 0 | 1 } = {}) => {
      const qs = new URLSearchParams();
      if (params.provider) qs.set("provider", params.provider);
      if (params.country_code) qs.set("country_code", params.country_code);
      if (params.enabled !== undefined) qs.set("enabled", String(params.enabled));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return request<{ rows: ProviderRange[] }>(`/admin/provider-ranges${suffix}`);
    },
    rangeCreate: (body: Partial<ProviderRange>) =>
      request<{ id: number }>("/admin/provider-ranges", { method: "POST", body: JSON.stringify(body) }),
    rangeUpdate: (id: number, body: Partial<ProviderRange>) =>
      request<{ ok: boolean }>(`/admin/provider-ranges/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    rangeDelete: (id: number) =>
      request<{ ok: boolean }>(`/admin/provider-ranges/${id}`, { method: "DELETE" }),
    rangeBulkToggle: (ids: number[], enabled: boolean) =>
      request<{ ok: boolean; updated: number }>("/admin/provider-ranges/bulk-toggle", {
        method: "POST", body: JSON.stringify({ ids, enabled }),
      }),

    // ─── Range pool numbers (manual MSISDN stock) ────────────────
    rangesStats: () =>
      request<{ stats: Record<string, {
        range_id: number; total: number;
        free_count: number; allocated_count: number; used_count: number;
        last_otp_at: number | null; last_allocated_at: number | null;
        total_otps: number;
      }> }>("/admin/provider-ranges-stats"),
    poolList: (rangeId: number, status?: "free" | "allocated" | "used") => {
      const qs = status ? `?status=${status}` : "";
      return request<{
        range: { id: number; provider: string; country_code: string; range_label: string };
        rows: Array<{
          id: number; msisdn: string; status: string;
          allocated_user_id: number | null; allocated_username: string | null;
          allocated_at: number | null; last_otp_at: number | null;
          otp_count: number; note: string | null; created_at: number;
        }>;
      }>(`/admin/provider-ranges/${rangeId}/pool${qs}`);
    },
    poolBulkAdd: (rangeId: number, numbers: string) =>
      request<{ ok: boolean; added: number; duplicates: number; total_tokens: number }>(
        `/admin/provider-ranges/${rangeId}/pool/bulk`,
        { method: "POST", body: JSON.stringify({ numbers }) }
      ),
    poolDelete: (id: number, force = false) =>
      request<{ ok: boolean }>(`/admin/pool-numbers/${id}${force ? "?force=1" : ""}`, { method: "DELETE" }),
    poolRelease: (id: number) =>
      request<{ ok: boolean }>(`/admin/pool-numbers/${id}/release`, { method: "POST" }),
    poolPurge: (rangeId: number, status: "free" | "used") =>
      request<{ ok: boolean; removed: number }>(
        `/admin/provider-ranges/${rangeId}/pool/purge?status=${status}`, { method: "POST" }
      ),

    // ─── Bots Control ─────────────────────────────────────────────
    bots: {
      list: () => request<{ bots: Record<string, BotInfo> }>("/admin/bots"),
      action: (bot: string, action: "start" | "stop" | "restart") =>
        request<{ ok: boolean; bot: string; action: string }>(`/admin/bots/${bot}/${action}`, { method: "POST" }),
      health: (bot: string) =>
        request<{ ok: boolean; bot: string; ms: number; error?: string; status?: Record<string, unknown> }>(
          `/admin/bots/${bot}/health`,
          { method: "POST" }
        ),
    },
  },

  // ===== Agent v2 ranges =====
  v2Countries: () => request<{ countries: Array<{ country_code: string; country_name: string; range_count: number }> }>("/numbers/v2/countries"),
  v2Ranges: (countryCode: string) =>
    request<{ ranges: ProviderRange[] }>(`/numbers/v2/ranges?country=${encodeURIComponent(countryCode)}`),

  // ===== Fake OTP Broadcaster (admin realism layer) =====
  fakeOtp: {
    get: () => request<{
      enabled: boolean;
      running: boolean;
      last_fire_at: number | null;
      total_fired: number;
      total_in_db: number;
      min_sec: number;
      max_sec: number;
      burst: number;
    }>("/admin/fake-otp"),
    save: (body: { enabled?: boolean; min_sec?: number; max_sec?: number; burst?: number }) =>
      request<{ ok: boolean }>("/admin/fake-otp", {
        method: "PUT", body: JSON.stringify(body),
      }),
    fireNow: () => request<{ ok: boolean }>("/admin/fake-otp/fire", { method: "POST" }),
    purge: () => request<{ ok: boolean; removed: number }>("/admin/fake-otp/purge", { method: "POST" }),
  },
};

export interface PaymentConfig {
  min_amount: number;
  fee_percent: number;
  sla_hours: number;
  methods: Record<string, boolean>;
  methods_enabled: string[];
  all_methods: string[];
}

export interface WaitStat {
  avg_sec: number;
  min_sec: number;
  max_sec: number;
  samples: number;
}

export interface SystemHealth {
  server: {
    uptime_sec: number;
    node_version: string;
    env: string;
    memory_mb: { rss: number; heap_used: number; heap_total: number };
    jwt?: { source: "env" | "settings" | "generated" | "unknown"; length: number; strong: boolean };
  };
  database: {
    size_bytes: number;
    size_mb: number;
    path: string;
    last_backup: { name: string; size: number; mtime: number } | null;
    backup_dir: string;
  };
  seven1tel_bot: ProviderBotStatus | null;
  xisora_bot: ProviderBotStatus | null;
  fake_otp_bot?: ProviderBotStatus | null;
  cdr_pulse?: { last_real_at: number | null; last_any_at: number | null; total_today: number };
  counts: {
    pending_withdrawals: number;
    active_sessions: number;
    active_allocations?: number;
  };
}

export interface ProviderBotStatus {
  enabled?: boolean;
  running?: boolean;
  logged_in?: boolean;
  base_url?: string;
  username?: string | null;
  last_tick_at?: number | null;
  last_error?: string | null;
  consec_fail?: number;
  otps_delivered?: number;
  interval_sec?: number;
  // Telemetry (added in v2.0)
  errors?: Array<{ at: number; message: string }>;
  last_login_at?: number | null;
  last_otp_at?: number | null;
  total_ticks?: number;
  total_login_attempts?: number;
  total_login_successes?: number;
  source?: string;
  portal_url?: string;
}

export interface BotInfo {
  key: string;
  label: string;
  description: string;
  status: (ProviderBotStatus & {
    total_fired?: number;
    last_fire_at?: number | null;
    min_sec?: number;
    max_sec?: number;
    burst?: number;
    error?: string;
  }) | null;
}
