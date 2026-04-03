import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_QUIZ_QUESTION_COUNT,
  DEFAULT_QUIZ_TIME_LIMIT_MINUTES,
  type AdminRosterEntry,
  type AttemptDetail,
  type AttemptSummary,
  type AuthenticatedAdmin,
  type AuthenticatedStudent,
  type AuthenticatedUser,
  type Level,
  type PaginationMeta,
  type PerformanceLabel,
  type QuizSettings,
  type StudentImportResponse,
  type StudentRosterEntry,
  type UpdateAdminRequest,
  type UpdateStudentRequest
} from "../../shared/types";
import {
  createSessionToken,
  getSessionMaxAgeSeconds,
  hashPassword,
  hashToken,
  validatePassword,
  verifyPassword
} from "../services/security";
import type { ImportedStudent } from "../import/student-roster";

interface PasswordCredential {
  passwordHash: string | null;
  passwordSalt: string | null;
}

interface AdminRecord extends PasswordCredential {
  id: string;
  username: string;
  name: string;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StudentRecord extends PasswordCredential {
  id: string;
  registerNumber: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  role: "admin" | "student";
  createdAt: string;
  expiresAt: string;
}

interface QuizSessionRecord {
  id: string;
  studentId: string;
  level: Level;
  questionIds: string[];
  createdAt: string;
  expiresAt: string;
}

interface AttemptRecord {
  id: string;
  studentId: string;
  level: Level;
  score: number;
  totalQuestions: number;
  percentage: number;
  performanceLabel: PerformanceLabel;
  completedAt: string;
  results: Omit<AttemptDetail, "attemptId" | "score" | "performanceLabel" | "completedAt">;
}

interface PlatformData {
  version: number;
  settings: QuizSettings;
  admins: AdminRecord[];
  students: StudentRecord[];
  sessions: SessionRecord[];
  quizSessions: QuizSessionRecord[];
  attempts: AttemptRecord[];
}

const EMPTY_PLATFORM_DATA: PlatformData = {
  version: 1,
  settings: {
    questionsPerQuiz: DEFAULT_QUIZ_QUESTION_COUNT,
    timeLimitMinutes: DEFAULT_QUIZ_TIME_LIMIT_MINUTES
  },
  admins: [],
  students: [],
  sessions: [],
  quizSessions: [],
  attempts: []
};

function nowIso(): string {
  return new Date().toISOString();
}

function toAttemptSummary(record: AttemptRecord): AttemptSummary {
  return {
    id: record.id,
    level: record.level,
    score: record.score,
    totalQuestions: record.totalQuestions,
    percentage: record.percentage,
    performanceLabel: record.performanceLabel,
    completedAt: record.completedAt
  };
}

function getPerformanceLabel(score: number, totalQuestions: number): PerformanceLabel {
  if (totalQuestions === 0) {
    return "Poor";
  }

  const percentage = score / totalQuestions;

  if (percentage < 0.4) {
    return "Poor";
  }

  if (percentage < 0.7) {
    return "Good";
  }

  if (percentage < 0.9) {
    return "Very Good";
  }

  return "Excellent";
}

interface SearchToken {
  field: string | null;
  value: string;
}

function tokenizeSearch(search?: string): SearchToken[] {
  if (!search?.trim()) {
    return [];
  }

  const matches = search.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches
    .map((token) => token.replace(/^"|"$/g, "").trim())
    .filter(Boolean)
    .map((token) => {
      const separatorIndex = token.indexOf(":");
      if (separatorIndex <= 0) {
        return { field: null, value: token.toLowerCase() };
      }

      return {
        field: token.slice(0, separatorIndex).toLowerCase(),
        value: token.slice(separatorIndex + 1).trim().toLowerCase()
      };
    })
    .filter((token) => token.value);
}

function paginateItems<T>(items: T[], page = 1, pageSize = 10): { items: T[]; pagination: PaginationMeta } {
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;

  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    pagination: {
      page: currentPage,
      pageSize: safePageSize,
      totalItems,
      totalPages
    }
  };
}

function matchesValue(entries: Array<string | number | boolean>, value: string): boolean {
  return entries.some((entry) => String(entry).toLowerCase().includes(value));
}

export class PlatformStore {
  private data: PlatformData | null = null;

  constructor(private readonly dataFilePath: string) {}

