import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { NexusLogo, APP_VERSION } from "@/components/NexusLogo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, ShieldCheck, Lock, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { PlexusBackground } from "@/components/PlexusBackground";

const AdminLogin = () => {
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
      setError("Invalid credentials");
      return;
    }
    if (loggedInUser.role !== "admin") {
      setError("This portal is for administrators only");
      return;
    }
    navigate("/admin/dashboard");
  };

  return (
    <div className="min-h-screen bg-luxe-mesh relative overflow-hidden flex items-center justify-center px-4 py-10">
    <PlexusBackground hue={270} />
      <div className="pointer-events-none absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full bg-neon-violet/[0.14] blur-[140px] animate-float-slow" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[640px] h-[640px] rounded-full bg-neon-magenta/[0.12] blur-[140px] animate-float-slow" style={{ animationDelay: "4s" }} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, hsl(0 0% 100% / 0.06) 1px, transparent 0)`,
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="flex justify-center mb-8">
          <NexusLogo size="md" showVersion />
        </div>

        <div className="glass-luxe p-8 sm:p-10 relative">
          <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-neon-violet/60 to-transparent" />

          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon-violet/10 border border-neon-violet/30 mb-4">
              <ShieldCheck className="w-3 h-3 text-neon-violet" />
              <span className="text-[10px] uppercase tracking-[0.28em] text-neon-violet font-semibold">
                Admin · Restricted
              </span>
            </div>
            <h2 className="text-2xl font-display font-semibold tracking-tight text-foreground">
              Control panel access
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Authorized personnel only. All actions are audited.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Admin Username
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="off"
                className="bg-white/[0.03] border-white/[0.08] focus-visible:border-neon-violet/60 focus-visible:ring-neon-violet/20 h-12 text-sm"
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
                  autoComplete="off"
                  className="bg-white/[0.03] border-white/[0.08] focus-visible:border-neon-violet/60 focus-visible:ring-neon-violet/20 h-12 text-sm pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
              className="w-full h-12 bg-gradient-to-r from-neon-violet via-neon-violet to-neon-magenta text-primary-foreground font-semibold hover:opacity-95 border-0 text-sm tracking-wide relative overflow-hidden group shadow-glow-violet"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/15 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
              {loading ? (
                <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  Access Control Panel
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] text-muted-foreground/60 font-mono leading-relaxed">
            Secure admin gateway · Nexus X {APP_VERSION}
            <br />
            Crafted by <span className="text-foreground/70">Dev Shovon</span> · Community by{" "}
            <span className="text-primary/70">BasicTrick</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminLogin;
