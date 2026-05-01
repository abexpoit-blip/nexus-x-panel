import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { NexusLogo, APP_VERSION } from "@/components/NexusLogo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, LogIn, ArrowRight, ShieldCheck, Zap, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const loggedInUser = await login(username, password);
    setLoading(false);
    if (!loggedInUser) {
      setError("Invalid username or password");
      return;
    }
    if (loggedInUser.role === "admin") {
      setError("Admins must sign in via the admin portal");
      return;
    }
    navigate("/agent/dashboard");
  };

  return (
    <div className="min-h-screen bg-luxe-mesh relative overflow-hidden">
      {/* Ambient floating orbs */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full bg-neon-cyan/[0.10] blur-[140px] animate-float-slow" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[640px] h-[640px] rounded-full bg-neon-violet/[0.12] blur-[140px] animate-float-slow" style={{ animationDelay: "4s" }} />
      <div className="pointer-events-none absolute top-1/3 right-1/4 w-[420px] h-[420px] rounded-full bg-neon-magenta/[0.08] blur-[120px] animate-float-slow" style={{ animationDelay: "8s" }} />

      {/* Subtle dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, hsl(0 0% 100% / 0.06) 1px, transparent 0)`,
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
        {/* LEFT — brand panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 xl:p-16 relative">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <NexusLogo size="md" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-xl"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.28em] font-semibold text-foreground/80 bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              SMS Operations · v2.0
            </span>
            <h1 className="mt-6 text-5xl xl:text-6xl font-display font-semibold leading-[1.05] tracking-[-0.03em] text-foreground">
              The operating system <br />
              for{" "}
              <span className="text-iridescent">premium SMS</span>
              <br />
              operations.
            </h1>
            <p className="mt-6 text-base xl:text-lg text-muted-foreground leading-relaxed max-w-lg">
              Real-time OTP delivery, agent performance, provider health and revenue analytics —
              engineered for teams that move at the speed of the network.
            </p>

            <div className="mt-10 grid grid-cols-3 gap-4 max-w-lg">
              {[
                { icon: Zap,        label: "Real-time",  detail: "Sub-second OTP" },
                { icon: ShieldCheck,label: "Enterprise", detail: "RBAC + audit"   },
                { icon: BarChart3,  label: "Insightful", detail: "Live analytics" },
              ].map((f, i) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.08, duration: 0.6 }}
                  className="glass-luxe p-4"
                >
                  <f.icon className="w-4 h-4 text-primary mb-2" />
                  <div className="text-xs font-semibold text-foreground">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{f.detail}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9 }}
            className="flex items-center justify-between text-[11px] font-mono text-muted-foreground/60"
          >
            <span>
              © {new Date().getFullYear()} Nexus X · Crafted by{" "}
              <span className="text-foreground/80 font-semibold">Dev Shovon</span>{" "}
              · Community Edition by{" "}
              <span className="text-primary/80 font-semibold">BasicTrick</span>
            </span>
            <span className="tracking-wider">{APP_VERSION}</span>
          </motion.div>
        </div>

        {/* RIGHT — sign-in card */}
        <div className="flex items-center justify-center p-6 sm:p-10 lg:p-12">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md"
          >
            {/* Mobile-only logo */}
            <div className="lg:hidden flex justify-center mb-8">
              <NexusLogo size="md" />
            </div>

            <div className="glass-luxe p-8 sm:p-10 relative">
              {/* Top hairline glow */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

              <div className="mb-8">
                <p className="text-[10px] uppercase tracking-[0.32em] text-primary font-semibold mb-3">
                  Welcome back
                </p>
                <h2 className="text-3xl font-display font-semibold tracking-tight text-foreground">
                  Sign in to your console
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Access your SMS operations dashboard.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Username
                  </label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="your.username"
                    className="bg-white/[0.03] border-white/[0.08] focus-visible:border-primary/60 focus-visible:ring-primary/20 h-12 text-sm placeholder:text-muted-foreground/40"
                    autoComplete="username"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="bg-white/[0.03] border-white/[0.08] focus-visible:border-primary/60 focus-visible:ring-primary/20 h-12 text-sm pr-11 placeholder:text-muted-foreground/40"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="px-3 py-2 rounded-lg bg-neon-red/10 border border-neon-red/20 text-sm text-neon-red font-medium"
                  >
                    {error}
                  </motion.div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-gradient-brand text-primary-foreground font-semibold hover:opacity-95 transition-all border-0 text-sm tracking-wide relative overflow-hidden group shadow-glow-cyan"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/15 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  ) : (
                    <>
                      <LogIn className="w-4 h-4 mr-2" />
                      Sign in
                      <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </form>

              <div className="mt-7 flex items-center gap-3">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">or</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <Link to="/register" className="block mt-5">
                <Button
                  variant="outline"
                  className="w-full h-11 bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.06] hover:border-primary/40 text-sm text-foreground/90"
                >
                  Request agent account
                </Button>
              </Link>

              <p className="mt-6 text-center text-[11px] text-muted-foreground/60 font-mono">
                Protected by enterprise-grade encryption
              </p>
            </div>

            <p className="lg:hidden text-center text-[10px] font-mono text-muted-foreground/50 mt-6 leading-relaxed">
              Nexus X {APP_VERSION}
              <br />
              Crafted by <span className="text-foreground/70">Dev Shovon</span> · Community by{" "}
              <span className="text-primary/70">BasicTrick</span>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Login;