  async initialize(): Promise<void> {
    if (this.data) {
      return;
    }

    try {
      const raw = await readFile(this.dataFilePath, "utf8");
      this.data = JSON.parse(raw) as PlatformData;
    } catch {
      this.data = { ...EMPTY_PLATFORM_DATA, settings: { ...EMPTY_PLATFORM_DATA.settings } };
      await this.persist();
    }

    this.data.settings = {
      questionsPerQuiz: this.data.settings?.questionsPerQuiz ?? DEFAULT_QUIZ_QUESTION_COUNT,
      timeLimitMinutes: this.data.settings?.timeLimitMinutes ?? DEFAULT_QUIZ_TIME_LIMIT_MINUTES
    };
    this.data.admins = (this.data.admins ?? []).map((admin) => ({
      ...admin,
      isSuperAdmin: typeof admin.isSuperAdmin === "boolean" ? admin.isSuperAdmin : false
    }));
    if (this.data.admins.length > 0 && !this.data.admins.some((admin) => admin.isSuperAdmin)) {
      this.data.admins[0].isSuperAdmin = true;
    }
    this.pruneExpired();
    await this.persist();
  }

  adminSetupRequired(): boolean {
    return this.requireData().admins.length === 0;
  }

  getSettings(): QuizSettings {
    return { ...this.requireData().settings };
  }

  async updateSettings(nextSettings: QuizSettings): Promise<void> {
    const data = this.requireData();
    data.settings.questionsPerQuiz = nextSettings.questionsPerQuiz;
    data.settings.timeLimitMinutes = nextSettings.timeLimitMinutes;
    await this.persist();
  }

