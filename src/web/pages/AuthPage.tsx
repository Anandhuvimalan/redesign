import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AuthStatusResponse } from "../../shared/types";
import { bootstrapAdmin, loginAdmin, loginStudent, registerStudent } from "../api";
import { AuthFlowFieldBackground } from "../components/AuthFlowFieldBackground";

type AuthView = "student-login" | "student-register" | "admin-login" | "admin-setup";
type AuthTone = "student" | "admin";
type AuthStat = { label: string; value: string };
type StudentGuide = { title: string; copy: string };

interface AuthMeta {
  eyebrow: string;
  title: string;
  copy: string;
  panelCopy: string;
  footnote: string;
  tone: AuthTone;
  stats: AuthStat[];
  notes: string[];
}

interface AuthPageProps {
  authStatus: AuthStatusResponse | null;
  refreshAuth: () => Promise<void>;
  view: AuthView;
}

interface AuthFormState {
  adminSetupForm: { name: string; username: string; password: string };
  setAdminSetupForm: (updater: (current: { name: string; username: string; password: string }) => { name: string; username: string; password: string }) => void;
  adminLoginForm: { username: string; password: string };
  setAdminLoginForm: (updater: (current: { username: string; password: string }) => { username: string; password: string }) => void;
  studentLoginForm: { registerNumber: string; password: string };
  setStudentLoginForm: (updater: (current: { registerNumber: string; password: string }) => { registerNumber: string; password: string }) => void;
  studentRegisterForm: { registerNumber: string; name: string; password: string };
  setStudentRegisterForm: (updater: (current: { registerNumber: string; name: string; password: string }) => { registerNumber: string; name: string; password: string }) => void;
}

const motionEase = [0.22, 1, 0.36, 1] as const;

function getViewMeta(view: AuthView): AuthMeta {
  if (view === "admin-setup") {
    return {
      eyebrow: "Admin Setup",
      title: "Create the control account.",
      copy: "Set up the secure administrator workspace that governs rosters, question inventory, and exam policy.",
      panelCopy: "This one-time step establishes the primary control account for SkillSpark.",
      footnote: "",
      tone: "admin",
      stats: [
        { label: "Mode", value: "One-time setup" },
        { label: "Access", value: "Admin only" },
        { label: "Unlocks", value: "Platform control" }
      ],
      notes: ["Student access stays separate.", "Imports and settings open after setup.", "Create this account once and keep it secure."]
    };
  }

  if (view === "admin-login") {
    return {
      eyebrow: "Admin Access",
      title: "Enter the control panel.",
      copy: "Manage rosters, question inventory, and exam settings from a single operations workspace.",
      panelCopy: "Use the administrator credentials issued for SkillSpark operations.",
      footnote: "",
      tone: "admin",
      stats: [
        { label: "Roster", value: "Students" },
        { label: "Bank", value: "Questions" },
        { label: "Settings", value: "Exam rules" }
      ],
      notes: ["Reset student passwords when needed.", "Import or add questions one by one.", "Update exam duration and question count."]
    };
  }

  if (view === "student-register") {
    return {
      eyebrow: "Student Access",
      title: "Activate your workspace.",
      copy: "",
      panelCopy: "Enter your student number, full name, and a password to create your login.",
      footnote: "Register once, then use the same student number and password each time you return.",
      tone: "student",
      stats: [],
      notes: []
    };
  }

  return {
    eyebrow: "Student Access",
    title: "Enter your exam workspace.",
    copy: "",
    panelCopy: "Use your student number and password to enter the exam panel.",
    footnote: "",
    tone: "student",
    stats: [],
    notes: []
  };
}

function showStudentRouteLinks(view: AuthView, adminSetupRequired: boolean) {
  return !adminSetupRequired && (view === "student-login" || view === "student-register");
}

