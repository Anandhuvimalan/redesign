import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import type {
  AttemptDetail,
  AttemptSummary,
  AuthenticatedStudent,
  Level,
  QuestionResult,
  StudentAnswerRow,
  StudentQuestion,
  StudentSubmission
} from "../../shared/types";
import { LEVELS } from "../../shared/types";
import { fetchStudentAttempt, fetchStudentDashboard, startStudentQuiz, submitStudentQuiz } from "../api";

export type StudentSection = "overview" | "test" | "results";

interface StudentPageProps {
  section: StudentSection;
  user: AuthenticatedStudent;
}

interface DashState {
  settings: { questionsPerQuiz: number; timeLimitMinutes: number };
  questionSummary: { levels: Array<{ level: Level; count: number }> };
  pastScores: AttemptSummary[];
}

type ReviewTone = "match" | "error" | "empty";

interface StudentReviewRow {
  i: number;
  account: string;
  debit: string;
  credit: string;
  accountTone: ReviewTone;
  debitTone: ReviewTone;
  creditTone: ReviewTone;
}

interface CorrectReviewRow {
  i: number;
  account: string;
  debit: string;
  credit: string;
  state: "matched" | "reference" | "missed" | "empty";
}

const motionEase = [0.22, 1, 0.36, 1] as const;
const STUDENT_SECTION_META: Record<StudentSection, { label: string; eyebrow: string; title: string; copy: string }> = {
  overview: {
    label: "Student",
    eyebrow: "Student workspace",
    title: "Student workspace",
    copy: "Check the exam rules, see your latest status, and move into the next timed run."
  },
  test: {
    label: "Test",
    eyebrow: "Timed exam",
    title: "Test center",
    copy: "Start a mode, complete the journal entry, and move through the question set without losing context."
  },
  results: {
    label: "Results",
    eyebrow: "Attempt review",
    title: "Results",
    copy: "Open completed attempts and review the marked rows question by question."
  }
};

