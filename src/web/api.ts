import type {
  AdminListResponse,
  AdminDashboardResponse,
  CreateQuestionRequest,
  AdminQuestionsResponse,
  AdminStudentsResponse,
  AttemptDetail,
  AuthResponse,
  AuthStatusResponse,
  ImportResponse,
  Level,
  Question,
  QuizSettings,
  QuizStartResponse,
  QuizSubmitResponse,
  StudentDashboardResponse,
  StudentImportResponse,
  StudentSubmission,
  UpdateAdminRequest,
  UpdateQuestionRequest,
  UpdateStudentRequest
} from "../shared/types";

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function fetchAuthStatus() {
  return requestJson<AuthStatusResponse>("/api/auth/status");
}

export function bootstrapAdmin(name: string, username: string, password: string) {
  return requestJson<AuthResponse>("/api/auth/bootstrap-admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, username, password })
  });
}

export function loginAdmin(username: string, password: string) {
  return requestJson<AuthResponse>("/api/auth/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
}

export function loginStudent(registerNumber: string, password: string) {
  return requestJson<AuthResponse>("/api/auth/student/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ registerNumber, password })
  });
}

export function registerStudent(registerNumber: string, name: string, password: string) {
  return requestJson<AuthResponse>("/api/auth/student/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ registerNumber, name, password })
  });
}

export function logout() {
  return requestJson<{ success: true }>("/api/auth/logout", {
    method: "POST"
  });
}

export function fetchStudentDashboard() {
  return requestJson<StudentDashboardResponse>("/api/student/dashboard");
}

export function startStudentQuiz(level: Level) {
  return requestJson<QuizStartResponse>("/api/student/quiz/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ level })
  });
}

export function submitStudentQuiz(quizId: string, submissions: StudentSubmission[]) {
  return requestJson<QuizSubmitResponse>("/api/student/quiz/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ quizId, submissions })
  });
}

export function fetchStudentAttempt(attemptId: string) {
  return requestJson<AttemptDetail>(`/api/student/attempts/${attemptId}`);
}

export function fetchAdminDashboard() {
  return requestJson<AdminDashboardResponse>("/api/admin/dashboard");
}

interface PaginatedAdminQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

function buildAdminListParams(params: PaginatedAdminQuery & { level?: Level }) {
  const query = new URLSearchParams();

  if (params.level) {
    query.set("level", params.level);
  }

  if (params.search?.trim()) {
    query.set("search", params.search.trim());
  }

  if (params.page && params.page > 0) {
    query.set("page", String(params.page));
  }

  if (params.pageSize && params.pageSize > 0) {
    query.set("pageSize", String(params.pageSize));
  }

  return query.toString();
}

export function fetchAdminList(params: PaginatedAdminQuery = {}) {
  const query = buildAdminListParams(params);
  return requestJson<AdminListResponse>(`/api/admin/admins${query ? `?${query}` : ""}`);
}

export function updateAdminSettings(questionsPerQuiz: number, timeLimitMinutes: number) {
  return requestJson<{ settings: QuizSettings }>("/api/admin/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ questionsPerQuiz, timeLimitMinutes })
  });
}

export function fetchAdminQuestions(level?: Level, search?: string, page?: number, pageSize?: number) {
  const query = buildAdminListParams({ level, search, page, pageSize });
  return requestJson<AdminQuestionsResponse>(`/api/admin/questions${query ? `?${query}` : ""}`);
}

export function updateAdminQuestion(questionId: string, payload: UpdateQuestionRequest) {
  return requestJson<{ question: Question }>(`/api/admin/questions/${questionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export function createAdminQuestion(payload: CreateQuestionRequest) {
  return requestJson<{ question: Question }>("/api/admin/questions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function uploadFile<T>(url: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return requestJson<T>(url, {
    method: "POST",
    body: formData
  });
}

export function uploadQuestionWorkbook(file: File) {
  return uploadFile<ImportResponse>("/api/admin/questions/import", file);
}

export function uploadStudentRoster(file: File) {
  return uploadFile<StudentImportResponse>("/api/admin/students/import", file);
}

export function createAdminStudent(registerNumber: string, name: string, password: string) {
  return requestJson<{ student: { id: string; registerNumber: string; name: string; hasPassword: boolean; attemptsCount: number } }>("/api/admin/students", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ registerNumber, name, password })
  });
}

export function fetchAdminStudents(params: PaginatedAdminQuery = {}) {
  const query = buildAdminListParams(params);
  return requestJson<AdminStudentsResponse>(`/api/admin/students${query ? `?${query}` : ""}`);
}

export function updateAdminStudent(studentId: string, payload: UpdateStudentRequest) {
  return requestJson<{ student: { id: string; registerNumber: string; name: string; hasPassword: boolean; attemptsCount: number } }>(
    `/api/admin/students/${studentId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
}

export function bulkDeleteAdminStudents(ids: string[]) {
  return requestJson<{ deleted: number }>("/api/admin/students/bulk-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids })
  });
}

export function createManagedAdmin(name: string, username: string, password: string) {
  return requestJson<{ admin: { id: string; username: string; name: string; isSuperAdmin: boolean; createdAt: string; updatedAt: string } }>("/api/admin/admins", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, username, password })
  });
}

export function updateManagedAdmin(adminId: string, payload: UpdateAdminRequest) {
  return requestJson<{ admin: { id: string; username: string; name: string; isSuperAdmin: boolean; createdAt: string; updatedAt: string } }>(
    `/api/admin/admins/${adminId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
}

export function bulkDeleteManagedAdmins(ids: string[]) {
  return requestJson<{ deleted: number }>("/api/admin/admins/bulk-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids })
  });
}

export function resetStudentPassword(studentId: string) {
  return requestJson<{ success: true }>(`/api/admin/students/${studentId}/reset-password`, {
    method: "POST"
  });
}

export function deleteAdminStudent(studentId: string) {
  return requestJson<{ success: true }>(`/api/admin/students/${studentId}`, {
    method: "DELETE"
  });
}

export function deleteManagedAdmin(adminId: string) {
  return requestJson<{ success: true }>(`/api/admin/admins/${adminId}`, {
    method: "DELETE"
  });
}

export function deleteQuestion(questionId: string) {
  return requestJson<{ success: true }>(`/api/admin/questions/${questionId}`, {
    method: "DELETE"
  });
}

export function bulkDeleteQuestions(ids: string[]) {
  return requestJson<{ deleted: number }>("/api/admin/questions/bulk-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids })
  });
}

export function clearLevel(level: Level) {
  return requestJson<{ deleted: number }>("/api/admin/questions/bulk-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ level })
  });
}