function renderStudentRouteLinks(view: AuthView, reduceMotion: boolean) {
  const items: Array<{ key: "student-login" | "student-register"; label: string; hint: string; to: string }> = [
    { key: "student-login", label: "Sign in", hint: "Use existing access", to: "/student/login" },
    { key: "student-register", label: "Register", hint: "First-time setup", to: "/student/register" }
  ];
  const switchTransition = { duration: reduceMotion ? 0 : 0.36, ease: motionEase };

  return (
    <div className="auth-switch" role="tablist" aria-label="Student access">
      {items.map((item) => {
        const active = view === item.key;

        return (
          <Link className={`auth-switch__link ${active ? "auth-switch__link--active" : ""}`} key={item.key} to={item.to}>
            {active ? <motion.span className="auth-switch__indicator" layoutId="student-auth-indicator" transition={switchTransition} /> : null}
            <span className="auth-switch__content">
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function StudentBrandScene({ view }: { view: AuthView }) {
  const reduceMotion = useReducedMotion();
  const isRegister = view === "student-register";
  const introVariants = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 12, filter: reduceMotion ? "blur(0px)" : "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, y: reduceMotion ? 0 : -8, filter: reduceMotion ? "blur(0px)" : "blur(4px)" }
  };
  const guides: StudentGuide[] = [
    {
      title: "Timed exam",
      copy: "Answer before the countdown ends."
    },
    {
      title: "Journal entry",
      copy: "Choose the option that best matches each prompt."
    }
  ];
  const scene = isRegister
    ? {
      kicker: "Student access",
      eyebrow: "Before you begin",
      title: "Get ready for the journal entry exam.",
      copy: "Create your access once, then return anytime to continue your timed practice.",
      note: "Register with your student number, full name, and password."
    }
    : {
      kicker: "Student login",
      eyebrow: "Exam guide",
      title: "Step back into your journal entry practice.",
      copy: "Sign in and continue your timed journal entry practice.",
      note: "Use your student number and password to enter the student panel."
    };
  const sceneTransition = { duration: reduceMotion ? 0 : 0.42, ease: motionEase };

  return (
    <div className={`auth-premium-scene auth-premium-scene--${isRegister ? "register" : "login"}`}>
      {!reduceMotion ? (
        <AuthFlowFieldBackground
          className="auth-premium-flow"
          colorDark="#67e8f9"
          colorLight="#0f766e"
          particleCount={120}
          speed={0.5}
          trailOpacity={0.08}
        />
      ) : null}
      <div className="auth-premium-backdrop" aria-hidden="true" />

      <div className="auth-premium-grid">
        <div className="auth-premium-intro-shell">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              animate="animate"
              className="auth-premium-intro"
              exit="exit"
              initial="initial"
              key={view}
              transition={sceneTransition}
              variants={introVariants}
            >
              <span className="auth-premium-kicker">{scene.kicker}</span>
              <span className="auth-premium-eyebrow">{scene.eyebrow}</span>
              <h3 className="auth-premium-title">{scene.title}</h3>
              <p className="auth-premium-copy">{scene.copy}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <motion.div className="auth-premium-content" layout transition={sceneTransition}>
          <div className="auth-premium-guides">
            {guides.map((guide, index) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="auth-premium-guide"
                initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
                key={guide.title}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.3, delay: index * 0.05, ease: motionEase }}
              >
                <span className="auth-premium-guide__index">0{index + 1}</span>
                <div className="auth-premium-guide__copy">
                  <strong>{guide.title}</strong>
                  <p>{guide.copy}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="auth-premium-modes" aria-label="Exam modes">
            {["Easy", "Medium", "Hard"].map((mode) => (
              <span className={`auth-premium-mode auth-premium-mode--${mode.toLowerCase()}`} key={mode}>{mode}</span>
            ))}
          </div>

          <p className="auth-premium-note">{scene.note}</p>
        </motion.div>
      </div>
    </div>
  );
}

function AdminBrandScene({ view }: { view: AuthView }) {
  const reduceMotion = useReducedMotion();
  const isSetup = view === "admin-setup";
  const sceneTransition = { duration: reduceMotion ? 0 : 0.42, ease: motionEase };
  const sceneVariants = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 14, filter: reduceMotion ? "blur(0px)" : "blur(8px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, y: reduceMotion ? 0 : -10, filter: reduceMotion ? "blur(0px)" : "blur(5px)" }
  };

  return (
    <div className={`auth-admin-scene auth-admin-scene--${isSetup ? "setup" : "login"}`}>
      {!reduceMotion ? (
        <AuthFlowFieldBackground
          className="auth-admin-flow"
          colorDark={isSetup ? "#60a5fa" : "#38bdf8"}
          colorLight="#0f766e"
          particleCount={92}
          speed={0.34}
          trailOpacity={0.07}
        />
      ) : null}
      <div className="auth-admin-backdrop" aria-hidden="true" />

      <AnimatePresence initial={false} mode="wait">
        <motion.div
          animate="animate"
          className="auth-admin-visual"
          exit="exit"
          initial="initial"
          key={view}
          transition={sceneTransition}
          variants={sceneVariants}
        >
          <div className="auth-admin-core" aria-hidden="true">
            <div className="auth-admin-core__stack">
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="auth-admin-node auth-admin-node--top" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="auth-admin-node auth-admin-node--left" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="auth-admin-node auth-admin-node--bottom" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function renderForm(
  view: AuthView,
  loading: boolean,
  submit: (action: () => Promise<unknown>) => Promise<void>,
  state: AuthFormState
): ReactNode {
  if (view === "admin-setup") {
    return (
      <form className="form-grid auth-form" onSubmit={(event) => { event.preventDefault(); void submit(() => bootstrapAdmin(state.adminSetupForm.name, state.adminSetupForm.username, state.adminSetupForm.password)); }}>
        <label className="form-field">
          <span className="form-label">Administrator name</span>
          <input className="input" autoComplete="name" onChange={(event) => state.setAdminSetupForm((current) => ({ ...current, name: event.target.value }))} placeholder="Full name" value={state.adminSetupForm.name} />
        </label>
        <label className="form-field">
          <span className="form-label">Username</span>
          <input className="input" autoComplete="username" onChange={(event) => state.setAdminSetupForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" value={state.adminSetupForm.username} />
        </label>
        <label className="form-field">
          <span className="form-label">Password</span>
          <input className="input" autoComplete="new-password" onChange={(event) => state.setAdminSetupForm((current) => ({ ...current, password: event.target.value }))} placeholder="Minimum 8 characters" type="password" value={state.adminSetupForm.password} />
        </label>
        <button className="button button--auth-primary button--block" disabled={loading} type="submit">
          <span className="auth-submit__label">{loading ? "Creating..." : "Create Admin"}</span>
        </button>
      </form>
    );
  }

  if (view === "admin-login") {
    return (
      <form className="form-grid auth-form" onSubmit={(event) => { event.preventDefault(); void submit(() => loginAdmin(state.adminLoginForm.username, state.adminLoginForm.password)); }}>
        <label className="form-field">
          <span className="form-label">Username</span>
          <input className="input" autoComplete="username" onChange={(event) => state.setAdminLoginForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" value={state.adminLoginForm.username} />
        </label>
        <label className="form-field">
          <span className="form-label">Password</span>
          <input className="input" autoComplete="current-password" onChange={(event) => state.setAdminLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" type="password" value={state.adminLoginForm.password} />
        </label>
        <button className="button button--auth-primary button--block" disabled={loading} type="submit">
          <span className="auth-submit__label">{loading ? "Signing in..." : "Sign in"}</span>
        </button>
      </form>
    );
  }

  if (view === "student-register") {
    return (
      <form className="form-grid auth-form auth-form--student auth-form--student-register" onSubmit={(event) => { event.preventDefault(); void submit(() => registerStudent(state.studentRegisterForm.registerNumber, state.studentRegisterForm.name, state.studentRegisterForm.password)); }}>
        <label className="form-field">
          <span className="form-label">Register number</span>
          <input
            autoComplete="username"
            className="input"
            onChange={(event) => state.setStudentRegisterForm((current) => ({ ...current, registerNumber: event.target.value }))}
            placeholder="Use your SkillSpark student number"
            value={state.studentRegisterForm.registerNumber}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Full name</span>
          <input
            autoComplete="name"
            className="input"
            onChange={(event) => state.setStudentRegisterForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Full name"
            value={state.studentRegisterForm.name}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Password</span>
          <input
            autoComplete="new-password"
            className="input"
            onChange={(event) => state.setStudentRegisterForm((current) => ({ ...current, password: event.target.value }))}
            placeholder="Create password"
            type="password"
            value={state.studentRegisterForm.password}
          />
        </label>
        <button className="button button--auth-primary button--block" disabled={loading} type="submit">
          <span className="auth-submit__label">{loading ? "Creating..." : "Register"}</span>
        </button>
      </form>
    );
  }

  return (
    <form className="form-grid auth-form auth-form--student auth-form--student-login" onSubmit={(event) => { event.preventDefault(); void submit(() => loginStudent(state.studentLoginForm.registerNumber, state.studentLoginForm.password)); }}>
      <label className="form-field">
        <span className="form-label">Register number</span>
        <input
          autoComplete="username"
          className="input"
          onChange={(event) => state.setStudentLoginForm((current) => ({ ...current, registerNumber: event.target.value }))}
          placeholder="Use your SkillSpark student number"
          value={state.studentLoginForm.registerNumber}
        />
      </label>
      <label className="form-field">
        <span className="form-label">Password</span>
        <input
          autoComplete="current-password"
          className="input"
          onChange={(event) => state.setStudentLoginForm((current) => ({ ...current, password: event.target.value }))}
          placeholder="Password"
          type="password"
          value={state.studentLoginForm.password}
        />
      </label>
      <div aria-hidden="true" className="auth-form__spacer" />
      <button className="button button--auth-primary button--block" disabled={loading} type="submit">
        <span className="auth-submit__label">{loading ? "Signing in..." : "Sign in"}</span>
      </button>
    </form>
  );
}

export function AuthPage({ authStatus, refreshAuth, view }: AuthPageProps) {
  const adminSetupRequired = authStatus?.adminSetupRequired ?? false;
  const reduceMotion = Boolean(useReducedMotion());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formDirection, setFormDirection] = useState(0);
  const previousViewRef = useRef(view);

  const [adminSetupForm, setAdminSetupForm] = useState({ name: "", username: "", password: "" });
  const [adminLoginForm, setAdminLoginForm] = useState({ username: "", password: "" });
  const [studentLoginForm, setStudentLoginForm] = useState({ registerNumber: "", password: "" });
  const [studentRegisterForm, setStudentRegisterForm] = useState({ registerNumber: "", name: "", password: "" });

  const meta = useMemo(() => getViewMeta(view), [view]);
  const stageTransition = { duration: reduceMotion ? 0 : 0.34, ease: motionEase };
  const formStageTransition = { duration: reduceMotion ? 0 : 0.42, ease: [0.16, 1, 0.3, 1] as const };
  const showStudentShowcase = meta.tone === "student";
  const headerVariants = {
    initial: (direction: number) => reduceMotion ? { opacity: 1, y: 0, filter: "blur(0px)" } : {
      opacity: 0,
      y: direction === 0 ? 10 : 8,
      filter: "blur(6px)"
    },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: (direction: number) => reduceMotion ? { opacity: 0, y: 0, filter: "blur(0px)" } : {
      opacity: 0,
      y: direction === 0 ? -8 : -6,
      filter: "blur(4px)"
    }
  };

  useEffect(() => {
    const previousView = previousViewRef.current;
    if (previousView !== view) {
      if (previousView.startsWith("student") && view.startsWith("student")) {
        setFormDirection(view === "student-register" ? 1 : -1);
      } else {
        setFormDirection(0);
      }
      previousViewRef.current = view;
    }
  }, [view]);

  const stageVariants = {
    initial: (_direction: number) => reduceMotion ? { opacity: 1, y: 0, filter: "blur(0px)" } : {
      opacity: 0,
      y: 18,
      filter: "blur(6px)"
    },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: (_direction: number) => reduceMotion ? { opacity: 0, y: 0, filter: "blur(0px)" } : {
      opacity: 0,
      y: -10,
      filter: "blur(4px)"
    }
  };

  const submit = async (action: () => Promise<unknown>) => {
    try {
      setLoading(true);
      await action();
      setError("");
      await refreshAuth();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={`auth-shell auth-shell--flat auth-shell--${meta.tone}`}>
      <div className={`panel auth-frame auth-frame--${meta.tone}`}>
        {showStudentShowcase ? (
          <div className="auth-showcase auth-showcase--student">
            <StudentBrandScene view={view} />
          </div>
        ) : (
          <div className="auth-showcase auth-showcase--admin">
            <AdminBrandScene view={view} />
          </div>
        )}

        <div className="auth-side">
          <div className={`auth-side__header-shell ${showStudentShowcase ? "auth-side__header-shell--student" : ""}`}>
            <AnimatePresence custom={formDirection} initial={false} mode="wait">
              <motion.div
                animate="animate"
                className={`auth-side__header ${showStudentShowcase ? "auth-side__header--student" : ""}`}
                custom={formDirection}
                exit="exit"
                initial="initial"
                key={`${view}-header`}
                transition={stageTransition}
                variants={headerVariants}
              >
                <span className="eyebrow">{meta.eyebrow}</span>
                <h2>{meta.title}</h2>
                {meta.panelCopy ? <p className="section-copy">{meta.panelCopy}</p> : null}
              </motion.div>
            </AnimatePresence>
          </div>

          {showStudentRouteLinks(view, adminSetupRequired) ? renderStudentRouteLinks(view, reduceMotion) : null}

          {error ? <div className="banner banner--error">{error}</div> : null}

          <div className={`auth-stage-shell ${showStudentShowcase ? "auth-stage-shell--student" : ""}`}>
            <AnimatePresence custom={formDirection} initial={false} mode="wait">
              <motion.div
                animate="animate"
                className="auth-stage"
                custom={formDirection}
                exit="exit"
                initial="initial"
                key={view}
                transition={formStageTransition}
                variants={stageVariants}
              >
                {renderForm(view, loading, submit, {
                  adminSetupForm,
                  setAdminSetupForm,
                  adminLoginForm,
                  setAdminLoginForm,
                  studentLoginForm,
                  setStudentLoginForm,
                  studentRegisterForm,
                  setStudentRegisterForm
                })}

                {meta.footnote ? <p className="auth-footnote">{meta.footnote}</p> : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
