import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { AuthStatusResponse, AuthenticatedAdmin, AuthenticatedStudent } from "../shared/types";
import { fetchAuthStatus, logout } from "./api";
import { AuthFlowFieldBackground } from "./components/AuthFlowFieldBackground";
import { AdminPage, type AdminSection } from "./pages/AdminPage";
import { AuthPage } from "./pages/AuthPage";
import { StudentPage, type StudentSection } from "./pages/StudentPage";

type Theme = "dark" | "light";
type AuthView = "student-login" | "student-register" | "admin-login" | "admin-setup";

const logoUrl = new URL("../../skillspark2025.svg", import.meta.url).href;
const PUBLIC_AUTH_PATHS = new Set(["/student/login", "/student/register", "/admin/login", "/admin/setup"]);
const ADMIN_SECTIONS = new Set<AdminSection>(["overview", "questions", "students", "admins"]);
const STUDENT_SECTIONS = new Set<StudentSection>(["overview", "test", "results"]);

function AdminWorkspaceRoute({ user }: { user: AuthenticatedAdmin }) {
  const { section } = useParams<{ section: string }>();

  if (!section || !ADMIN_SECTIONS.has(section as AdminSection)) {
    return <Navigate replace to="/admin/overview" />;
  }

  if (section === "admins" && !user.isSuperAdmin) {
    return <Navigate replace to="/admin/overview" />;
  }

  return <AdminPage section={section as AdminSection} user={user} />;
}

