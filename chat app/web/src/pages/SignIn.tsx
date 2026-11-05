import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PublicUser } from "../../../shared/types";
import { registerBuyer, signIn, signInDemo, type DemoAccount } from "../api";
import { copy } from "../copy";
import { Hall } from "../ui/Hall";
import { easeOut, fadeUp, stagger, useMotionOn } from "../ui/motion";
import { RevealHeadline } from "../ui/Reveal";

type Mode = "signin" | "register";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const demos: { id: DemoAccount; label: string }[] = [
  { id: "buyer", label: copy.demoBuyer },
  { id: "seller", label: copy.demoSeller },
  { id: "support", label: copy.demoSupport },
];

export function SignIn({ onSignedIn }: { onSignedIn: (user: PublicUser) => void }) {
  const motionOn = useMotionOn();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"form" | DemoAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [paused, setPaused] = useState(false);

  const emailOk = EMAIL.test(email.trim());
  const passwordOk = password.length >= 8 && password.length <= 72;
  const nameOk = name.trim().length >= 2;
  const ready = emailOk && passwordOk && (mode === "signin" || nameOk);
  const busy = pending !== null || success;

  function switchMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setError(null);
    setSuccess(false);
  }

  async function finish(user: PublicUser) {
    setSuccess(true);
    onSignedIn(user);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (mode === "register" && !nameOk) {
      setError("Enter the name shown on your desk.");
      return;
    }
    if (!emailOk) {
      setError("Enter a valid email address.");
      return;
    }
    if (!passwordOk) {
      setError("Use 8–72 characters for the password.");
      return;
    }
    setPending("form");
    setError(null);
    try {
      const result =
        mode === "register"
          ? await registerBuyer(name, email, password)
          : await signIn(email, password);
      await finish(result.user);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not sign you in.");
    } finally {
      setPending(null);
    }
  }

  async function onDemo(account: DemoAccount) {
    if (busy) return;
    setPending(account);
    setError(null);
    try {
      const result = await signInDemo(account);
      await finish(result.user);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Could not open the demo desk.");
    } finally {
      setPending(null);
    }
  }

  const submitLabel = success
    ? "Signed in"
    : pending === "form"
      ? mode === "register"
        ? "Creating account"
        : "Signing in"
      : mode === "register"
        ? copy.createAccount
        : copy.continue;

  return (
    <main className="hall" id="main">
      <Hall paused={paused} />
      <header className="hall-top">
        <a className="wordmark hall-mark" href="#main">
          {copy.name}
        </a>
        {motionOn ? (
          <button
            type="button"
            className="motion-toggle"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={!paused}
            aria-label={paused ? "Motion off. Turn motion on" : "Motion on. Turn motion off"}
          >
            Motion {paused ? "off" : "on"}
          </button>
        ) : null}
      </header>
      <div className="hall-stage">
        <div className="hall-hero">
          <motion.p
            className="kicker"
            initial={motionOn ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: easeOut }}
          >
            {copy.place}
          </motion.p>
          <RevealHeadline className="hall-title" />
          <motion.p
            className="lede"
            initial={motionOn ? { opacity: 0, y: 12 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.78, duration: 0.8, ease: easeOut }}
          >
            Sign in to buy, sell, or support an order. Roles stay on the server.
          </motion.p>
        </div>
        <motion.form
          className="hall-enter"
          onSubmit={onSubmit}
          initial={motionOn ? "hidden" : false}
          animate="show"
          variants={stagger}
        >
          {mode === "register" ? (
            <motion.div className="name-line" variants={fadeUp}>
              <label htmlFor="display-name">{copy.nameLabel}</label>
              <input
                id="display-name"
                name="name"
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="Shown on your desk"
                value={name}
                required
                maxLength={40}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </motion.div>
          ) : null}
          <motion.div className="name-line" variants={fadeUp}>
            <label htmlFor="email">{copy.emailLabel}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              required
              maxLength={120}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "auth-error" : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
          </motion.div>
          <motion.div className="name-line" variants={fadeUp}>
            <label htmlFor="password">{copy.passwordLabel}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="8–72 characters"
              value={password}
              required
              minLength={8}
              maxLength={72}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </motion.div>
          {mode === "register" ? (
            <motion.p className="auth-hint" variants={fadeUp}>
              {copy.buyerOnly}
            </motion.p>
          ) : null}
          {error ? (
            <p id="auth-error" className="field-error" role="alert">
              {error}
            </p>
          ) : success ? (
            <p className="auth-success" role="status">
              Signed in.
            </p>
          ) : null}
          <motion.div variants={fadeUp}>
            <button type="submit" className="enter" disabled={!ready || busy} aria-busy={pending === "form" || undefined}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={submitLabel}
                  initial={motionOn ? { opacity: 0, y: 6 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={motionOn ? { opacity: 0, y: -6 } : undefined}
                  transition={{ duration: 0.28, ease: easeOut }}
                >
                  {submitLabel}
                </motion.span>
              </AnimatePresence>
              <span className="enter-arrow" aria-hidden="true">
                →
              </span>
            </button>
          </motion.div>
          <motion.p className="auth-switch" variants={fadeUp}>
            {mode === "signin" ? (
              <>
                New here?{" "}
                <button type="button" onClick={() => switchMode("register")} disabled={busy}>
                  {copy.createAccount}
                </button>
              </>
            ) : (
              <>
                Already have a desk?{" "}
                <button type="button" onClick={() => switchMode("signin")} disabled={busy}>
                  {copy.haveAccount}
                </button>
              </>
            )}
          </motion.p>
          <motion.section className="hall-demo" aria-label="Explore demo" variants={fadeUp}>
            <p className="kicker">{copy.demoKicker}</p>
            <p>{copy.demoLead}</p>
            <div className="demo-row">
              {demos.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="demo-btn"
                  disabled={busy}
                  aria-busy={pending === item.id || undefined}
                  onClick={() => void onDemo(item.id)}
                >
                  {pending === item.id ? "Opening" : item.label}
                </button>
              ))}
            </div>
          </motion.section>
        </motion.form>
      </div>
    </main>
  );
}
