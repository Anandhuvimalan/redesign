import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import type {
  AdminDashboardResponse,
  AdminListResponse,
  AdminQuestionsResponse,
  AdminRosterEntry,
  AdminStudentsResponse,
  AuthenticatedAdmin,
  Level,
  PaginationMeta,
  Question
} from "../../shared/types";
import { LEVELS } from "../../shared/types";
import {
  bulkDeleteAdminStudents,
  bulkDeleteManagedAdmins,
  bulkDeleteQuestions,
  clearLevel,
  createAdminQuestion,
  createAdminStudent,
  createManagedAdmin,
  deleteAdminStudent,
  deleteManagedAdmin,
  deleteQuestion,
  fetchAdminDashboard,
  fetchAdminList,
  fetchAdminQuestions,
  fetchAdminStudents,
  resetStudentPassword,
  updateAdminQuestion,
  updateAdminStudent,
  updateManagedAdmin,
  updateAdminSettings,
  uploadQuestionWorkbook,
  uploadStudentRoster
} from "../api";

export type AdminSection = "overview" | "questions" | "students" | "admins";

interface AdminPageProps {
  user: AuthenticatedAdmin;
  section: AdminSection;
}

interface DraftAnswerRow {
  account: string;
  debit: string;
  credit: string;
}

interface StudentDraft {
  registerNumber: string;
  name: string;
  password: string;
}

interface AdminDraft {
  name: string;
  username: string;
  password: string;
}

interface PickerOption {
  value: string;
  label: string;
}

