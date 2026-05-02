import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { NexusLogo, APP_VERSION } from "@/components/NexusLogo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, UserPlus, ShieldX, User, Phone, Send, Lock, AtSign, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { PlexusBackground } from "@/components/PlexusBackground";

const Register = () => {
  const [form, setForm] = useState({
    name: "",
    username: "",
    telegram: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch real signup_enabled flag from backend
    api.settings.getPublic()
      .then((s) => setSignupEnabled(!!s.signup_enabled))
      .catch(() => setSignupEnabled(true)); // fallback open
  }, []);

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signupEnabled) return;

    if (form.password !== form.confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (form.password.length < 5) {
      toast({ title: "Error", description: "Password must be at least 5 characters", variant: "destructive" });
      return;
    }
    if (!form.telegram.startsWith("@")) {
      toast({ title: "Error", description: "Telegram username must start with @", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      await api.register({
        username: form.username,
        password: form.password,
        full_name: form.name,
        phone: form.phone,
        telegram: form.telegram,
      });
      toast({
        title: "Registration Submitted!",
        description: "Your account is pending admin approval. You'll be notified once approved.",
      });
      navigate("/login");
    } catch (err: any) {
      toast({ title: "Registration failed", description: err?.message || "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-luxe-mesh relative overflow-hidden flex items-center justify-center px-4 py-10">
      <PlexusBackground />
      <div className="pointer-events-none absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full bg-neon-cyan/[0.10] blur-[140px] animate-float-slow" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[640px] h-[640px] rounded-full bg-neon-violet/[0.12] blur-[140px] animate-float-slow" style={{ animationDelay: "4s" }} />
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
        className="relative z-10 w-full max-w-lg"
      >
        <div className="flex justify-center mb-8">
          <NexusLogo size="md" />
        </div>

        <div className="glass-luxe p-8 sm:p-10 relative">
          <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

          <div className="mb-8 text-center">
            <p className="text-[10px] uppercase tracking-[0.32em] text-primary font-semibold mb-3">
              New agent
            </p>
            <h2 className="text-2xl font-display font-semibold tracking-tight text-foreground">
              Request your account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Submit your details — admin will approve and activate.
            </p>
          </div>

          {!signupEnabled ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-12 space-y-4"
            >
              <div className="w-20 h-20 mx-auto rounded-2xl bg-neon-red/10 flex items-center justify-center">
                <ShieldX className="w-10 h-10 text-neon-red" />
              </div>
              <h3 className="text-xl font-display font-bold text-foreground">Registration Closed</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                New account registration is currently disabled by the administrator. Please check back later or contact support.
              </p>
              <Link to="/login">
                <Button variant="outline" className="mt-4 bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.06]">
                  Back to Login
                </Button>
              </Link>
            </motion.div>
          ) : (
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <User className="w-3 h-3" /> Full Name
                  </label>
                  <Input
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Your full name"
                    className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <AtSign className="w-3 h-3" /> Username
                  </label>
                  <Input
                    value={form.username}
                    onChange={(e) => update("username", e.target.value)}
                    placeholder="Choose a username"
                    className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Send className="w-3 h-3" /> Telegram
                  </label>
                  <Input
                    value={form.telegram}
                    onChange={(e) => update("telegram", e.target.value)}
                    placeholder="@your_telegram"
                    className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3 h-3" /> Phone Number
                  </label>
                  <Input
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder="+880..."
                    className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Lock className="w-3 h-3" /> Password
                  </label>
                  <div className="relative">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                      placeholder="Min 6 characters"
                      className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Lock className="w-3 h-3" /> Confirm Password
                  </label>
                  <Input
                    type={showPw ? "text" : "password"}
                    value={form.confirmPassword}
                    onChange={(e) => update("confirmPassword", e.target.value)}
                    placeholder="Re-enter password"
                    className="bg-white/[0.04] border-white/[0.08] focus:border-primary/50 h-11 text-sm"
                    required
                  />
                </div>
              </div>

              <div className="pt-2">
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
                      <UserPlus className="w-4 h-4 mr-2" />
                      Create Account
                      <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground/60 text-center">
                By registering, your account will be reviewed and approved by an admin before activation.
              </p>
            </motion.form>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-5 text-center"
          >
            <p className="text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:text-primary/80 font-semibold transition-colors">
                Sign In
              </Link>
            </p>
          </motion.div>

          <p className="mt-6 text-center text-[11px] text-muted-foreground/60 font-mono leading-relaxed">
            Nexus X {APP_VERSION}
            <br />
            Crafted by <span className="text-foreground/70">Dev Shovon</span> · Community by{" "}
            <span className="text-primary/70">BasicTrick</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;