function tc(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function emptyRows(n: number): StudentAnswerRow[] { return Array.from({ length: n }, () => ({ account: "", debit: "", credit: "" })); }
function hasAnswer(rows: StudentAnswerRow[]) { return rows.some((r) => r.account || r.debit || r.credit); }
function fa(v: number | null) { return v === null ? "" : String(v); }
function pa(v: string) { const t = v.trim(); if (!t) return 0; const n = Number(t.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; }
function ft(sec: number) { const s = Math.max(0, sec); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
function pc(l: string) { return l === "Excellent" ? "perf-badge perf-badge--excellent" : l === "Very Good" ? "perf-badge perf-badge--very-good" : l === "Good" ? "perf-badge perf-badge--good" : "perf-badge perf-badge--poor"; }
function lp(l: string) { return l === "basic" ? "pill pill--emerald" : l === "medium" ? "pill pill--amber" : "pill pill--rose"; }

function wasAttempted(result: QuestionResult) {
  return result.studentRows.some((r) => r.account || r.debit !== null || r.credit !== null);
}

function getReviewSize(result: QuestionResult) {
  return Math.max(5, result.studentRows.length, result.correctRows.length);
}

function studentReviewRows(result: QuestionResult): StudentReviewRow[] {
  const size = getReviewSize(result);

  if (!wasAttempted(result)) {
    return Array.from({ length: size }, (_, i) => ({
      i,
      account: "",
      debit: "",
      credit: "",
      accountTone: "empty",
      debitTone: "empty",
      creditTone: "empty"
    }));
  }

  return Array.from({ length: size }, (_, i) => {
    const row = result.studentRows[i];
    if (!row) {
      return { i, account: "", debit: "", credit: "", accountTone: "empty", debitTone: "empty", creditTone: "empty" };
    }

    return {
      i,
      account: row.account,
      debit: fa(row.debit),
      credit: fa(row.credit),
      accountTone: row.accountMatched ? "match" : "error",
      debitTone: row.debitMatched ? "match" : "error",
      creditTone: row.creditMatched ? "match" : "error"
    };
  });
}

function correctReviewRows(result: QuestionResult): CorrectReviewRow[] {
  const size = getReviewSize(result);
  const matchedIds = new Set(
    result.studentRows
      .filter((row) => row.matched && row.referenceRowId)
      .map((row) => row.referenceRowId as string)
  );
  const referencedIds = new Set(
    result.studentRows
      .filter((row) => !row.matched && row.referenceRowId)
      .map((row) => row.referenceRowId as string)
  );

  return Array.from({ length: size }, (_, i) => {
    const row = result.correctRows[i];
    if (!row) return { i, account: "", debit: "", credit: "", state: "empty" as const };

    if (matchedIds.has(row.id)) {
      return { i, account: row.account, debit: fa(row.debit), credit: fa(row.credit), state: "matched" as const };
    }

    if (referencedIds.has(row.id)) {
      return { i, account: row.account, debit: fa(row.debit), credit: fa(row.credit), state: "reference" as const };
    }

    return { i, account: row.account, debit: fa(row.debit), credit: fa(row.credit), state: "missed" as const };
  });
}

function ScoreRing({ score, total, size = 92 }: { score: number; total: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? score / total : 0;
  const color = pct >= 0.8 ? "var(--emerald)" : pct >= 0.5 ? "var(--amber)" : "var(--rose)";

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle className="score-ring__bg" cx={size / 2} cy={size / 2} r={r} />
        <circle className="score-ring__fill" cx={size / 2} cy={size / 2} r={r} stroke={color} strokeDasharray={c} strokeDashoffset={c - pct * c} />
      </svg>
      <div className="score-ring__text">
        <span className="score-ring__value">{score}</span>
        <span className="score-ring__label">of {total}</span>
      </div>
    </div>
  );
}

function AccountPicker({
  options,
  value,
  onChange
}: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuTransition = { duration: reduceMotion ? 0 : 0.24, ease: motionEase };
  const menuVariants = {
    open: reduceMotion ? { opacity: 1 } : {
      opacity: 1,
      y: 0,
      scale: 1,
      clipPath: "inset(0% 0% 0% 0% round 20px)",
      transition: {
        ...menuTransition,
        when: "beforeChildren",
        staggerChildren: 0.025,
        delayChildren: 0.02
      }
    },
    closed: reduceMotion ? { opacity: 0 } : {
      opacity: 0,
      y: -10,
      scale: 0.98,
      clipPath: "inset(0% 0% 12% 0% round 20px)",
      transition: {
        duration: 0.18,
        ease: motionEase,
        when: "afterChildren",
        staggerChildren: 0.02,
        staggerDirection: -1
      }
    }
  };
  const optionVariants = {
    open: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 },
    closed: reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className={`account-picker ${open ? "account-picker--open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`account-picker__trigger ${value ? "" : "account-picker__trigger--placeholder"}`}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span>{value || "Select account"}</span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0, y: open ? 1 : 0 }}
          height="14"
          transition={menuTransition}
          viewBox="0 0 24 24"
          width="14"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            animate="open"
            className="account-picker__menu"
            exit="closed"
            initial="closed"
            role="listbox"
            variants={menuVariants}
          >
            <motion.button
              aria-selected={!value}
              className={`account-picker__option ${!value ? "account-picker__option--active" : ""}`}
              onClick={() => { onChange(""); setOpen(false); }}
              role="option"
              type="button"
              variants={optionVariants}
            >
              Clear selection
            </motion.button>
            {options.map((option) => (
              <motion.button
                aria-selected={value === option}
                className={`account-picker__option ${value === option ? "account-picker__option--active" : ""}`}
                key={option}
                onClick={() => { onChange(option); setOpen(false); }}
                role="option"
                type="button"
                variants={optionVariants}
              >
                {option}
              </motion.button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function StudentPage({ section, user }: StudentPageProps) {
  const reduceMotion = useReducedMotion();
  const meta = STUDENT_SECTION_META[section];
  const [dash, setDash] = useState<DashState | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizLevel, setQuizLevel] = useState<Level | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, StudentAnswerRow[]>>({});
  const [idx, setIdx] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [secs, setSecs] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rIdx, setRIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const resultRef = useRef<HTMLDivElement | null>(null);
  const reviewRef = useRef<HTMLElement | null>(null);

  const q = questions[idx];
  const rq = attempt?.questionResults[rIdx] ?? null;
  const answered = useMemo(() => questions.filter((x) => hasAnswer(answers[x.id] ?? [])).length, [answers, questions]);
  const bw = useMemo(() => {
    if (!q) return null;
    const rows = answers[q.id] ?? [];
    if (!rows.some((r) => r.account || r.debit || r.credit)) return null;
    const d = rows.reduce((s, r) => s + pa(r.debit), 0);
    const c = rows.reduce((s, r) => s + pa(r.credit), 0);
    return Math.abs(d - c) < 0.0001 ? null : { d, c };
  }, [q, answers]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setDash(await fetchStudentDashboard());
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Load failed.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submitQuiz = async (auto = false) => {
    if (!quizId || submitting) return;
    if (!auto && !window.confirm("Submit this exam now?")) return;

    try {
      setSubmitting(true);
      const submissions: StudentSubmission[] = questions.map((x) => ({ questionId: x.id, rows: answers[x.id] ?? [] }));
      const result = await submitStudentQuiz(quizId, submissions);
      setAttempt(result.attempt);
      setReviewOpen(false);
      setRIdx(0);
      setDash((current) => current ? { ...current, pastScores: result.pastScores } : current);
      setQuizId(null);
      setQuizLevel(null);
      setExpiresAt(null);
      setSecs(null);
      setQuestions([]);
      setAnswers({});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!quizId || !expiresAt || submitting) return;
    const iv = window.setInterval(() => {
      const secondsRemaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecs(secondsRemaining);
      if (secondsRemaining === 0) void submitQuiz(true);
    }, 1000);
    return () => window.clearInterval(iv);
  }, [expiresAt, quizId, submitting, questions, answers]);

  useEffect(() => {
    if (!quizId || !questions.length) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.target instanceof HTMLInputElement || event.target.closest(".account-picker")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIdx((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIdx((current) => Math.min(questions.length - 1, current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quizId, questions.length]);

  useEffect(() => {
    if (section !== "results" || !attempt || reviewOpen) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [attempt?.attemptId, reviewOpen, section]);

  useEffect(() => {
    if (section !== "results" || !reviewOpen || !rq) return;
    reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reviewOpen, rIdx, rq?.questionId, section]);

  const startQuiz = async (level: Level) => {
    try {
      setLoading(true);
      const result = await startStudentQuiz(level);
      setQuizId(result.quizId);
      setQuizLevel(result.level);
      setExpiresAt(result.expiresAt);
      setSecs(Math.max(0, Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000)));
      setQuestions(result.questions);
      setAnswers(Object.fromEntries(result.questions.map((x) => [x.id, emptyRows(x.answerSlotCount)])));
      setAttempt(null);
      setReviewOpen(false);
      setRIdx(0);
      setIdx(0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Start failed.");
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (qid: string, ri: number, field: keyof StudentAnswerRow, value: string) => {
    setAnswers((current) => {
      const rows = [...(current[qid] ?? [])];
      rows[ri] = { ...rows[ri], [field]: value };
      return { ...current, [qid]: rows };
    });
  };

  const loadAttempt = async (id: string, openReview = false) => {
    try {
      setLoading(true);
      const nextAttempt = await fetchStudentAttempt(id);
      setAttempt(nextAttempt);
      setReviewOpen(openReview);
      setRIdx(0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  };

  const quizProgress = questions.length ? Math.round((answered / questions.length) * 100) : 0;
  const totalBankQuestions = dash?.questionSummary.levels.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
  const latestAttempt = dash?.pastScores[0] ?? null;
  const focusAttemptId = attempt?.attemptId ?? latestAttempt?.id ?? null;
  const focusAttemptScore = attempt?.score ?? latestAttempt?.score ?? null;
  const focusAttemptTotal = attempt?.totalQuestions ?? latestAttempt?.totalQuestions ?? null;
  const focusAttemptLevel = attempt?.level ?? latestAttempt?.level ?? null;
  const focusAttemptLabel = attempt?.performanceLabel ?? latestAttempt?.performanceLabel ?? null;
  const focusAttemptDate = attempt?.completedAt ?? latestAttempt?.completedAt ?? null;
  const studentNavItems = [
    { key: "overview" as const, label: "Student", to: "/student/overview" },
    { key: "test" as const, label: "Test", to: "/student/test" },
    { key: "results" as const, label: "Results", to: "/student/results" }
  ];
  const pageTransition = { duration: reduceMotion ? 0 : 0.4, ease: motionEase };
  const panelTransition = { duration: reduceMotion ? 0 : 0.34, ease: motionEase };

  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="stack"
      initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
      transition={pageTransition}
    >
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="section-head section-head--hero student-workspace__hero"
        initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
        transition={panelTransition}
      >
        <div className="section-head__top">
          <div className="section-head__info">
            <span className="eyebrow">{meta.eyebrow}</span>
            <h2>{meta.title}</h2>
            <p className="section-copy">{meta.copy}</p>
          </div>

          <div className="section-head__metrics">
            <span className="pill pill--indigo">{dash?.settings.questionsPerQuiz ?? "--"} questions</span>
            <span className="pill pill--amber">{dash?.settings.timeLimitMinutes ?? "--"} min</span>
            <span className="pill">{dash?.pastScores.length ?? 0} attempts</span>
          </div>
        </div>

        <div className="hero-strip">
          <div className="hero-strip__item">
            <span className="hero-strip__label">Register number</span>
            <strong>{user.registerNumber}</strong>
          </div>
          <div className="hero-strip__item">
            <span className="hero-strip__label">Question bank</span>
            <strong>{totalBankQuestions}</strong>
          </div>
          <div className="hero-strip__item">
            <span className="hero-strip__label">{quizId ? "Current mode" : section === "results" ? "Latest result" : "Current status"}</span>
            <strong>{quizId ? "Timed exam" : section === "results" ? latestAttempt?.performanceLabel ?? "No attempts yet" : latestAttempt?.performanceLabel ?? "Ready to start"}</strong>
          </div>
        </div>
      </motion.div>

      <nav aria-label="Student workspace" className="student-workspace-nav">
        {studentNavItems.map((item) => (
          <NavLink className={({ isActive }) => `student-workspace-nav__link ${isActive ? "student-workspace-nav__link--active" : ""}`} key={item.key} to={item.to}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {error ? <div className="banner banner--error">{error}</div> : null}
      {loading && !quizId ? <div className="loading-bar" /> : null}

      {quizId && section !== "test" ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="panel student-active-banner"
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={panelTransition}
        >
          <div className="student-active-banner__copy">
            <span className="eyebrow">Exam in progress</span>
            <strong>{quizLevel ? `${tc(quizLevel)} level` : "Timed exam"} is still running.</strong>
            <p>Continue the live attempt from the test section before the timer expires.</p>
          </div>

          <NavLink className="button button--primary" to="/student/test">
            Resume Test
          </NavLink>
        </motion.div>
      ) : null}

      <AnimatePresence initial={false} mode="wait">
        {section === "test" && quizId && q ? (
          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="panel student-console"
            initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
            key="student-active-exam"
            transition={panelTransition}
          >
            <aside className="student-console__rail">
              <div className="student-console__rail-block">
                <span className="eyebrow">Active exam</span>
                <strong>{quizLevel ? `${tc(quizLevel)} level` : "Timed set"}</strong>
                <p>Move through the questions, fill the journal rows, and submit before time runs out.</p>
              </div>

              <div className={`timer-display ${secs !== null && secs <= 60 ? "timer-display--urgent" : ""}`}>{secs !== null ? ft(secs) : "--:--"}</div>

              <div className="student-console__stats">
                <div className="student-console__stat">
                  <span>Answered</span>
                  <strong>{answered}/{questions.length}</strong>
                </div>
                <div className="student-console__stat">
                  <span>Progress</span>
                  <strong>{quizProgress}%</strong>
                </div>
              </div>

              <div className="student-console__rail-block">
                <div className="student-console__nav-head">
                  <span>Question map</span>
                  <strong>{idx + 1}/{questions.length}</strong>
                </div>

                <div className="question-dots">
                  {questions.map((item, index) => (
                    <button className={`question-dot ${hasAnswer(answers[item.id] ?? []) ? "question-dot--answered" : ""} ${index === idx ? "question-dot--active" : ""}`} key={item.id} onClick={() => setIdx(index)} type="button">
                      {index + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="student-console__rail-foot">
                <div className="pill pill--emerald rail__summary-pill">{answered} / {questions.length} answered</div>
                <p className="student-console__note">The exam submits automatically when the timer reaches zero.</p>
                <button className="button button--primary button--block" disabled={submitting} onClick={() => void submitQuiz(false)} type="button">
                  {submitting ? "Submitting..." : "Submit Exam"}
                </button>
              </div>
            </aside>

            <div className="student-console__main">
              <div className="student-console__head">
                <div className="student-console__headline">
                  <span className="eyebrow">Question {idx + 1} of {questions.length}</span>
                  <h3>{q.prompt}</h3>
                </div>

                <div className="student-console__badges">
                  {quizLevel ? <span className={lp(quizLevel)}>{tc(quizLevel)}</span> : null}
                  <span className="pill">{questions.length - answered} remaining</span>
                </div>
              </div>

              <div className="student-console__particulars">
                <div className="student-console__particulars-head">
                  <span className="option-bank__label">Available particulars</span>
                  <span className="pill pill--sky">Pick directly from the list</span>
                </div>
                <div className="chip-list">{q.options.map((option) => <span className="chip" key={option}>{option}</span>)}</div>
              </div>

              <div className="student-console__entry">
                <div className="review-table-card__head">
                  <strong>Journal entry</strong>
                  <span className="pill pill--indigo">{hasAnswer(answers[q.id] ?? []) ? "Draft in progress" : "Blank answer"}</span>
                </div>

                <div className="journal-table-wrap student-console__table">
                  <table className="journal-table">
                    <thead><tr><th>#</th><th>Particular</th><th>Debit</th><th>Credit</th></tr></thead>
                    <tbody>
                      {(answers[q.id] ?? []).map((row, rowIndex) => (
                        <tr key={`${q.id}-${rowIndex}`}>
                          <td>{rowIndex + 1}</td>
                          <td>
                            <AccountPicker
                              onChange={(next) => updateRow(q.id, rowIndex, "account", next)}
                              options={q.options}
                              value={row.account}
                            />
                          </td>
                          <td><input inputMode="decimal" onChange={(e) => updateRow(q.id, rowIndex, "debit", e.target.value)} placeholder="0.00" value={row.debit} /></td>
                          <td><input inputMode="decimal" onChange={(e) => updateRow(q.id, rowIndex, "credit", e.target.value)} placeholder="0.00" value={row.credit} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {bw ? <div className="journal-warning">Debit ({bw.d.toLocaleString()}) does not equal Credit ({bw.c.toLocaleString()})</div> : null}

                <div className="student-console__pager pager">
                  <button className="button" disabled={idx === 0} onClick={() => setIdx((current) => Math.max(0, current - 1))} type="button">Previous</button>
                  <button className="button button--primary" disabled={idx === questions.length - 1} onClick={() => setIdx((current) => Math.min(questions.length - 1, current + 1))} type="button">Next</button>
                </div>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={section === "results" ? "student-results" : "student-home"}
            initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
            key={`student-${section}`}
            transition={panelTransition}
          >
            {section === "overview" ? (
              <section className="panel student-overview">
                <div className="student-overview__main">
                  <div className="student-overview__intro">
                    <span className="eyebrow">Student page</span>
                    <h3>How this workspace works</h3>

                    <div className="student-overview__guides">
                      <div className="student-overview__guide">
                        <strong>Timed exam</strong>
                        <p>Each run uses the configured time limit and submits automatically when the timer reaches zero.</p>
                      </div>
                      <div className="student-overview__guide">
                        <strong>Journal entry</strong>
                        <p>Choose the correct particular from the list and fill the debit and credit values for each row.</p>
                      </div>
                      <div className="student-overview__guide">
                        <strong>Marked review</strong>
                        <p>Open the results section to inspect matched rows, mistakes, and the expected answer question by question.</p>
                      </div>
                    </div>
                  </div>

                  <aside className="student-overview__side">
                    <div className="student-overview__fact">
                      <span>Latest result</span>
                      <strong>{latestAttempt?.performanceLabel ?? "No attempts yet"}</strong>
                    </div>
                    <div className="student-overview__fact">
                      <span>Last score</span>
                      <strong>{latestAttempt ? `${latestAttempt.score}/${latestAttempt.totalQuestions}` : "--"}</strong>
                    </div>
                    <div className="student-overview__fact">
                      <span>Question bank</span>
                      <strong>{totalBankQuestions}</strong>
                    </div>

                    <div className="student-overview__actions">
                      <NavLink className="button button--primary" to="/student/test">
                        {quizId ? "Resume Test" : "Go To Test"}
                      </NavLink>
                      <NavLink className="button" to="/student/results">
                        Open Results
                      </NavLink>
                    </div>
                  </aside>
                </div>
              </section>
            ) : null}

            {section === "test" ? (
            <section className="panel student-launch">
              <div className="student-launch__head">
                <div className="student-launch__intro">
                  <span className="eyebrow">Start exam</span>
                  <h3>Choose your mode</h3>
                  <p className="section-copy">Each run is timed, draws a fresh set of questions, and opens the journal entry sheet immediately.</p>
                </div>

                <div className="student-launch__facts">
                  <div className="student-launch__fact">
                    <span>Questions</span>
                    <strong>{dash?.settings.questionsPerQuiz ?? "--"}</strong>
                  </div>
                  <div className="student-launch__fact">
                    <span>Time</span>
                    <strong>{dash?.settings.timeLimitMinutes ?? "--"} min</strong>
                  </div>
                  <div className="student-launch__fact">
                    <span>Bank</span>
                    <strong>{totalBankQuestions}</strong>
                  </div>
                </div>
              </div>

              <div className="student-levels">
                {LEVELS.map((level) => {
                  const count = dash?.questionSummary.levels.find((entry) => entry.level === level)?.count ?? 0;
                  return (
                    <motion.button
                      className={`student-mode-card student-mode-card--${level}`}
                      disabled={loading || count === 0}
                      key={level}
                      onClick={() => void startQuiz(level)}
                      type="button"
                      whileHover={reduceMotion || loading || count === 0 ? undefined : { y: -5, scale: 1.01 }}
                      whileTap={reduceMotion || loading || count === 0 ? undefined : { scale: 0.99 }}
                    >
                      <div className="student-mode-card__head">
                        <span className="student-mode-card__tag">{tc(level)}</span>
                        <span className={`student-mode-card__state ${count > 0 ? "" : "student-mode-card__state--muted"}`}>{count > 0 ? "Ready" : "Unavailable"}</span>
                      </div>
                      <strong className="student-mode-card__count">{count}</strong>
                      <p className="student-mode-card__copy">
                        {count > 0 ? `${Math.min(count, dash?.settings.questionsPerQuiz ?? 0)} questions drawn per run.` : "No questions are currently available in this mode."}
                      </p>
                      <div className="student-mode-card__footer">
                        <span>{count > 0 ? "Start exam" : "Waiting for upload"}</span>
                        <span>{dash?.settings.timeLimitMinutes ?? 0} min</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </section>
            ) : null}

            {section === "results" ? (
            <section className="panel student-records">
              <div className="student-records__head">
                <div>
                  <span className="eyebrow">Attempts</span>
                  <h3>Recent work</h3>
                </div>

                <div className="inline-metrics">
                  <span className="pill pill--sky">{dash?.pastScores.length ?? 0} logged attempts</span>
                  {focusAttemptLevel ? <span className={lp(focusAttemptLevel)}>{tc(focusAttemptLevel)}</span> : null}
                </div>
              </div>

              <div className="student-records__body">
                <div className="student-records__table">
                  <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
                    <table className="admin-table">
                      <thead><tr><th>Date</th><th>Level</th><th>Score</th><th>Result</th><th></th></tr></thead>
                      <tbody>
                        {dash?.pastScores.map((attemptSummary) => (
                          <tr
                            className={`attempt-row ${focusAttemptId === attemptSummary.id ? "attempt-row--active" : ""}`}
                            key={attemptSummary.id}
                            onClick={() => void loadAttempt(attemptSummary.id)}
                          >
                            <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{new Date(attemptSummary.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                            <td><span className={lp(attemptSummary.level)}>{tc(attemptSummary.level)}</span></td>
                            <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{attemptSummary.score}/{attemptSummary.totalQuestions}</td>
                            <td><span className={pc(attemptSummary.performanceLabel)}>{attemptSummary.performanceLabel}</span></td>
                            <td><button className="button button--sm" onClick={(event) => { event.stopPropagation(); void loadAttempt(attemptSummary.id, true); }} type="button">Review</button></td>
                          </tr>
                        ))}
                        {!dash?.pastScores.length ? <tr><td colSpan={5} className="empty-state">No attempts yet.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <aside className="student-records__focus" ref={resultRef}>
                  {focusAttemptScore !== null && focusAttemptTotal !== null ? (
                    <>
                      <div className="student-records__focus-head">
                        <span className="eyebrow">{attempt ? "Loaded attempt" : "Latest result"}</span>
                        <span className={focusAttemptLabel ? pc(focusAttemptLabel) : "pill"}>{focusAttemptLabel ?? "No result"}</span>
                      </div>

                      <div className="score-display">
                        <ScoreRing score={focusAttemptScore} total={focusAttemptTotal} />
                        <div className="student-records__focus-meta">
                          <strong>{focusAttemptScore}/{focusAttemptTotal}</strong>
                          <span>{focusAttemptDate ? new Date(focusAttemptDate).toLocaleString() : "No completion date"}</span>
                        </div>
                      </div>

                      <div className="inline-metrics">
                        {focusAttemptLevel ? <span className={lp(focusAttemptLevel)}>{tc(focusAttemptLevel)}</span> : null}
                        {attempt ? <span className="pill pill--indigo">Accuracy {(attempt.accuracy * 100).toFixed(1)}%</span> : null}
                        {attempt ? <span className="pill pill--sky">Line {(attempt.lineAccuracy * 100).toFixed(1)}%</span> : <span className="pill">{latestAttempt ? `${(latestAttempt.percentage * 100).toFixed(1)}% score` : "No score"}</span>}
                      </div>

                      <div className="student-records__focus-actions">
                        {attempt ? (
                          <button className="button button--primary button--block" onClick={() => { setReviewOpen((current) => !current); setRIdx(0); }} type="button">
                            {reviewOpen ? "Hide Review" : "Review Answers"}
                          </button>
                        ) : latestAttempt ? (
                          <button className="button button--primary button--block" onClick={() => void loadAttempt(latestAttempt.id, true)} type="button">
                            Open Latest Review
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="student-records__focus-empty">
                      <span className="eyebrow">Review</span>
                      <h3>Select an attempt</h3>
                      <p className="section-copy">The marked answer review opens here after you choose a completed exam.</p>
                    </div>
                  )}
                </aside>
              </div>
            </section>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {section === "results" && attempt && reviewOpen && rq ? (
        <motion.article
          animate={{ opacity: 1, y: 0 }}
          className={`panel result-card student-review-shell ${rq.isCorrect ? "result-card--correct" : ""}`}
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          ref={reviewRef}
          transition={panelTransition}
        >
          <div className="result-card__head">
            <div>
              <span className="eyebrow">Review {rIdx + 1} / {attempt.questionResults.length}</span>
              <h4>{rq.prompt}</h4>
            </div>
            <span className={wasAttempted(rq) ? (rq.isCorrect ? "pill pill--emerald" : "pill pill--rose") : "pill pill--amber"}>
              {wasAttempted(rq) ? (rq.isCorrect ? "Correct" : "Incorrect") : "Not attempted"}
            </span>
          </div>

          {!wasAttempted(rq) ? (
            <div className="not-attempted-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              No answer was submitted for this question.
            </div>
          ) : null}

          <div className="review-grid">
            <section className="review-table-card">
              <div className="review-table-card__head">
                <strong>Your Answer</strong>
                <span className="pill pill--rose" style={{ fontSize: 11 }}>Cell errors marked</span>
              </div>

              <div className="journal-table-wrap">
                <table className="journal-table">
                  <thead><tr><th>#</th><th>Particular</th><th>Debit</th><th>Credit</th></tr></thead>
                  <tbody>
                    {studentReviewRows(rq).map((row) => (
                      <tr key={`student-review-${row.i}`}>
                        <td>{row.i + 1}</td>
                        <td className={`journal-table__cell journal-table__cell--${row.accountTone}`}>{row.account || "\u2014"}</td>
                        <td className={`journal-table__cell journal-table__cell--${row.debitTone}`} style={{ fontFamily: "var(--font-mono)" }}>{row.debit || "\u2014"}</td>
                        <td className={`journal-table__cell journal-table__cell--${row.creditTone}`} style={{ fontFamily: "var(--font-mono)" }}>{row.credit || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="review-table-card">
              <div className="review-table-card__head">
                <strong>Expected Answer</strong>
                <span className="pill pill--emerald" style={{ fontSize: 11 }}>Reference rows</span>
              </div>

              <div className="journal-table-wrap">
                <table className="journal-table">
                  <thead><tr><th>#</th><th>Particular</th><th>Debit</th><th>Credit</th></tr></thead>
                  <tbody>
                    {correctReviewRows(rq).map((row) => (
                      <tr className={`journal-table__row--${row.state}`} key={`correct-review-${row.i}`}>
                        <td>{row.i + 1}</td>
                        <td>{row.account || "\u2014"}</td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>{row.debit || "\u2014"}</td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>{row.credit || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="pager">
            <button className="button" disabled={rIdx === 0} onClick={() => setRIdx((current) => Math.max(0, current - 1))} type="button">Previous</button>
            <button className="button button--primary" disabled={rIdx === attempt.questionResults.length - 1} onClick={() => setRIdx((current) => Math.min(attempt.questionResults.length - 1, current + 1))} type="button">Next</button>
          </div>
        </motion.article>
      ) : null}
    </motion.section>
  );
}