const motionEase = [0.22, 1, 0.36, 1] as const;
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const ADMIN_SECTION_META: Record<AdminSection, { label: string; eyebrow: string; title: string; copy: string }> = {
  overview: {
    label: "Overview",
    eyebrow: "Admin workspace",
    title: "Admin workspace",
    copy: ""
  },
  questions: {
    label: "Questions",
    eyebrow: "Question bank",
    title: "Question bank",
    copy: ""
  },
  students: {
    label: "Students",
    eyebrow: "Student access",
    title: "Manage students",
    copy: ""
  },
  admins: {
    label: "Admins",
    eyebrow: "Super admin controls",
    title: "Manage admins",
    copy: ""
  }
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function emptyDraftAnswerRow(): DraftAnswerRow {
  return { account: "", debit: "", credit: "" };
}

function createEmptyQuestionDraft(level: Level = "basic") {
  return {
    level,
    sourceQuestionNo: "",
    prompt: "",
    options: "",
    answerRows: [emptyDraftAnswerRow(), emptyDraftAnswerRow()]
  };
}

function createEmptyStudentDraft(): StudentDraft {
  return {
    registerNumber: "",
    name: "",
    password: ""
  };
}

function createEmptyAdminDraft(): AdminDraft {
  return {
    name: "",
    username: "",
    password: ""
  };
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function levelPill(level: string) {
  if (level === "basic") return "pill pill--emerald";
  if (level === "medium") return "pill pill--amber";
  return "pill pill--rose";
}

function dashboardSummaryLevels(dashboard: AdminDashboardResponse | null) {
  return dashboard?.questionSummary.levels ?? [];
}

function questionToDraft(question: Question) {
  return {
    level: question.level,
    sourceQuestionNo: question.sourceQuestionNo,
    prompt: question.prompt,
    options: question.options.join("\n"),
    answerRows:
      question.answerRows.length > 0
        ? question.answerRows.map((row) => ({
            account: row.account,
            debit: row.debit === null ? "" : String(row.debit),
            credit: row.credit === null ? "" : String(row.credit)
          }))
        : [emptyDraftAnswerRow(), emptyDraftAnswerRow()]
  };
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString();
}

function matchesCurrentPageSelection(ids: string[], selectedIds: string[]) {
  return ids.length > 0 && ids.every((id) => selectedIds.includes(id));
}

function PaginationControls({
  pagination,
  label,
  onPageChange,
  onPageSizeChange
}: {
  pagination: PaginationMeta;
  label: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const start = pagination.totalItems === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.totalItems);

  return (
    <div className="pagination-bar">
      <div className="pagination-bar__summary">
        <strong>{label}</strong>
        <span>
          {start}-{end} of {pagination.totalItems}
        </span>
      </div>

      <div className="pagination-bar__controls">
        <label className="pagination-bar__size">
          <span>Rows</span>
          <select className="input input--compact" onChange={(event) => onPageSizeChange(Number(event.target.value))} value={pagination.pageSize}>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="pagination-bar__buttons">
          <button className="button button--sm" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} type="button">
            Prev
          </button>
          <span className="pill pill--mono">
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            className="button button--sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionPicker({
  options,
  value,
  onChange,
  placeholder,
  allowClear = true
}: {
  options: PickerOption[];
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuActive, setMenuActive] = useState(false);
  const reduceMotion = Boolean(useReducedMotion());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuTransition = { duration: reduceMotion ? 0 : 0.24, ease: motionEase };
  const selectedOption = options.find((option) => option.value === value);
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

  useEffect(() => {
    if (open) {
      setMenuActive(true);
    }
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
  };

  return (
    <div className={`account-picker ${menuActive ? "account-picker--open" : ""}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`account-picker__trigger ${value ? "" : "account-picker__trigger--placeholder"}`}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          setMenuActive(true);
          setOpen(true);
        }}
        type="button"
      >
        <span>{selectedOption?.label || value || placeholder}</span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0, y: open ? 1 : 0 }}
          fill="none"
          height="14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          transition={menuTransition}
          viewBox="0 0 24 24"
          width="14"
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
            onAnimationComplete={(definition) => {
              if (definition === "closed") {
                setMenuActive(false);
              }
            }}
            role="listbox"
            variants={menuVariants}
          >
            {allowClear ? (
              <motion.button
                aria-selected={!value}
                className={`account-picker__option ${!value ? "account-picker__option--active" : ""}`}
                onClick={() => { onChange(""); closeMenu(); }}
                role="option"
                type="button"
                variants={optionVariants}
              >
                Clear selection
              </motion.button>
            ) : null}

            {options.length ? (
              options.map((option) => (
                <motion.button
                  aria-selected={value === option.value}
                  className={`account-picker__option ${value === option.value ? "account-picker__option--active" : ""}`}
                  key={option.value}
                  onClick={() => { onChange(option.value); closeMenu(); }}
                  role="option"
                  type="button"
                  variants={optionVariants}
                >
                  {option.label}
                </motion.button>
              ))
            ) : (
              <motion.button
                className="account-picker__option"
                disabled
                type="button"
                variants={optionVariants}
              >
                No options available
              </motion.button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function AdminPage({ user, section }: AdminPageProps) {
  const reduceMotion = useReducedMotion();
  const meta = ADMIN_SECTION_META[section];
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("admin-console-sidebar") !== "hidden";
  });
  const [isCompactViewport, setIsCompactViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth <= 980;
  });
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [questionsResponse, setQuestionsResponse] = useState<AdminQuestionsResponse | null>(null);
  const [studentsResponse, setStudentsResponse] = useState<AdminStudentsResponse | null>(null);
  const [adminsResponse, setAdminsResponse] = useState<AdminListResponse | null>(null);
  const [levelFilter, setLevelFilter] = useState<Level | undefined>();
  const [questionSearch, setQuestionSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [adminSearch, setAdminSearch] = useState("");
  const [questionPage, setQuestionPage] = useState(1);
  const [studentPage, setStudentPage] = useState(1);
  const [adminPage, setAdminPage] = useState(1);
  const [questionPageSize, setQuestionPageSize] = useState<number>(10);
  const [studentPageSize, setStudentPageSize] = useState<number>(10);
  const [adminPageSize, setAdminPageSize] = useState<number>(10);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedAdminIds, setSelectedAdminIds] = useState<string[]>([]);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [qLimitDraft, setQLimitDraft] = useState("20");
  const [tLimitDraft, setTLimitDraft] = useState("30");
  const [newQuestion, setNewQuestion] = useState(createEmptyQuestionDraft());
  const [newStudent, setNewStudent] = useState(createEmptyStudentDraft());
  const [newAdmin, setNewAdmin] = useState(createEmptyAdminDraft());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pageTransition = { duration: reduceMotion ? 0 : 0.4, ease: motionEase };
  const panelTransition = { duration: reduceMotion ? 0 : 0.34, ease: motionEase };
  const sectionTransition = { duration: reduceMotion ? 0 : 0.4, ease: motionEase };
  const drawerTransition = { duration: reduceMotion ? 0 : 0.52, ease: motionEase };
  const sectionInitial = reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 };
  const sectionAnimate = { opacity: 1, y: 0 };
  const sectionExit = reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 };
  const questions = questionsResponse?.questions ?? [];
  const students = studentsResponse?.students ?? [];
  const admins = adminsResponse?.admins ?? [];
  const levelOptions = useMemo<PickerOption[]>(
    () => LEVELS.map((level) => ({ value: level, label: titleCase(level) })),
    []
  );
  const particularOptions = useMemo<PickerOption[]>(() => {
    const seen = new Set<string>();
    return [...newQuestion.options.split(/\r?\n|,/), ...newQuestion.answerRows.map((row) => row.account)]
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .map((value) => ({ value, label: value }));
  }, [newQuestion.answerRows, newQuestion.options]);
  const selectableAdminIds = admins.filter((adminItem) => adminItem.id !== user.id).map((adminItem) => adminItem.id);
  const totalStudents = dashboard?.studentsCount ?? studentsResponse?.pagination.totalItems ?? 0;
  const totalQuestions = dashboard?.questionSummary.totalQuestions ?? 0;
  const adminsCount = dashboard?.adminsCount ?? (user.isSuperAdmin ? adminsResponse?.pagination.totalItems ?? 1 : 0);
  const levelMax = Math.max(...dashboardSummaryLevels(dashboard).map((entry) => entry.count), 1);
  const allQuestionsSelected = useMemo(
    () => matchesCurrentPageSelection(questions.map((question) => question.id), selectedQuestionIds),
    [questions, selectedQuestionIds]
  );
  const allStudentsSelected = useMemo(
    () => matchesCurrentPageSelection(students.map((student) => student.id), selectedStudentIds),
    [students, selectedStudentIds]
  );
  const allAdminsSelected = useMemo(
    () => matchesCurrentPageSelection(selectableAdminIds, selectedAdminIds),
    [selectableAdminIds, selectedAdminIds]
  );
  const adminNavItems = [
    { key: "overview" as const, to: "/admin/overview", label: "Overview" },
    { key: "questions" as const, to: "/admin/questions", label: "Questions" },
    { key: "students" as const, to: "/admin/students", label: "Students" },
    ...(user.isSuperAdmin ? [{ key: "admins" as const, to: "/admin/admins", label: "Admins" }] : [])
  ];

  const withPending = async <T,>(action: () => Promise<T>): Promise<T> => action();

  const loadDashboard = async () => {
    const nextDashboard = await withPending(() => fetchAdminDashboard());
    setDashboard(nextDashboard);
    setQLimitDraft(String(nextDashboard.settings.questionsPerQuiz));
    setTLimitDraft(String(nextDashboard.settings.timeLimitMinutes));
  };

  const loadQuestions = async () => {
    const response = await withPending(() => fetchAdminQuestions(levelFilter, questionSearch, questionPage, questionPageSize));
    setQuestionsResponse(response);
  };

  const loadStudents = async () => {
    const response = await withPending(() => fetchAdminStudents({ search: studentSearch, page: studentPage, pageSize: studentPageSize }));
    setStudentsResponse(response);
  };

  const loadAdmins = async () => {
    if (!user.isSuperAdmin) {
      setAdminsResponse(null);
      return;
    }

    const response = await withPending(() => fetchAdminList({ search: adminSearch, page: adminPage, pageSize: adminPageSize }));
    setAdminsResponse(response);
  };

  const refreshVisibleData = async () => {
    const tasks: Array<Promise<unknown>> = [loadDashboard()];
    if (section === "questions") tasks.push(loadQuestions());
    if (section === "students") tasks.push(loadStudents());
    if (section === "admins" && user.isSuperAdmin) tasks.push(loadAdmins());
    await Promise.all(tasks);
  };

  useEffect(() => {
    if (dashboard) {
      return;
    }

    void (async () => {
      try {
        await loadDashboard();
        setError("");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load admin workspace.");
      }
    })();
  }, [dashboard]);

  useEffect(() => {
    if (section !== "questions") {
      return;
    }

    void (async () => {
      try {
        await loadQuestions();
        setError("");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load question bank.");
      }
    })();
  }, [section, levelFilter, questionSearch, questionPage, questionPageSize]);

  useEffect(() => {
    if (section !== "students") {
      return;
    }

    void (async () => {
      try {
        await loadStudents();
        setError("");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load students.");
      }
    })();
  }, [section, studentSearch, studentPage, studentPageSize]);

  useEffect(() => {
    if (section !== "admins" || !user.isSuperAdmin) {
      return;
    }

    void (async () => {
      try {
        await loadAdmins();
        setError("");
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load admin accounts.");
      }
    })();
  }, [section, user.isSuperAdmin, adminSearch, adminPage, adminPageSize]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    window.localStorage.setItem("admin-console-sidebar", sidebarOpen ? "visible" : "hidden");
  }, [sidebarOpen]);

  useEffect(() => {
    const handleResize = () => setIsCompactViewport(window.innerWidth <= 980);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setQuestionPage(1);
  }, [levelFilter, questionSearch]);

  useEffect(() => {
    setStudentPage(1);
  }, [studentSearch]);

  useEffect(() => {
    setAdminPage(1);
  }, [adminSearch]);

  const run = async (action: () => Promise<void>, successMessage: string) => {
    try {
      await withPending(action);
      setMessage(successMessage);
      setError("");
      await refreshVisibleData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Action failed.");
    }
  };

  const updateDraftRow = (index: number, field: keyof DraftAnswerRow, value: string) => {
    setNewQuestion((current) => ({
      ...current,
      answerRows: current.answerRows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)
    }));
  };

  const addDraftRow = () => {
    setNewQuestion((current) => ({ ...current, answerRows: [...current.answerRows, emptyDraftAnswerRow()] }));
  };

  const removeDraftRow = (index: number) => {
    setNewQuestion((current) => ({
      ...current,
      answerRows:
        current.answerRows.length === 1
          ? [emptyDraftAnswerRow()]
          : current.answerRows.filter((_, rowIndex) => rowIndex !== index)
    }));
  };

  const buildQuestionPayload = () => {
    const parsedRows = newQuestion.answerRows
      .map((row) => {
        const debit = parseAmount(row.debit);
        const credit = parseAmount(row.credit);

        if ((row.debit.trim() && debit === null) || (row.credit.trim() && credit === null)) {
          throw new Error("Use valid debit and credit amounts.");
        }

        return {
          account: row.account.trim(),
          debit,
          credit
        };
      })
      .filter((row) => row.account || row.debit !== null || row.credit !== null);

    return {
      level: newQuestion.level,
      sourceQuestionNo: newQuestion.sourceQuestionNo.trim() || undefined,
      prompt: newQuestion.prompt,
      options: newQuestion.options
        .split(/\r?\n|,/)
        .map((option) => option.trim())
        .filter(Boolean),
      answerRows: parsedRows
    };
  };

  const submitQuestionDraft = async () => {
    try {
      const payload = buildQuestionPayload();

      await run(async () => {
        if (editingQuestionId) {
          await updateAdminQuestion(editingQuestionId, payload);
        } else {
          await createAdminQuestion(payload);
        }

        setNewQuestion(createEmptyQuestionDraft(payload.level));
        setEditingQuestionId(null);
      }, editingQuestionId ? "Question updated." : "Question added.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save question.");
    }
  };

  const submitStudentDraft = async () => {
    await run(async () => {
      if (editingStudentId) {
        await updateAdminStudent(editingStudentId, {
          registerNumber: newStudent.registerNumber,
          name: newStudent.name,
          password: newStudent.password.trim() || undefined
        });
      } else {
        await createAdminStudent(newStudent.registerNumber, newStudent.name, newStudent.password);
      }

      setNewStudent(createEmptyStudentDraft());
      setEditingStudentId(null);
    }, editingStudentId ? "Student updated." : "Student added.");
  };

  const submitAdminDraft = async () => {
    await run(async () => {
      if (editingAdminId) {
        await updateManagedAdmin(editingAdminId, {
          name: newAdmin.name,
          username: newAdmin.username,
          password: newAdmin.password.trim() || undefined
        });
      } else {
        await createManagedAdmin(newAdmin.name, newAdmin.username, newAdmin.password);
      }

      setNewAdmin(createEmptyAdminDraft());
      setEditingAdminId(null);
    }, editingAdminId ? "Admin updated." : "Admin account added.");
  };

  const toggleQuestionSelection = (id: string) => {
    setSelectedQuestionIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const toggleAllQuestions = () => {
    setSelectedQuestionIds((current) => {
      if (allQuestionsSelected) {
        return current.filter((id) => !questions.some((question) => question.id === id));
      }

      return [...new Set([...current, ...questions.map((question) => question.id)])];
    });
  };

  const toggleStudentSelection = (id: string) => {
    setSelectedStudentIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const toggleAllStudents = () => {
    setSelectedStudentIds((current) => {
      if (allStudentsSelected) {
        return current.filter((id) => !students.some((student) => student.id === id));
      }

      return [...new Set([...current, ...students.map((student) => student.id)])];
    });
  };

  const toggleAdminSelection = (id: string) => {
    setSelectedAdminIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const toggleAllAdmins = () => {
    setSelectedAdminIds((current) => {
      if (allAdminsSelected) {
        return current.filter((id) => !selectableAdminIds.includes(id));
      }

      return [...new Set([...current, ...selectableAdminIds])];
    });
  };

  const beginQuestionEdit = (question: Question) => {
    setEditingQuestionId(question.id);
    setNewQuestion(questionToDraft(question));
  };

  const cancelQuestionEdit = () => {
    setEditingQuestionId(null);
    setNewQuestion(createEmptyQuestionDraft(newQuestion.level));
  };

  const beginStudentEdit = (student: { id: string; registerNumber: string; name: string }) => {
    setEditingStudentId(student.id);
    setNewStudent({ registerNumber: student.registerNumber, name: student.name, password: "" });
  };

  const cancelStudentEdit = () => {
    setEditingStudentId(null);
    setNewStudent(createEmptyStudentDraft());
  };

  const beginAdminEdit = (adminItem: AdminRosterEntry) => {
    setEditingAdminId(adminItem.id);
    setNewAdmin({ name: adminItem.name, username: adminItem.username, password: "" });
  };

  const cancelAdminEdit = () => {
    setEditingAdminId(null);
    setNewAdmin(createEmptyAdminDraft());
  };

  const importQuestionWorkbook = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      await uploadQuestionWorkbook(file);
    }, "Workbook imported.");
  };

  const importStudentRoster = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      await uploadStudentRoster(file);
    }, "Student file imported.");
  };

  const closedContentIndent = isCompactViewport ? 56 : 32;
  const defaultContentIndent = isCompactViewport ? 18 : 32;
  const contentIndent = sidebarOpen ? defaultContentIndent : closedContentIndent;
  const drawerClosedX = -304;
  const desktopRailWidth = isCompactViewport ? "0px" : sidebarOpen ? "286px" : "88px";
  const heroPills = (() => {
    if (section === "overview") {
      return [
        { label: `${totalQuestions} questions`, tone: "amber" as const },
        { label: `${totalStudents} students`, tone: "default" as const },
        ...(user.isSuperAdmin ? [{ label: `${adminsCount} admins`, tone: "default" as const }] : [])
      ];
    }

    if (section === "questions") {
      return [
        { label: `${questionsResponse?.pagination.totalItems ?? totalQuestions} questions`, tone: "amber" as const },
        ...(levelFilter ? [{ label: titleCase(levelFilter), tone: "default" as const }] : []),
        ...(selectedQuestionIds.length ? [{ label: `${selectedQuestionIds.length} selected`, tone: "default" as const }] : [])
      ];
    }

    if (section === "students") {
      return [
        { label: `${studentsResponse?.pagination.totalItems ?? totalStudents} students`, tone: "default" as const },
        ...(selectedStudentIds.length ? [{ label: `${selectedStudentIds.length} selected`, tone: "default" as const }] : [])
      ];
    }

    if (section === "admins") {
      return [
        { label: `${adminsResponse?.pagination.totalItems ?? adminsCount} admins`, tone: "default" as const },
        ...(selectedAdminIds.length ? [{ label: `${selectedAdminIds.length} selected`, tone: "default" as const }] : [])
      ];
    }

    return [] as Array<{ label: string; tone: "amber" | "default" }>;
  })();
  const heroFacts = (() => {
    if (section === "overview") {
      return [
        { label: "Questions", value: String(totalQuestions) },
        { label: "Students", value: String(totalStudents) },
        ...(user.isSuperAdmin ? [{ label: "Admins", value: String(adminsCount) }] : [])
      ];
    }

    return [] as Array<{ label: string; value: string }>;
  })();

  const sectionBody = (() => {
    if (section === "overview") {
      return (
        <motion.section
          animate={sectionAnimate}
          className="admin-stage admin-stage--overview"
          exit={sectionExit}
          initial={sectionInitial}
          key={section}
          transition={sectionTransition}
        >
          <div className="admin-stage__grid admin-stage__grid--three">
            <section className="admin-stage__section">
              <span className="eyebrow">Exam settings</span>
              <h4>Exam configuration</h4>

              <div className="admin-settings-stack">
                <label className="form-field">
                  <span className="form-label">Questions per exam</span>
                  <input className="search-input" inputMode="numeric" onChange={(event) => setQLimitDraft(event.target.value)} value={qLimitDraft} />
                </label>

                <label className="form-field">
                  <span className="form-label">Time limit (min)</span>
                  <input className="search-input" inputMode="numeric" onChange={(event) => setTLimitDraft(event.target.value)} value={tLimitDraft} />
                </label>

                <button
                  className="button button--primary"
                  onClick={() => void run(async () => { await updateAdminSettings(Number(qLimitDraft), Number(tLimitDraft)); }, "Settings saved.")}
                  type="button"
                >
                  Save settings
                </button>
              </div>
            </section>

            <section className="admin-stage__section admin-stage__section--accent">
              <span className="eyebrow">Quick access</span>
              <h4>Jump to the next action.</h4>
              <p className="section-copy">Open the section you need and work there directly.</p>

              <div className="admin-quick-list">
                <Link className="admin-quick-link" to="/admin/questions">
                  <span>Questions</span>
                  <strong>Question bank</strong>
                </Link>
                <Link className="admin-quick-link" to="/admin/students">
                  <span>Students</span>
                  <strong>Student management</strong>
                </Link>
                {user.isSuperAdmin ? (
                  <Link className="admin-quick-link" to="/admin/admins">
                    <span>Admins</span>
                    <strong>Admin accounts</strong>
                  </Link>
                ) : null}
              </div>
            </section>

            <section className="admin-stage__section">
              <span className="eyebrow">Inventory</span>
              <h4>Question distribution</h4>
              <p className="section-copy">Keep an eye on balance across Basic, Medium, and Hard before importing or clearing levels.</p>

              <div className="admin-summary-list">
                {dashboardSummaryLevels(dashboard).map((entry) => (
                  <div className="admin-summary-item" key={entry.level}>
                    <div className="admin-summary-item__head">
                      <span className={levelPill(entry.level)}>{titleCase(entry.level)}</span>
                      <strong>{entry.count}</strong>
                    </div>
                    <div className="admin-summary-item__bar">
                      <span style={{ width: `${(entry.count / levelMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="admin-panel-note">
                Total inventory: <strong>{totalQuestions}</strong> questions.
              </div>
            </section>
          </div>
        </motion.section>
      );
    }

    if (section === "questions") {
      return (
        <motion.section
          animate={sectionAnimate}
          className="admin-stage admin-stage--questions"
          exit={sectionExit}
          initial={sectionInitial}
          key={section}
          transition={sectionTransition}
        >
          <div className="question-workbench">
            <section className="question-workbench__editor admin-stage__section admin-stage__section--soft">
              <div className="question-workbench__head">
                <div className="question-workbench__meta">
                  <span className="eyebrow">{editingQuestionId ? "Edit question" : "Question editor"}</span>
                  <strong>{editingQuestionId ? "Edit question" : "Add question"}</strong>
                </div>

                <div className="filters__actions">
                  <label className="button button--sm upload-button">
                    Bulk upload
                    <input
                      accept=".xlsx"
                      onChange={(event) => {
                        importQuestionWorkbook(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  {editingQuestionId ? (
                    <button className="button button--sm" onClick={cancelQuestionEdit} type="button">
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="question-workbench__editor-grid">
                <label className="form-field">
                  <span className="form-label">Level</span>
                  <OptionPicker
                    allowClear={false}
                    onChange={(next) => setNewQuestion((current) => ({ ...current, level: next as Level }))}
                    options={levelOptions}
                    placeholder="Select level"
                    value={newQuestion.level}
                  />
                </label>

                <label className="form-field">
                  <span className="form-label">Question no.</span>
                  <input className="input" onChange={(event) => setNewQuestion((current) => ({ ...current, sourceQuestionNo: event.target.value }))} placeholder="Auto if left empty" value={newQuestion.sourceQuestionNo} />
                </label>

                <label className="form-field question-workbench__field question-workbench__field--wide">
                  <span className="form-label">Question prompt</span>
                  <textarea className="textarea" onChange={(event) => setNewQuestion((current) => ({ ...current, prompt: event.target.value }))} placeholder="Enter the question text" rows={5} value={newQuestion.prompt} />
                </label>

                <label className="form-field question-workbench__field question-workbench__field--wide">
                  <span className="form-label">Available particulars</span>
                  <textarea className="textarea" onChange={(event) => setNewQuestion((current) => ({ ...current, options: event.target.value }))} placeholder="One per line or comma separated" rows={5} value={newQuestion.options} />
                </label>
              </div>

              <div className="answer-editor question-workbench__answers">
                <div className="review-table-card__head">
                  <strong>Answer rows</strong>
                  <button className="button button--sm" onClick={addDraftRow} type="button">Add row</button>
                </div>

                <div className="table-wrap question-workbench__answers-table">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th style={{ width: 52 }}>#</th>
                        <th>Account</th>
                        <th style={{ width: 140 }}>Debit</th>
                        <th style={{ width: 140 }}>Credit</th>
                        <th style={{ width: 72 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {newQuestion.answerRows.map((row, index) => (
                        <tr key={`draft-row-${index}`}>
                          <td style={{ fontFamily: "var(--font-mono)" }}>{index + 1}</td>
                          <td>
                            <OptionPicker
                              onChange={(next) => updateDraftRow(index, "account", next)}
                              options={particularOptions}
                              placeholder="Select particular"
                              value={row.account}
                            />
                          </td>
                          <td><input className="input" inputMode="decimal" onChange={(event) => updateDraftRow(index, "debit", event.target.value)} placeholder="0.00" value={row.debit} /></td>
                          <td><input className="input" inputMode="decimal" onChange={(event) => updateDraftRow(index, "credit", event.target.value)} placeholder="0.00" value={row.credit} /></td>
                          <td><button className="button button--sm" onClick={() => removeDraftRow(index)} type="button">Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="answer-editor__actions">
                  <button className="button button--primary" onClick={() => void submitQuestionDraft()} type="button">
                    {editingQuestionId ? "Save question" : "Add question"}
                  </button>
                </div>
              </div>
            </section>

            <section className="question-workbench__list admin-stage__section admin-stage__section--soft">
              <div className="question-workbench__head">
                <div className="question-workbench__meta">
                  <span className="eyebrow">Question list</span>
                  <strong>{questionsResponse?.pagination.totalItems ?? 0} questions</strong>
                </div>

                <div className="question-workbench__summary">
                  <span className="pill pill--amber">{questions.length} visible</span>
                  {selectedQuestionIds.length ? <span className="pill">{selectedQuestionIds.length} selected</span> : null}
                  {levelFilter ? <span className={levelPill(levelFilter)}>{titleCase(levelFilter)}</span> : null}
                </div>
              </div>

              <div className="question-workbench__toolbar">
                <div className="filters__search">
                  <svg className="filters__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" x2="16.65" y1="21" y2="16.65" />
                  </svg>
                  <input
                    className="search-input"
                    onChange={(event) => setQuestionSearch(event.target.value)}
                    placeholder="Search all question fields or use level:hard account:cash"
                    value={questionSearch}
                  />
                </div>

                <div className="question-workbench__toolbar-row">
                  <div className="filter-strip">
                    <button className={`filter-chip ${levelFilter === undefined ? "filter-chip--active" : ""}`} onClick={() => setLevelFilter(undefined)} type="button">
                      All levels
                    </button>
                    {LEVELS.map((level) => (
                      <button className={`filter-chip ${levelFilter === level ? "filter-chip--active" : ""}`} key={level} onClick={() => setLevelFilter(level)} type="button">
                        {titleCase(level)}
                      </button>
                    ))}
                  </div>

                  <div className="filters__actions">
                    <button className="button button--sm" onClick={toggleAllQuestions} type="button">
                      {allQuestionsSelected ? "Deselect page" : "Select page"}
                    </button>
                    <button
                      className="button button--sm button--danger"
                      disabled={!selectedQuestionIds.length}
                      onClick={() => {
                        if (!window.confirm(`Delete ${selectedQuestionIds.length} questions?`)) return;
                        void run(async () => {
                          await bulkDeleteQuestions(selectedQuestionIds);
                          setSelectedQuestionIds([]);
                        }, `${selectedQuestionIds.length} questions deleted.`);
                      }}
                      type="button"
                    >
                      Delete ({selectedQuestionIds.length})
                    </button>
                    <button
                      className="button button--sm button--danger"
                      disabled={!levelFilter}
                      onClick={() => {
                        if (!levelFilter || !window.confirm(`Delete all ${titleCase(levelFilter)} questions?`)) return;
                        void run(async () => {
                          await clearLevel(levelFilter);
                          setSelectedQuestionIds([]);
                        }, `${titleCase(levelFilter)} level cleared.`);
                      }}
                      type="button"
                    >
                      Clear level
                    </button>
                  </div>
                </div>
              </div>

              <div className="table-wrap admin-scroll-table question-workbench__table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}></th>
                      <th style={{ width: 56 }}>No</th>
                      <th style={{ width: 78 }}>Level</th>
                      <th>Prompt</th>
                      <th style={{ width: 82 }}>Rows</th>
                      <th style={{ width: 110 }}>Updated</th>
                      <th style={{ width: 152 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((question) => (
                      <tr key={question.id}>
                        <td><input checked={selectedQuestionIds.includes(question.id)} onChange={() => toggleQuestionSelection(question.id)} type="checkbox" /></td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{question.sourceQuestionNo}</td>
                        <td><span className={levelPill(question.level)} style={{ fontSize: 11 }}>{titleCase(question.level)}</span></td>
                        <td className="admin-table__prompt">{question.prompt}</td>
                        <td style={{ fontFamily: "var(--font-mono)", textAlign: "center" }}>{question.answerRows.length}</td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatShortDate(question.importedAt)}</td>
                        <td>
                          <div className="admin-table__actions">
                            <button className="button button--sm" onClick={() => beginQuestionEdit(question)} type="button">
                              Edit
                            </button>
                            <button
                              className="button button--sm button--danger"
                              onClick={() => {
                                if (!window.confirm("Delete this question?")) return;
                                void run(async () => {
                                  await deleteQuestion(question.id);
                                  setSelectedQuestionIds((current) => current.filter((id) => id !== question.id));
                                }, "Question deleted.");
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!questions.length ? <tr><td className="empty-state" colSpan={7}>No questions match the current filter.</td></tr> : null}
                  </tbody>
                </table>
              </div>

              {questionsResponse ? (
                <PaginationControls
                  label={`Questions${levelFilter ? ` / ${titleCase(levelFilter)}` : ""}`}
                  onPageChange={setQuestionPage}
                  onPageSizeChange={(pageSize) => {
                    setQuestionPageSize(pageSize);
                    setQuestionPage(1);
                  }}
                  pagination={questionsResponse.pagination}
                />
              ) : null}
            </section>
          </div>
        </motion.section>
      );
    }

    if (section === "students") {
      return (
        <motion.section
          animate={sectionAnimate}
          className="admin-stage"
          exit={sectionExit}
          initial={sectionInitial}
          key={section}
          transition={sectionTransition}
        >
          <div className="admin-student-grid">
            <div className="table-panel__head table-panel__head--compact admin-inline-head">
              <div>
                <span className="eyebrow">{editingStudentId ? "Edit student" : "Student editor"}</span>
                <strong>{editingStudentId ? "Edit student" : "Add student"}</strong>
              </div>

              <div className="filters__actions">
                <label className="button button--sm upload-button">
                  Bulk upload
                  <input
                    accept=".csv,.txt,.xlsx"
                    onChange={(event) => {
                      importStudentRoster(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
                {editingStudentId ? (
                  <button className="button button--sm" onClick={cancelStudentEdit} type="button">
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>

            <label className="form-field">
              <span className="form-label">Register number</span>
              <input className="input" onChange={(event) => setNewStudent((current) => ({ ...current, registerNumber: event.target.value }))} placeholder="Student register number" value={newStudent.registerNumber} />
            </label>

            <label className="form-field">
              <span className="form-label">Full name</span>
              <input className="input" onChange={(event) => setNewStudent((current) => ({ ...current, name: event.target.value }))} placeholder="Student full name" value={newStudent.name} />
            </label>

            <label className="form-field">
              <span className="form-label">{editingStudentId ? "New password (optional)" : "Password"}</span>
              <input className="input" onChange={(event) => setNewStudent((current) => ({ ...current, password: event.target.value }))} placeholder={editingStudentId ? "Leave empty to keep current password" : "Minimum 8 characters"} type="password" value={newStudent.password} />
            </label>

            <div className="admin-form-actions">
              <button className="button button--primary" onClick={() => void submitStudentDraft()} type="button">
                {editingStudentId ? "Save student" : "Add student"}
              </button>
            </div>
          </div>

          <div className="admin-stage__divider" />

          <div className="filters__actions">
            <div className="filters__search">
              <svg className="filters__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
              </svg>
              <input
                className="search-input"
                onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="Search all student fields or use reg: / status: / attempts:"
                value={studentSearch}
              />
            </div>
            <button className="button button--sm" onClick={toggleAllStudents} type="button">
              {allStudentsSelected ? "Deselect page" : "Select page"}
            </button>
            {user.isSuperAdmin ? (
              <button
                className="button button--sm button--danger"
                disabled={!selectedStudentIds.length}
                onClick={() => {
                  if (!window.confirm(`Remove ${selectedStudentIds.length} selected students?`)) return;
                  void run(async () => {
                    await bulkDeleteAdminStudents(selectedStudentIds);
                    setSelectedStudentIds([]);
                  }, `${selectedStudentIds.length} students removed.`);
                }}
                type="button"
              >
                Remove selected ({selectedStudentIds.length})
              </button>
            ) : null}
          </div>

          <div className="admin-stage__divider" />

          <div className="table-wrap admin-scroll-table">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Register No.</th>
                  <th>Name</th>
                  <th>Password</th>
                  <th>Attempts</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td><input checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudentSelection(student.id)} type="checkbox" /></td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{student.registerNumber}</td>
                    <td>{student.name}</td>
                    <td>
                      <span className={student.hasPassword ? "pill pill--emerald" : "pill pill--rose"} style={{ fontSize: 11 }}>
                        {student.hasPassword ? "Active" : "Not set"}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{student.attemptsCount}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatShortDate(student.updatedAt)}</td>
                    <td>
                      <div className="admin-table__actions">
                        <button className="button button--sm" onClick={() => beginStudentEdit(student)} type="button">
                          Edit
                        </button>
                        <button
                          className="button button--sm"
                          onClick={() => {
                            if (!window.confirm(`Reset password for ${student.name}?`)) return;
                            void run(async () => { await resetStudentPassword(student.id); }, `Password reset for ${student.name}.`);
                          }}
                          type="button"
                        >
                          Reset
                        </button>
                        {user.isSuperAdmin ? (
                          <button
                            className="button button--sm button--danger"
                            onClick={() => {
                              if (!window.confirm(`Remove ${student.name}? This also clears attempts.`)) return;
                              void run(async () => {
                                await deleteAdminStudent(student.id);
                                setSelectedStudentIds((current) => current.filter((id) => id !== student.id));
                              }, `${student.name} removed.`);
                            }}
                            type="button"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!students.length ? <tr><td className="empty-state" colSpan={7}>No students match the current filter.</td></tr> : null}
              </tbody>
            </table>
          </div>

          {studentsResponse ? (
            <PaginationControls
              label="Students"
              onPageChange={setStudentPage}
              onPageSizeChange={(pageSize) => {
                setStudentPageSize(pageSize);
                setStudentPage(1);
              }}
              pagination={studentsResponse.pagination}
            />
          ) : null}
        </motion.section>
      );
    }

    return (
      <motion.section
        animate={sectionAnimate}
        className="admin-stage"
        exit={sectionExit}
        initial={sectionInitial}
        key={section}
        transition={sectionTransition}
      >
        <div className="admin-student-grid">
          <div className="table-panel__head table-panel__head--compact admin-inline-head">
            <div>
              <span className="eyebrow">{editingAdminId ? "Edit admin" : "Admin editor"}</span>
              <strong>{editingAdminId ? "Edit admin" : "Add admin"}</strong>
            </div>

            {editingAdminId ? (
              <button className="button button--sm" onClick={cancelAdminEdit} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <label className="form-field">
            <span className="form-label">Admin name</span>
            <input className="input" onChange={(event) => setNewAdmin((current) => ({ ...current, name: event.target.value }))} placeholder="Full name" value={newAdmin.name} />
          </label>

          <label className="form-field">
            <span className="form-label">Username</span>
            <input className="input" autoComplete="username" onChange={(event) => setNewAdmin((current) => ({ ...current, username: event.target.value }))} placeholder="Username" value={newAdmin.username} />
          </label>

          <label className="form-field">
            <span className="form-label">{editingAdminId ? "New password (optional)" : "Password"}</span>
            <input className="input" autoComplete="new-password" onChange={(event) => setNewAdmin((current) => ({ ...current, password: event.target.value }))} placeholder={editingAdminId ? "Leave empty to keep current password" : "Minimum 8 characters"} type="password" value={newAdmin.password} />
          </label>

          <div className="admin-form-actions">
            <button className="button button--primary" onClick={() => void submitAdminDraft()} type="button">
              {editingAdminId ? "Save admin" : "Add admin"}
            </button>
          </div>
        </div>

        <div className="admin-stage__divider" />

        <div className="filters__actions">
          <div className="filters__search">
            <svg className="filters__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" x2="16.65" y1="21" y2="16.65" />
            </svg>
            <input
              className="search-input"
              onChange={(event) => setAdminSearch(event.target.value)}
              placeholder="Search all admin fields or use user: / access:"
              value={adminSearch}
            />
          </div>
          <button className="button button--sm" onClick={toggleAllAdmins} type="button">
            {allAdminsSelected ? "Deselect page" : "Select page"}
          </button>
          <button
            className="button button--sm button--danger"
            disabled={!selectedAdminIds.length}
            onClick={() => {
              if (!window.confirm(`Remove ${selectedAdminIds.length} selected admin accounts?`)) return;
              void run(async () => {
                await bulkDeleteManagedAdmins(selectedAdminIds);
                setSelectedAdminIds([]);
              }, `${selectedAdminIds.length} admin accounts removed.`);
            }}
            type="button"
          >
            Remove selected ({selectedAdminIds.length})
          </button>
        </div>

        <div className="admin-stage__divider" />

        <div className="table-wrap admin-scroll-table">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>Name</th>
                <th>Username</th>
                <th>Access</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td>
                    <input
                      checked={selectedAdminIds.includes(admin.id)}
                      disabled={admin.id === user.id}
                      onChange={() => toggleAdminSelection(admin.id)}
                      type="checkbox"
                    />
                  </td>
                  <td>{admin.name}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{admin.username}</td>
                  <td><span className={admin.isSuperAdmin ? "pill pill--indigo" : "pill"}>{admin.isSuperAdmin ? "Super admin" : "Admin"}</span></td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{formatShortDate(admin.updatedAt)}</td>
                  <td>
                    <div className="admin-table__actions">
                      <button className="button button--sm" onClick={() => beginAdminEdit(admin)} type="button">
                        Edit
                      </button>
                      {admin.id === user.id ? (
                        <span className="pill">Current</span>
                      ) : (
                        <button
                          className="button button--sm button--danger"
                          onClick={() => {
                            if (!window.confirm(`Remove admin account for ${admin.name}?`)) return;
                            void run(async () => {
                              await deleteManagedAdmin(admin.id);
                              setSelectedAdminIds((current) => current.filter((id) => id !== admin.id));
                            }, `${admin.name} removed.`);
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!admins.length ? <tr><td className="empty-state" colSpan={6}>No admin accounts match the current filter.</td></tr> : null}
            </tbody>
          </table>
        </div>

        {adminsResponse ? (
          <PaginationControls
            label="Admins"
            onPageChange={setAdminPage}
            onPageSizeChange={(pageSize) => {
              setAdminPageSize(pageSize);
              setAdminPage(1);
            }}
            pagination={adminsResponse.pagination}
          />
        ) : null}
      </motion.section>
    );
  })();

  return (
    <motion.section
      animate={{ opacity: 1, y: 0, ["--admin-rail-width" as any]: desktopRailWidth }}
      className="admin-console"
      initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
      transition={pageTransition}
    >
      <motion.aside
        animate={
          isCompactViewport
            ? { opacity: sidebarOpen ? 1 : 0, x: sidebarOpen ? 0 : drawerClosedX }
            : { opacity: 1, x: 0 }
        }
        aria-hidden={isCompactViewport ? !sidebarOpen : false}
        className={`admin-console__rail ${isCompactViewport ? "admin-console__rail--overlay" : ""}`}
        initial={false}
        style={{ pointerEvents: isCompactViewport ? (sidebarOpen ? "auto" : "none") : "auto" }}
        transition={drawerTransition}
      >
        <AnimatePresence initial={false} mode="wait">
          {sidebarOpen || isCompactViewport ? (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="admin-console__rail-inner"
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18 }}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -18 }}
              key="rail-open"
              transition={drawerTransition}
            >
              <div className="admin-console__rail-head">
                <div className="admin-console__brand">
                  <span className="eyebrow">Admin panel</span>
                  <strong>{user.isSuperAdmin ? "Super admin workspace" : "Admin workspace"}</strong>
                  <p>Journal exam control surface</p>
                </div>

                <button
                  aria-label="Close sidebar"
                  className="admin-console__rail-toggle"
                  onClick={() => setSidebarOpen(false)}
                  type="button"
                >
                  <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>

              <div className="admin-console__profile">
                <span className={user.isSuperAdmin ? "pill pill--indigo" : "pill"}>{user.isSuperAdmin ? "Super admin" : "Admin"}</span>
                <strong>{user.name}</strong>
                <span>{user.username}</span>
              </div>

              <nav aria-label="Admin workspace" className="admin-workspace-nav admin-workspace-nav--sidebar">
                {adminNavItems.map((item) => (
                  <NavLink className={({ isActive }) => `admin-workspace-nav__link ${isActive ? "admin-workspace-nav__link--active" : ""}`} key={item.key} to={item.to}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </motion.div>
          ) : (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="admin-console__rail-stub"
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10 }}
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -10 }}
              key="rail-closed"
              transition={drawerTransition}
            >
              <button
                aria-expanded={sidebarOpen}
                aria-label="Open sidebar"
                className="button button--ghost admin-console__stub-toggle"
                onClick={() => setSidebarOpen(true)}
                type="button"
              >
                <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path d="M4 7h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  <path d="M4 12h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  <path d="M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>

      <motion.div
        animate={reduceMotion ? { paddingLeft: contentIndent } : { paddingLeft: contentIndent }}
        className="admin-console__main"
        initial={false}
        transition={drawerTransition}
      >
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="section-head admin-console__hero"
          initial={reduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
          transition={panelTransition}
        >
          <div className="section-head__top">
            <div className="admin-console__hero-main">
              {!sidebarOpen && isCompactViewport ? (
                <button
                  aria-expanded={sidebarOpen}
                  aria-label="Open sidebar"
                  className="button button--ghost admin-console__toggle"
                  onClick={() => setSidebarOpen(true)}
                  type="button"
                >
                  <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path d="M4 7h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                    <path d="M4 12h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                    <path d="M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                </button>
              ) : null}

              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  animate={sectionAnimate}
                  className="section-head__info"
                  exit={sectionExit}
                  initial={sectionInitial}
                  key={`hero-${section}`}
                  transition={sectionTransition}
                >
                  <span className="eyebrow">{meta.eyebrow}</span>
                  <h2>{meta.title}</h2>
                  {meta.copy ? <p className="section-copy">{meta.copy}</p> : null}
                </motion.div>
              </AnimatePresence>
            </div>

            {heroPills.length ? (
              <div className="section-head__metrics">
                {heroPills.map((pill) => (
                  <span className={pill.tone === "amber" ? "pill pill--amber" : "pill"} key={pill.label}>
                    {pill.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {heroFacts.length ? (
            <div className="hero-strip">
              {heroFacts.map((item) => (
                <div className="hero-strip__item" key={item.label}>
                  <span className="hero-strip__label">{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </motion.div>

        <div className="admin-console__content">
          {message ? <div className="banner banner--success">{message}</div> : null}
          {error ? <div className="banner banner--error">{error}</div> : null}
          <AnimatePresence initial={false} mode="wait">
            {sectionBody}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.section>
  );
}