function StudentWorkspaceRoute({ user }: { user: AuthenticatedStudent }) {
  const { section } = useParams<{ section: string }>();

  if (!section || !STUDENT_SECTIONS.has(section as StudentSection)) {
    return <Navigate replace to="/student/overview" />;
  }

  return <StudentPage section={section as StudentSection} user={user} />;
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("jet-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getPublicLinks(adminSetupRequired: boolean) {
  if (adminSetupRequired) {
    return [{ to: "/admin/setup", label: "Admin setup" }];
  }

  return [
    { to: "/student/login", label: "Student" },
    { to: "/student/register", label: "Register" },
    { to: "/admin/login", label: "Admin" }
  ];
}

export function App() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [menuOpen, setMenuOpen] = useState(false);

  const refreshAuth = async () => {
    try {
      setLoading(true);
      const nextStatus = await fetchAuthStatus();
      setAuthStatus(nextStatus);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load auth state.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("jet-theme", theme);
  }, [theme]);

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, authStatus?.user?.role]);

  const handleLogout = async () => {
    await logout();
    await refreshAuth();
  };

  const user = authStatus?.user ?? null;
  const adminSetupRequired = authStatus?.adminSetupRequired ?? false;
  const defaultPublicPath = adminSetupRequired ? "/admin/setup" : "/student/login";
  const adminHomePath = "/admin/overview";
  const studentHomePath = "/student/overview";
  const homePath = user ? (user.role === "admin" ? adminHomePath : studentHomePath) : defaultPublicPath;
  const studentAuthView: AuthView = location.pathname === "/student/register" ? "student-register" : "student-login";
  const navItems = user ? [] : getPublicLinks(adminSetupRequired);
  const workspaceLabel = user ? (user.role === "admin" ? "Admin workspace" : "Student workspace") : "";
  const workspaceKicker = user ? (user.role === "admin" ? "Operations panel" : "Exam panel") : "";
  const isPublicAuthPage = !user && PUBLIC_AUTH_PATHS.has(location.pathname);
  const isAdminWorkspaceRoute = location.pathname.startsWith("/admin/");
  const isStudentWorkspaceRoute = location.pathname.startsWith("/student/") && !PUBLIC_AUTH_PATHS.has(location.pathname);
  const isWorkspaceRoute = Boolean(user) && (isAdminWorkspaceRoute || isStudentWorkspaceRoute);
  const isAdminWorkspacePage = Boolean(user?.role === "admin" && isAdminWorkspaceRoute);
  const routeTransitionKey = isPublicAuthPage
    ? "public-auth"
    : isAdminWorkspaceRoute
      ? "admin-workspace"
      : isStudentWorkspaceRoute
        ? "student-workspace"
        : location.pathname;

  const renderAuthPage = (view: AuthView) => (
    <AuthPage authStatus={authStatus} refreshAuth={refreshAuth} view={view} />
  );

  const renderThemeToggle = () => (
    <button
      className="theme-toggle"
      onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      type="button"
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.25V4.5" />
          <path d="M12 19.5v2.25" />
          <path d="M4.93 4.93l1.6 1.6" />
          <path d="M17.47 17.47l1.6 1.6" />
          <path d="M2.25 12H4.5" />
          <path d="M19.5 12h2.25" />
          <path d="M4.93 19.07l1.6-1.6" />
          <path d="M17.47 6.53l1.6-1.6" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <path d="M21 12.2a8.8 8.8 0 1 1-9.2-9.2 7 7 0 0 0 9.2 9.2z" />
        </svg>
      )}
    </button>
  );

  return (
    <div className={`shell ${user ? "shell--workspace" : "shell--public"} ${isPublicAuthPage ? "shell--public-auth" : ""} ${isAdminWorkspacePage ? "shell--admin-workspace" : ""}`}>
      {!reduceMotion ? (
        <AuthFlowFieldBackground
          className="shell__flow-field"
          colorDark="#5eead4"
          colorLight="#0f766e"
          particleCount={260}
          speed={0.42}
          trailOpacity={0.05}
        />
      ) : null}

      {isPublicAuthPage ? (
        <header className="topbar topbar--simple topbar--bare">
          <Link className="brand brand--logo-only" to={homePath}>
            <img alt="SkillSpark" className="brand__logo brand__logo--header" src={logoUrl} />
          </Link>

          <div className="topbar__actions">
            {renderThemeToggle()}
          </div>
        </header>
      ) : (
        <header className={`topbar ${menuOpen ? "topbar--menu-open" : ""} ${user ? "topbar--bare-workspace" : ""}`}>
          <div className="topbar__main">
            <Link className="brand brand--logo-only" to={homePath}>
              <img alt="SkillSpark" className="brand__logo brand__logo--header" src={logoUrl} />
            </Link>

            {user ? (
              <div className={`topbar__context topbar__context--${user.role}`}>
                <span className="topbar__context-kicker">{workspaceKicker}</span>
                <strong className="topbar__context-title">{workspaceLabel}</strong>
              </div>
            ) : (
              <nav className="topbar__nav" aria-label="Primary">
                {navItems.map((item) => (
                  <NavLink
                    className={({ isActive }) => `topbar__link ${isActive ? "topbar__link--active" : ""}`}
                    key={item.to}
                    to={item.to}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </div>

          <div className="topbar__actions">
            {user ? (
              <span className="pill pill--indigo">
                {user.role === "admin" ? user.name : `${user.name} - ${user.registerNumber}`}
              </span>
            ) : null}

            {renderThemeToggle()}

            {user ? (
              <button className="button button--ghost topbar__signout" onClick={() => void handleLogout()} type="button">
                Sign out
              </button>
            ) : null}

            <button
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="menu-toggle"
              onClick={() => setMenuOpen((prev) => !prev)}
              type="button"
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {menuOpen ? (
              <motion.div
                animate={reduceMotion ? { opacity: 1, height: "auto" } : { opacity: 1, height: "auto" }}
                className="mobile-menu"
                exit={reduceMotion ? { opacity: 0, height: 0 } : { opacity: 0, height: 0 }}
                initial={reduceMotion ? { opacity: 0, height: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {user ? (
                  <div className={`mobile-menu__context mobile-menu__context--${user.role}`}>
                    <span>{workspaceKicker}</span>
                    <strong>{workspaceLabel}</strong>
                  </div>
                ) : null}

                {navItems.length ? (
                  <nav className="mobile-menu__nav" aria-label="Mobile">
                    {navItems.map((item) => (
                      <NavLink
                        className={({ isActive }) => `mobile-menu__link ${isActive ? "mobile-menu__link--active" : ""}`}
                        key={item.to}
                        onClick={() => setMenuOpen(false)}
                        to={item.to}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </nav>
                ) : null}

                <button
                  className="mobile-menu__theme"
                  onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
                  type="button"
                >
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>

                {user ? (
                  <button className="button button--ghost button--block" onClick={() => void handleLogout()} type="button">
                    Sign out
                  </button>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </header>
      )}

      {error ? (
        <div className="app-banner-wrap">
          <div className="banner banner--error">{error}</div>
        </div>
      ) : null}

      <main className={`page ${isPublicAuthPage ? "page--public-auth" : ""} ${isAdminWorkspacePage ? "page--admin-workspace" : ""}`}>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`page-route ${isPublicAuthPage ? "page-route--public-auth" : ""} ${isAdminWorkspacePage ? "page-route--admin-workspace" : ""}`}
            exit={reduceMotion || isWorkspaceRoute ? { opacity: 1, y: 0 } : { opacity: 0, y: -12 }}
            initial={reduceMotion || isWorkspaceRoute ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            key={routeTransitionKey}
            transition={{ duration: reduceMotion || isWorkspaceRoute ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <Routes location={location}>
              <Route path="/" element={<Navigate replace to={homePath} />} />

              <Route
                path="/student/login"
                element={
                  user
                    ? <Navigate replace to={user.role === "admin" ? adminHomePath : studentHomePath} />
                    : adminSetupRequired
                      ? <Navigate replace to="/admin/setup" />
                      : renderAuthPage(studentAuthView)
                }
              />
              <Route
                path="/student/register"
                element={
                  user
                    ? <Navigate replace to={user.role === "admin" ? adminHomePath : studentHomePath} />
                    : adminSetupRequired
                      ? <Navigate replace to="/admin/setup" />
                      : renderAuthPage(studentAuthView)
                }
              />
              <Route
                path="/admin/login"
                element={
                  user
                    ? <Navigate replace to={user.role === "admin" ? adminHomePath : studentHomePath} />
                    : adminSetupRequired
                      ? <Navigate replace to="/admin/setup" />
                      : renderAuthPage("admin-login")
                }
              />
              <Route
                path="/admin/setup"
                element={
                  adminSetupRequired
                    ? renderAuthPage("admin-setup")
                    : user?.role === "admin"
                      ? <Navigate replace to={adminHomePath} />
                      : <Navigate replace to="/admin/login" />
                }
              />

              <Route
                path="/admin"
                element={
                  user?.role === "admin"
                    ? <Navigate replace to={adminHomePath} />
                    : <Navigate replace to={adminSetupRequired ? "/admin/setup" : "/admin/login"} />
                }
              />
              <Route
                path="/admin/:section"
                element={
                  user?.role === "admin"
                    ? <AdminWorkspaceRoute user={user} />
                    : <Navigate replace to={adminSetupRequired ? "/admin/setup" : "/admin/login"} />
                }
              />
              <Route
                path="/student"
                element={
                  user?.role === "student"
                    ? <Navigate replace to={studentHomePath} />
                    : <Navigate replace to={adminSetupRequired ? "/admin/setup" : "/student/login"} />
                }
              />
              <Route
                path="/student/:section"
                element={
                  user?.role === "student"
                    ? <StudentWorkspaceRoute user={user} />
                    : <Navigate replace to={adminSetupRequired ? "/admin/setup" : "/student/login"} />
                }
              />

              <Route path="*" element={<Navigate replace to={homePath} />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
