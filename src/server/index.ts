import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import {
  LEVELS,
  type CreateQuestionRequest,
  type AuthenticatedAdmin,
  type AuthenticatedStudent,
  type Level,
  type QuizSettings,
  type StudentSubmission
} from "../shared/types";
import { parseStudentRosterFromBuffer } from "./import/student-roster";
import { parseWorkbookFromBuffer } from "./import/workbook";
import { evaluateSubmissions } from "./services/evaluator";
import { buildClearedSessionCookie, buildSessionCookie, parseCookies } from "./services/security";
import { PlatformStore } from "./storage/platform-store";
import { QuestionStore } from "./storage/question-store";

function isLevel(value: string | undefined): value is Level {
  return !!value && LEVELS.includes(value as Level);
}

function resolveProjectPath(...segments: string[]): string {
  return join(process.cwd(), ...segments);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function getSessionToken(request: FastifyRequest): string | null {
  return parseCookies(request.headers.cookie).jet_session ?? null;
}

async function buildServer() {
  const app = Fastify({ logger: false });
  const questionStore = new QuestionStore(resolveProjectPath("data", "questions.json"));
  const platformStore = new PlatformStore(resolveProjectPath("data", "platform.json"));
  const seedWorkbookPath = resolveProjectPath("Jet questions.xlsx");

  await questionStore.initialize(seedWorkbookPath);
  await platformStore.initialize();
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024
    }
  });

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthenticatedAdmin | undefined> => {
    const user = platformStore.getUserForSession(getSessionToken(request));

    if (!user) {
      reply.code(401);
      void reply.send({ message: "Authentication required." });
      return undefined;
    }

    if (user.role !== "admin") {
      reply.code(403);
      void reply.send({ message: "Admin access required." });
      return undefined;
    }

    return user;
  };

  const requireSuperAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthenticatedAdmin | undefined> => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return undefined;
    }

    if (!admin.isSuperAdmin) {
      reply.code(403);
      void reply.send({ message: "Super admin access required." });
      return undefined;
    }

    return admin;
  };

  const requireStudent = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<AuthenticatedStudent | undefined> => {
    const user = platformStore.getUserForSession(getSessionToken(request));

    if (!user) {
      reply.code(401);
      void reply.send({ message: "Authentication required." });
      return undefined;
    }

    if (user.role !== "student") {
      reply.code(403);
      void reply.send({ message: "Student access required." });
      return undefined;
    }

    return user;
  };

  app.get("/api/auth/status", async (request) => ({
    user: platformStore.getUserForSession(getSessionToken(request)),
    adminSetupRequired: platformStore.adminSetupRequired()
  }));

  app.post("/api/auth/bootstrap-admin", async (request, reply) => {
    const body = request.body as { name?: string; username?: string; password?: string };

    try {
      const result = await platformStore.bootstrapAdmin(body.name ?? "", body.username ?? "", body.password ?? "");
      reply.header("Set-Cookie", buildSessionCookie(result.token));
      return {
        user: result.user,
        adminSetupRequired: false
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/auth/admin/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };

    try {
      const result = await platformStore.loginAdmin(body.username ?? "", body.password ?? "");
      reply.header("Set-Cookie", buildSessionCookie(result.token));
      return {
        user: result.user,
        adminSetupRequired: false
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/auth/student/login", async (request, reply) => {
    const body = request.body as { registerNumber?: string; password?: string };

    try {
      const result = await platformStore.loginStudent(body.registerNumber ?? "", body.password ?? "");
      reply.header("Set-Cookie", buildSessionCookie(result.token));
      return {
        user: result.user,
        adminSetupRequired: platformStore.adminSetupRequired()
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/auth/student/register", async (request, reply) => {
    const body = request.body as { registerNumber?: string; name?: string; password?: string };

    try {
      const result = await platformStore.registerStudent(body.registerNumber ?? "", body.name ?? "", body.password ?? "");
      reply.header("Set-Cookie", buildSessionCookie(result.token));
      return {
        user: result.user,
        adminSetupRequired: platformStore.adminSetupRequired()
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await platformStore.logout(getSessionToken(request));
    reply.header("Set-Cookie", buildClearedSessionCookie());
    return { success: true };
  });

  app.get("/api/student/dashboard", async (request, reply) => {
    const student = await requireStudent(request, reply);
    if (!student) {
      return;
    }

    return {
      settings: platformStore.getSettings(),
      questionSummary: questionStore.getSummary(),
      student,
      pastScores: platformStore.getPastScores(student.id)
    };
  });

  app.post("/api/student/quiz/start", async (request, reply) => {
    const student = await requireStudent(request, reply);
    if (!student) {
      return;
    }

    const body = request.body as { level?: string };
    if (!isLevel(body.level)) {
      reply.code(400);
      return { message: "A valid level is required." };
    }

    const settings = platformStore.getSettings();
    const questions = questionStore.getRandomStudentQuestions(body.level, settings.questionsPerQuiz);
    const quizSession = await platformStore.createQuizSession(
      student.id,
      body.level,
      questions.map((question) => question.id),
      settings.timeLimitMinutes
    );

    return {
      quizId: quizSession.quizId,
      level: body.level,
      questionCount: questions.length,
      timeLimitMinutes: quizSession.timeLimitMinutes,
      expiresAt: quizSession.expiresAt,
      questions
    };
  });

  app.post("/api/student/quiz/submit", async (request, reply) => {
    const student = await requireStudent(request, reply);
    if (!student) {
      return;
    }

    const body = request.body as { quizId?: string; submissions?: StudentSubmission[] };
    if (!body.quizId || !Array.isArray(body.submissions)) {
      reply.code(400);
      return { message: "Quiz id and submissions are required." };
    }

    try {
      const quizSession = platformStore.getQuizSession(student.id, body.quizId);
      const quizExpired = Date.now() > new Date(quizSession.expiresAt).getTime() + 5000;

      if (quizExpired) {
        reply.code(400);
        return { message: "Quiz time expired. Start a new quiz." };
      }

      const questions = questionStore.getQuestionsByIds(quizSession.questionIds);
      const results = evaluateSubmissions(quizSession.level, questions, body.submissions);
      const attempt = await platformStore.saveAttempt(student.id, results, body.quizId);

      return {
        attempt,
        pastScores: platformStore.getPastScores(student.id)
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.get("/api/student/attempts/:id", async (request, reply) => {
    const student = await requireStudent(request, reply);
    if (!student) {
      return;
    }

    try {
      const { id } = request.params as { id: string };
      return platformStore.getAttemptDetail(student.id, id);
    } catch (error) {
      reply.code(404);
      return { message: getErrorMessage(error) };
    }
  });

  app.get("/api/admin/dashboard", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    return {
      settings: platformStore.getSettings(),
      questionSummary: questionStore.getSummary(),
      studentsCount: platformStore.listStudents().length,
      adminsCount: platformStore.listAdmins().length
    };
  });

  app.patch("/api/admin/settings", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as Partial<QuizSettings>;
    const questionsPerQuiz = Number(body.questionsPerQuiz);
    const timeLimitMinutes = Number(body.timeLimitMinutes);

    if (!Number.isInteger(questionsPerQuiz) || questionsPerQuiz < 1 || questionsPerQuiz > 100) {
      reply.code(400);
      return { message: "Question count must be an integer between 1 and 100." };
    }

    if (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1 || timeLimitMinutes > 300) {
      reply.code(400);
      return { message: "Time limit must be an integer between 1 and 300 minutes." };
    }

    await platformStore.updateSettings({ questionsPerQuiz, timeLimitMinutes });
    return { settings: platformStore.getSettings() };
  });

  app.get("/api/admin/questions", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { level, search, page, pageSize } = request.query as {
      level?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    };

    if (level && !isLevel(level)) {
      reply.code(400);
      return { message: "Invalid level filter." };
    }

    return questionStore.listQuestions({
      level: level as Level | undefined,
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10)
    });
  });

  app.post("/api/admin/questions", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as Partial<CreateQuestionRequest>;

    if (!body.level || !isLevel(body.level)) {
      reply.code(400);
      return { message: "A valid level is required." };
    }

    if (!body.prompt?.trim()) {
      reply.code(400);
      return { message: "Question prompt is required." };
    }

    const answerRows = Array.isArray(body.answerRows)
      ? body.answerRows
          .map((row) => ({
            account: row.account?.trim() ?? "",
            debit: row.debit ?? null,
            credit: row.credit ?? null
          }))
          .filter((row) => row.account || row.debit !== null || row.credit !== null)
      : [];

    if (!answerRows.length) {
      reply.code(400);
      return { message: "Add at least one answer row." };
    }

    if (answerRows.some((row) => !row.account)) {
      reply.code(400);
      return { message: "Each answer row needs an account name." };
    }

    const options = Array.isArray(body.options)
      ? body.options.map((option) => option.trim()).filter(Boolean)
      : [];

    const question = await questionStore.addQuestion({
      level: body.level,
      sourceQuestionNo: body.sourceQuestionNo?.trim(),
      prompt: body.prompt,
      options,
      answerRows
    });

    return { question };
  });

  app.patch("/api/admin/questions/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as Partial<CreateQuestionRequest>;

    if (!body.level || !isLevel(body.level)) {
      reply.code(400);
      return { message: "A valid level is required." };
    }

    if (!body.prompt?.trim()) {
      reply.code(400);
      return { message: "Question prompt is required." };
    }

    const answerRows = Array.isArray(body.answerRows)
      ? body.answerRows
          .map((row) => ({
            account: row.account?.trim() ?? "",
            debit: row.debit ?? null,
            credit: row.credit ?? null
          }))
          .filter((row) => row.account || row.debit !== null || row.credit !== null)
      : [];

    if (!answerRows.length) {
      reply.code(400);
      return { message: "Add at least one answer row." };
    }

    if (answerRows.some((row) => !row.account)) {
      reply.code(400);
      return { message: "Each answer row needs an account name." };
    }

    const options = Array.isArray(body.options)
      ? body.options.map((option) => option.trim()).filter(Boolean)
      : [];

    try {
      const question = await questionStore.updateQuestion(id, {
        level: body.level,
        sourceQuestionNo: body.sourceQuestionNo?.trim(),
        prompt: body.prompt,
        options,
        answerRows
      });

      return { question };
    } catch (error) {
      reply.code(404);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/admin/questions/import", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { message: "Excel file is required." };
    }

    try {
      const parsed = await parseWorkbookFromBuffer(await file.toBuffer());
      await questionStore.replaceLevels(parsed.importedLevels, parsed.questions);
      return {
        importedLevels: parsed.importedLevels,
        importedQuestions: parsed.questions.length,
        totalQuestions: questionStore.getSummary().totalQuestions
      };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.delete("/api/admin/questions/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { id } = request.params as { id: string };
    await questionStore.deleteQuestion(id);
    return { success: true };
  });

  app.post("/api/admin/questions/bulk-delete", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as { ids?: string[]; level?: string };

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      return { deleted: await questionStore.deleteQuestions(body.ids) };
    }

    if (isLevel(body.level)) {
      return { deleted: await questionStore.deleteByLevel(body.level) };
    }

    reply.code(400);
    return { message: "Provide question ids or a level to delete." };
  });

  app.post("/api/admin/students/import", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { message: "Student roster file is required." };
    }

    try {
      const students = await parseStudentRosterFromBuffer(file.filename ?? "students.csv", await file.toBuffer());
      return await platformStore.importStudents(students);
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/admin/students", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as { registerNumber?: string; name?: string; password?: string };

    try {
      const student = await platformStore.createStudent(body.registerNumber ?? "", body.name ?? "", body.password ?? "");
      return { student };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.get("/api/admin/students", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };

    return platformStore.listStudentsPage({
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10)
    });
  });

  app.patch("/api/admin/students/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as { registerNumber?: string; name?: string; password?: string };

    try {
      const student = await platformStore.updateStudent(id, {
        registerNumber: body.registerNumber ?? "",
        name: body.name ?? "",
        password: body.password ?? ""
      });
      return { student };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/admin/students/bulk-delete", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      reply.code(400);
      return { message: "Provide at least one student id to delete." };
    }

    return { deleted: await platformStore.deleteStudents(body.ids) };
  });

  app.delete("/api/admin/students/:id", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    try {
      const { id } = request.params as { id: string };
      await platformStore.deleteStudent(id);
      return { success: true };
    } catch (error) {
      reply.code(404);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/admin/students/:id/reset-password", async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    try {
      const { id } = request.params as { id: string };
      await platformStore.resetStudentPassword(id);
      return { success: true };
    } catch (error) {
      reply.code(404);
      return { message: getErrorMessage(error) };
    }
  });

  app.get("/api/admin/admins", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { search, page, pageSize } = request.query as { search?: string; page?: string; pageSize?: string };

    return platformStore.listAdminsPage({
      search,
      page: parsePositiveInteger(page, 1),
      pageSize: parsePositiveInteger(pageSize, 10)
    });
  });

  app.post("/api/admin/admins", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as { name?: string; username?: string; password?: string };

    try {
      const createdAdmin = await platformStore.createAdmin(body.name ?? "", body.username ?? "", body.password ?? "");
      return { admin: createdAdmin };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.patch("/api/admin/admins/:id", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; username?: string; password?: string };

    try {
      const updatedAdmin = await platformStore.updateAdmin(id, {
        name: body.name ?? "",
        username: body.username ?? "",
        password: body.password ?? ""
      });
      return { admin: updatedAdmin };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.post("/api/admin/admins/bulk-delete", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    const body = request.body as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      reply.code(400);
      return { message: "Provide at least one admin id to delete." };
    }

    try {
      return { deleted: await platformStore.deleteAdmins(body.ids, admin.id) };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  app.delete("/api/admin/admins/:id", async (request, reply) => {
    const admin = await requireSuperAdmin(request, reply);
    if (!admin) {
      return;
    }

    try {
      const { id } = request.params as { id: string };
      await platformStore.deleteAdmin(id, admin.id);
      return { success: true };
    } catch (error) {
      reply.code(400);
      return { message: getErrorMessage(error) };
    }
  });

  const builtWebPath = resolveProjectPath("dist", "web");
  if (await pathExists(builtWebPath)) {
    await app.register(fastifyStatic, {
      root: builtWebPath
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api")) {
      reply.code(404);
      return { message: "Not found." };
    }

    if (await pathExists(builtWebPath)) {
      return reply.sendFile("index.html");
    }

    reply.type("text/plain");
    return "Frontend build not found. Run `npm run dev` for development or `npm run build` before `npm start`.";
  });

  return app;
}

async function start() {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  console.log(`API server running on http://${host}:${port}`);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