  async bootstrapAdmin(name: string, username: string, password: string): Promise<{ token: string; user: AuthenticatedAdmin }> {
    const data = this.requireData();

    if (data.admins.length > 0) {
      throw new Error("Admin setup has already been completed.");
    }

    if (!name.trim() || !username.trim()) {
      throw new Error("Admin name and username are required.");
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const { hash, salt } = await hashPassword(password);
    const timestamp = nowIso();
    const admin: AdminRecord = {
      id: randomUUID(),
      name: name.trim(),
      username: username.trim().toLowerCase(),
      isSuperAdmin: true,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    data.admins.push(admin);
    const session = this.createSession(admin.id, "admin");
    await this.persist();

    return {
      token: session.token,
      user: this.toAuthenticatedAdmin(admin)
    };
  }

  async loginAdmin(username: string, password: string): Promise<{ token: string; user: AuthenticatedAdmin }> {
    const data = this.requireData();
    const admin = data.admins.find((candidate) => candidate.username === username.trim().toLowerCase());

    if (!admin || !admin.passwordHash || !admin.passwordSalt) {
      throw new Error("Invalid admin credentials.");
    }

    const valid = await verifyPassword(password, admin.passwordSalt, admin.passwordHash);
    if (!valid) {
      throw new Error("Invalid admin credentials.");
    }

    const session = this.createSession(admin.id, "admin");
    await this.persist();

    return {
      token: session.token,
      user: this.toAuthenticatedAdmin(admin)
    };
  }

  async loginStudent(registerNumber: string, password: string): Promise<{ token: string; user: AuthenticatedStudent }> {
    const student = this.requireData().students.find(
      (candidate) => candidate.registerNumber.toLowerCase() === registerNumber.trim().toLowerCase()
    );

    if (!student || !student.passwordHash || !student.passwordSalt) {
      throw new Error("Invalid student credentials.");
    }

    const valid = await verifyPassword(password, student.passwordSalt, student.passwordHash);
    if (!valid) {
      throw new Error("Invalid student credentials.");
    }

    const session = this.createSession(student.id, "student");
    await this.persist();

    return {
      token: session.token,
      user: this.toAuthenticatedStudent(student)
    };
  }

  async registerStudent(registerNumber: string, name: string, password: string): Promise<{ token: string; user: AuthenticatedStudent }> {
    const normalizedRegisterNumber = registerNumber.trim();
    const normalizedName = name.trim();
    const student = this.requireData().students.find(
      (candidate) => candidate.registerNumber.toLowerCase() === normalizedRegisterNumber.toLowerCase()
    );

    if (!student) {
      throw new Error("Student record not found. Ask the admin to add you first.");
    }

    if (student.passwordHash || student.passwordSalt) {
      throw new Error("Password already exists for this student. Use login instead.");
    }

    if (!normalizedName) {
      throw new Error("Full name is required.");
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const { hash, salt } = await hashPassword(password);
    student.passwordHash = hash;
    student.passwordSalt = salt;
    student.updatedAt = nowIso();

    const session = this.createSession(student.id, "student");
    await this.persist();

    return {
      token: session.token,
      user: this.toAuthenticatedStudent(student)
    };
  }

  async createStudent(registerNumber: string, name: string, password: string): Promise<StudentRosterEntry> {
    const normalizedRegisterNumber = registerNumber.trim();
    const normalizedName = name.trim();

    if (!normalizedRegisterNumber || !normalizedName) {
      throw new Error("Register number and student name are required.");
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const data = this.requireData();
    const existing = data.students.find(
      (candidate) => candidate.registerNumber.toLowerCase() === normalizedRegisterNumber.toLowerCase()
    );
    const { hash, salt } = await hashPassword(password);
    const timestamp = nowIso();

    if (existing) {
      if (existing.passwordHash || existing.passwordSalt) {
        throw new Error("This student already has access. Use reset password instead.");
      }

      existing.name = normalizedName;
      existing.passwordHash = hash;
      existing.passwordSalt = salt;
      existing.updatedAt = timestamp;
      await this.persist();
      return this.listStudents().find((student) => student.id === existing.id) as StudentRosterEntry;
    }

    const student: StudentRecord = {
      id: randomUUID(),
      registerNumber: normalizedRegisterNumber,
      name: normalizedName,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    data.students.push(student);
    await this.persist();
    return this.listStudents().find((entry) => entry.id === student.id) as StudentRosterEntry;
  }

  async createAdmin(name: string, username: string, password: string): Promise<AdminRosterEntry> {
    const normalizedName = name.trim();
    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedName || !normalizedUsername) {
      throw new Error("Admin name and username are required.");
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const data = this.requireData();
    const existing = data.admins.find((candidate) => candidate.username === normalizedUsername);
    if (existing) {
      throw new Error("That admin username is already in use.");
    }

    const { hash, salt } = await hashPassword(password);
    const timestamp = nowIso();
    const admin: AdminRecord = {
      id: randomUUID(),
      name: normalizedName,
      username: normalizedUsername,
      isSuperAdmin: false,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    data.admins.push(admin);
    await this.persist();
    return this.toAdminRosterEntry(admin);
  }

  async logout(sessionToken: string | null): Promise<void> {
    if (!sessionToken) {
      return;
    }

    const tokenHash = hashToken(sessionToken);
    const data = this.requireData();
    data.sessions = data.sessions.filter((session) => session.tokenHash !== tokenHash);
    await this.persist();
  }

  getUserForSession(sessionToken: string | null): AuthenticatedUser | null {
    if (!sessionToken) {
      return null;
    }

    this.pruneExpired();

    const tokenHash = hashToken(sessionToken);
    const session = this.requireData().sessions.find((candidate) => candidate.tokenHash === tokenHash);

    if (!session) {
      return null;
    }

    if (session.role === "admin") {
      const admin = this.requireData().admins.find((candidate) => candidate.id === session.userId);
      return admin ? this.toAuthenticatedAdmin(admin) : null;
    }

    const student = this.requireData().students.find((candidate) => candidate.id === session.userId);
    return student ? this.toAuthenticatedStudent(student) : null;
  }

  listStudents(): StudentRosterEntry[] {
    const data = this.requireData();

    return [...data.students]
      .sort((left, right) => left.registerNumber.localeCompare(right.registerNumber))
      .map((student) => ({
        id: student.id,
        registerNumber: student.registerNumber,
        name: student.name,
        hasPassword: Boolean(student.passwordHash && student.passwordSalt),
        attemptsCount: data.attempts.filter((attempt) => attempt.studentId === student.id).length,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt
      }));
  }

  listStudentsPage(options: { page?: number; pageSize?: number; search?: string }): { students: StudentRosterEntry[]; pagination: PaginationMeta } {
    const tokens = tokenizeSearch(options.search);
    const students = this.listStudents().filter((student) => {
      if (!tokens.length) {
        return true;
      }

      return tokens.every((token) => this.matchesStudentToken(student, token));
    });
    const { items, pagination } = paginateItems(students, options.page, options.pageSize);
    return { students: items, pagination };
  }

  listAdmins(): AdminRosterEntry[] {
    return [...this.requireData().admins]
      .sort((left, right) => {
        if (left.isSuperAdmin !== right.isSuperAdmin) {
          return left.isSuperAdmin ? -1 : 1;
        }

        return left.username.localeCompare(right.username);
      })
      .map((admin) => this.toAdminRosterEntry(admin));
  }

  listAdminsPage(options: { page?: number; pageSize?: number; search?: string }): { admins: AdminRosterEntry[]; pagination: PaginationMeta } {
    const tokens = tokenizeSearch(options.search);
    const admins = this.listAdmins().filter((admin) => {
      if (!tokens.length) {
        return true;
      }

      return tokens.every((token) => this.matchesAdminToken(admin, token));
    });
    const { items, pagination } = paginateItems(admins, options.page, options.pageSize);
    return { admins: items, pagination };
  }

  async importStudents(importedStudents: ImportedStudent[]): Promise<StudentImportResponse> {
    const data = this.requireData();
    const normalizedStudents = importedStudents.filter((student) => student.registerNumber && student.name);
    let created = 0;
    let updated = 0;

    for (const importedStudent of normalizedStudents) {
      const existing = data.students.find(
        (candidate) => candidate.registerNumber.toLowerCase() === importedStudent.registerNumber.toLowerCase()
      );

      if (existing) {
        existing.name = importedStudent.name;
        existing.updatedAt = nowIso();
        updated += 1;
        continue;
      }

      const timestamp = nowIso();
      data.students.push({
        id: randomUUID(),
        registerNumber: importedStudent.registerNumber,
        name: importedStudent.name,
        passwordHash: null,
        passwordSalt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      created += 1;
    }

    await this.persist();

    return {
      created,
      updated,
      totalStudents: data.students.length
    };
  }

  async resetStudentPassword(studentId: string): Promise<void> {
    const data = this.requireData();
    const student = data.students.find((candidate) => candidate.id === studentId);

    if (!student) {
      throw new Error("Student not found.");
    }

    student.passwordHash = null;
    student.passwordSalt = null;
    student.updatedAt = nowIso();
    data.sessions = data.sessions.filter((session) => !(session.role === "student" && session.userId === student.id));
    await this.persist();
  }

  async deleteStudent(studentId: string): Promise<void> {
    const data = this.requireData();
    const student = data.students.find((candidate) => candidate.id === studentId);

    if (!student) {
      throw new Error("Student not found.");
    }

    data.students = data.students.filter((candidate) => candidate.id !== studentId);
    data.sessions = data.sessions.filter((session) => !(session.role === "student" && session.userId === studentId));
    data.quizSessions = data.quizSessions.filter((session) => session.studentId !== studentId);
    data.attempts = data.attempts.filter((attempt) => attempt.studentId !== studentId);
    await this.persist();
  }

  async deleteStudents(studentIds: string[]): Promise<number> {
    const uniqueIds = [...new Set(studentIds)];
    let deleted = 0;

    for (const studentId of uniqueIds) {
      const exists = this.requireData().students.some((candidate) => candidate.id === studentId);
      if (!exists) {
        continue;
      }

      await this.deleteStudent(studentId);
      deleted += 1;
    }

    return deleted;
  }

  async updateStudent(studentId: string, payload: UpdateStudentRequest): Promise<StudentRosterEntry> {
    const data = this.requireData();
    const student = data.students.find((candidate) => candidate.id === studentId);

    if (!student) {
      throw new Error("Student not found.");
    }

    const normalizedRegisterNumber = payload.registerNumber.trim();
    const normalizedName = payload.name.trim();
    if (!normalizedRegisterNumber || !normalizedName) {
      throw new Error("Register number and student name are required.");
    }

    const duplicate = data.students.find(
      (candidate) =>
        candidate.id !== studentId &&
        candidate.registerNumber.toLowerCase() === normalizedRegisterNumber.toLowerCase()
    );

    if (duplicate) {
      throw new Error("That register number is already assigned to another student.");
    }

    student.registerNumber = normalizedRegisterNumber;
    student.name = normalizedName;

    if (payload.password?.trim()) {
      const passwordError = validatePassword(payload.password);
      if (passwordError) {
        throw new Error(passwordError);
      }

      const { hash, salt } = await hashPassword(payload.password);
      student.passwordHash = hash;
      student.passwordSalt = salt;
    }

    student.updatedAt = nowIso();
    await this.persist();
    return this.listStudents().find((entry) => entry.id === student.id) as StudentRosterEntry;
  }

  async deleteAdmin(adminId: string, actingAdminId: string): Promise<void> {
    const data = this.requireData();
    const admin = data.admins.find((candidate) => candidate.id === adminId);

    if (!admin) {
      throw new Error("Admin not found.");
    }

    if (admin.id === actingAdminId) {
      throw new Error("You cannot remove your own admin account.");
    }

    if (data.admins.length <= 1) {
      throw new Error("At least one admin account must remain.");
    }

    if (admin.isSuperAdmin && data.admins.filter((candidate) => candidate.isSuperAdmin).length <= 1) {
      throw new Error("At least one super admin account must remain.");
    }

    data.admins = data.admins.filter((candidate) => candidate.id !== adminId);
    data.sessions = data.sessions.filter((session) => !(session.role === "admin" && session.userId === adminId));
    await this.persist();
  }

  async deleteAdmins(adminIds: string[], actingAdminId: string): Promise<number> {
    const uniqueIds = [...new Set(adminIds)].filter((adminId) => adminId !== actingAdminId);
    let deleted = 0;

    for (const adminId of uniqueIds) {
      const exists = this.requireData().admins.some((candidate) => candidate.id === adminId);
      if (!exists) {
        continue;
      }

      await this.deleteAdmin(adminId, actingAdminId);
      deleted += 1;
    }

    return deleted;
  }

  async updateAdmin(adminId: string, payload: UpdateAdminRequest): Promise<AdminRosterEntry> {
    const data = this.requireData();
    const admin = data.admins.find((candidate) => candidate.id === adminId);

    if (!admin) {
      throw new Error("Admin not found.");
    }

    const normalizedName = payload.name.trim();
    const normalizedUsername = payload.username.trim().toLowerCase();
    if (!normalizedName || !normalizedUsername) {
      throw new Error("Admin name and username are required.");
    }

    const duplicate = data.admins.find(
      (candidate) => candidate.id !== adminId && candidate.username === normalizedUsername
    );

    if (duplicate) {
      throw new Error("That username is already in use.");
    }

    admin.name = normalizedName;
    admin.username = normalizedUsername;

    if (payload.password?.trim()) {
      const passwordError = validatePassword(payload.password);
      if (passwordError) {
        throw new Error(passwordError);
      }

      const { hash, salt } = await hashPassword(payload.password);
      admin.passwordHash = hash;
      admin.passwordSalt = salt;
    }

    admin.updatedAt = nowIso();
    await this.persist();
    return this.toAdminRosterEntry(admin);
  }

  async createQuizSession(
    studentId: string,
    level: Level,
    questionIds: string[],
    timeLimitMinutes: number
  ): Promise<{ quizId: string; expiresAt: string; timeLimitMinutes: number }> {
    const data = this.requireData();
    data.quizSessions = data.quizSessions.filter((session) => session.studentId !== studentId);
    const expiresAt = new Date(Date.now() + timeLimitMinutes * 60 * 1000).toISOString();

    const session: QuizSessionRecord = {
      id: randomUUID(),
      studentId,
      level,
      questionIds,
      createdAt: nowIso(),
      expiresAt
    };

    data.quizSessions.push(session);
    await this.persist();

    return {
      quizId: session.id,
      expiresAt,
      timeLimitMinutes
    };
  }

  getQuizSession(studentId: string, quizId: string): QuizSessionRecord {
    this.pruneExpired();

    const session = this.requireData().quizSessions.find(
      (candidate) => candidate.id === quizId && candidate.studentId === studentId
    );

    if (!session) {
      throw new Error("Quiz session not found or expired.");
    }

    return session;
  }

  async saveAttempt(
    studentId: string,
    results: Omit<AttemptDetail, "attemptId" | "score" | "performanceLabel" | "completedAt">,
    quizId: string
  ): Promise<AttemptDetail> {
    const data = this.requireData();
    data.quizSessions = data.quizSessions.filter((session) => session.id !== quizId);

    const score = results.correctQuestions;
    const percentage = results.totalQuestions === 0 ? 0 : score / results.totalQuestions;
    const performanceLabel = getPerformanceLabel(score, results.totalQuestions);
    const completedAt = nowIso();
    const attempt: AttemptRecord = {
      id: randomUUID(),
      studentId,
      level: results.level,
      score,
      totalQuestions: results.totalQuestions,
      percentage,
      performanceLabel,
      completedAt,
      results
    };

    data.attempts.push(attempt);
    await this.persist();

    return {
      attemptId: attempt.id,
      score: attempt.score,
      performanceLabel: attempt.performanceLabel,
      completedAt: attempt.completedAt,
      ...attempt.results
    };
  }

  getPastScores(studentId: string): AttemptSummary[] {
    return this.requireData().attempts
      .filter((attempt) => attempt.studentId === studentId)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .map(toAttemptSummary);
  }

  getAttemptDetail(studentId: string, attemptId: string): AttemptDetail {
    const attempt = this.requireData().attempts.find(
      (candidate) => candidate.id === attemptId && candidate.studentId === studentId
    );

    if (!attempt) {
      throw new Error("Attempt not found.");
    }

    return {
      attemptId: attempt.id,
      score: attempt.score,
      performanceLabel: attempt.performanceLabel,
      completedAt: attempt.completedAt,
      ...attempt.results
    };
  }

  private matchesStudentToken(student: StudentRosterEntry, token: SearchToken): boolean {
    const statusLabel = student.hasPassword ? "active" : "not set";
    const searchable = [
      student.registerNumber,
      student.name,
      statusLabel,
      student.attemptsCount,
      student.createdAt,
      student.updatedAt
    ];

    if (!token.field) {
      return matchesValue(searchable, token.value);
    }

    if (["name"].includes(token.field)) {
      return matchesValue([student.name], token.value);
    }

    if (["reg", "register", "registerno", "registerNumber"].map((value) => value.toLowerCase()).includes(token.field)) {
      return matchesValue([student.registerNumber], token.value);
    }

    if (["status", "password", "access"].includes(token.field)) {
      return matchesValue([statusLabel, student.hasPassword ? "set" : "pending"], token.value);
    }

    if (["attempt", "attempts"].includes(token.field)) {
      return matchesValue([student.attemptsCount], token.value);
    }

    if (["created", "updated", "date"].includes(token.field)) {
      return matchesValue([student.createdAt, student.updatedAt], token.value);
    }

    return matchesValue(searchable, token.value);
  }

  private matchesAdminToken(admin: AdminRosterEntry, token: SearchToken): boolean {
    const accessLabel = admin.isSuperAdmin ? "super admin" : "admin";
    const searchable = [admin.name, admin.username, accessLabel, admin.createdAt, admin.updatedAt];

    if (!token.field) {
      return matchesValue(searchable, token.value);
    }

    if (["name"].includes(token.field)) {
      return matchesValue([admin.name], token.value);
    }

    if (["user", "username", "login"].includes(token.field)) {
      return matchesValue([admin.username], token.value);
    }

    if (["access", "role"].includes(token.field)) {
      return matchesValue([accessLabel, admin.isSuperAdmin ? "super" : "standard"], token.value);
    }

    if (["created", "updated", "date"].includes(token.field)) {
      return matchesValue([admin.createdAt, admin.updatedAt], token.value);
    }

    return matchesValue(searchable, token.value);
  }

  private createSession(userId: string, role: "admin" | "student"): { token: string } {
    const data = this.requireData();
    const { token, tokenHash } = createSessionToken();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + getSessionMaxAgeSeconds() * 1000).toISOString();

    data.sessions.push({
      id: randomUUID(),
      tokenHash,
      userId,
      role,
      createdAt,
      expiresAt
    });

    return { token };
  }

  private pruneExpired(): void {
    const data = this.requireData();
    const now = Date.now();

    data.sessions = data.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
    data.quizSessions = data.quizSessions.filter(
      (session) => new Date(session.expiresAt).getTime() > now - 1000 * 60 * 60 * 24
    );
  }

  private toAuthenticatedAdmin(admin: AdminRecord): AuthenticatedAdmin {
    return {
      id: admin.id,
      role: "admin",
      username: admin.username,
      name: admin.name,
      isSuperAdmin: admin.isSuperAdmin,
      accessLevel: admin.isSuperAdmin ? "super_admin" : "admin"
    };
  }

  private toAdminRosterEntry(admin: AdminRecord): AdminRosterEntry {
    return {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      isSuperAdmin: admin.isSuperAdmin,
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt
    };
  }

  private toAuthenticatedStudent(student: StudentRecord): AuthenticatedStudent {
    return {
      id: student.id,
      role: "student",
      registerNumber: student.registerNumber,
      name: student.name
    };
  }

  private requireData(): PlatformData {
    if (!this.data) {
      throw new Error("Platform store has not been initialized.");
    }

    return this.data;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.dataFilePath), { recursive: true });
    await writeFile(this.dataFilePath, `${JSON.stringify(this.requireData(), null, 2)}\n`, "utf8");
  }
}
