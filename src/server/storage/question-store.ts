import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  MATRIX_ROW_COUNT,
  LEVELS,
  type CreateQuestionRequest,
  type Dataset,
  type Level,
  type PaginationMeta,
  type Question,
  type SummaryResponse,
  type StudentQuestion
} from "../../shared/types";
import { parseWorkbookFromFile } from "../import/workbook";

const EMPTY_DATASET: Dataset = {
  version: 1,
  importedAt: null,
  questions: []
};

function compareQuestionNo(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortQuestions(questions: Question[]): Question[] {
  const levelOrder = new Map<Level, number>(LEVELS.map((level, index) => [level, index]));

  return [...questions].sort((left, right) => {
    if (left.level !== right.level) {
      return (levelOrder.get(left.level) ?? 0) - (levelOrder.get(right.level) ?? 0);
    }

    return compareQuestionNo(left.sourceQuestionNo, right.sourceQuestionNo);
  });
}

interface SearchToken {
  field: string | null;
  value: string;
}

interface QuestionListOptions {
  level?: Level;
  search?: string;
  page?: number;
  pageSize?: number;
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

function questionIncludesValue(question: Question, value: string): boolean {
  const searchableValues = [
    question.level,
    question.sourceQuestionNo,
    question.prompt,
    question.sheetName,
    question.importedAt,
    ...question.options,
    ...question.answerRows.flatMap((row) => [
      row.account,
      row.debit === null ? "" : String(row.debit),
      row.credit === null ? "" : String(row.credit)
    ])
  ];

  return searchableValues.some((entry) => entry.toLowerCase().includes(value));
}

function matchesQuestionToken(question: Question, token: SearchToken): boolean {
  if (!token.field) {
    return questionIncludesValue(question, token.value);
  }

  if (["level"].includes(token.field)) {
    return question.level.toLowerCase().includes(token.value);
  }

  if (["no", "number", "question", "questionno", "source"].includes(token.field)) {
    return question.sourceQuestionNo.toLowerCase().includes(token.value);
  }

  if (["prompt", "text"].includes(token.field)) {
    return question.prompt.toLowerCase().includes(token.value);
  }

  if (["sheet", "import", "imported"].includes(token.field)) {
    return question.sheetName.toLowerCase().includes(token.value) || question.importedAt.toLowerCase().includes(token.value);
  }

  if (["option", "options", "particular", "particulars"].includes(token.field)) {
    return question.options.some((option) => option.toLowerCase().includes(token.value));
  }

  if (["account", "row"].includes(token.field)) {
    return question.answerRows.some((row) => row.account.toLowerCase().includes(token.value));
  }

  if (["debit"].includes(token.field)) {
    return question.answerRows.some((row) => String(row.debit ?? "").toLowerCase().includes(token.value));
  }

  if (["credit"].includes(token.field)) {
    return question.answerRows.some((row) => String(row.credit ?? "").toLowerCase().includes(token.value));
  }

  if (["amount"].includes(token.field)) {
    return question.answerRows.some((row) =>
      [row.debit, row.credit].some((amount) => String(amount ?? "").toLowerCase().includes(token.value))
    );
  }

  return questionIncludesValue(question, token.value);
}

export class QuestionStore {
  private dataset: Dataset | null = null;

  constructor(private readonly dataFilePath: string) {}

  async initialize(seedWorkbookPath?: string): Promise<void> {
    if (this.dataset) {
      return;
    }

    try {
      const raw = await readFile(this.dataFilePath, "utf8");
      this.dataset = JSON.parse(raw) as Dataset;
      this.dataset.questions = sortQuestions(this.dataset.questions);
      return;
    } catch {
      this.dataset = { ...EMPTY_DATASET, questions: [] };
    }

    if (seedWorkbookPath) {
      const parsed = await parseWorkbookFromFile(seedWorkbookPath);
      await this.replaceLevels(parsed.importedLevels, parsed.questions);
    }
  }

  async replaceLevels(levels: Level[], questions: Question[]): Promise<void> {
    const dataset = this.requireDataset();
    const preserved = dataset.questions.filter((question) => !levels.includes(question.level));

    dataset.questions = sortQuestions([...preserved, ...questions]);
    dataset.importedAt = new Date().toISOString();
    await this.persist();
  }

  async addQuestion(input: CreateQuestionRequest): Promise<Question> {
    const dataset = this.requireDataset();
    const importedAt = new Date().toISOString();
    const sourceQuestionNo = input.sourceQuestionNo?.trim() || this.getNextQuestionNo(input.level);
    const options = [...new Set(
      [...input.options, ...input.answerRows.map((row) => row.account)]
        .map((option) => option.trim())
        .filter(Boolean)
    )];
    const answerRows = input.answerRows
      .map((row) => ({
        id: randomUUID(),
        account: row.account.trim(),
        debit: row.debit,
        credit: row.credit
      }))
      .filter((row) => row.account || row.debit !== null || row.credit !== null);

    const question: Question = {
      id: randomUUID(),
      level: input.level,
      sourceQuestionNo,
      prompt: input.prompt.trim(),
      options,
      answerRows,
      sheetName: "Manual",
      importedAt
    };

    dataset.questions = sortQuestions([...dataset.questions, question]);
    await this.persist();
    return question;
  }

  async updateQuestion(questionId: string, input: CreateQuestionRequest): Promise<Question> {
    const dataset = this.requireDataset();
    const existing = dataset.questions.find((question) => question.id === questionId);

    if (!existing) {
      throw new Error("Question not found.");
    }

    const options = [...new Set(
      [...input.options, ...input.answerRows.map((row) => row.account)]
        .map((option) => option.trim())
        .filter(Boolean)
    )];
    const answerRows = input.answerRows
      .map((row, index) => ({
        id: existing.answerRows[index]?.id ?? randomUUID(),
        account: row.account.trim(),
        debit: row.debit,
        credit: row.credit
      }))
      .filter((row) => row.account || row.debit !== null || row.credit !== null);

    existing.level = input.level;
    existing.sourceQuestionNo = input.sourceQuestionNo?.trim() || existing.sourceQuestionNo;
    existing.prompt = input.prompt.trim();
    existing.options = options;
    existing.answerRows = answerRows;
    dataset.questions = sortQuestions(dataset.questions);
    await this.persist();
    return existing;
  }

  async deleteQuestion(questionId: string): Promise<void> {
    const dataset = this.requireDataset();
    dataset.questions = dataset.questions.filter((question) => question.id !== questionId);
    await this.persist();
  }

  async deleteQuestions(questionIds: string[]): Promise<number> {
    const ids = new Set(questionIds);
    const dataset = this.requireDataset();
    const before = dataset.questions.length;
    dataset.questions = dataset.questions.filter((question) => !ids.has(question.id));
    await this.persist();
    return before - dataset.questions.length;
  }

  async deleteByLevel(level: Level): Promise<number> {
    const dataset = this.requireDataset();
    const before = dataset.questions.length;
    dataset.questions = dataset.questions.filter((question) => question.level !== level);
    await this.persist();
    return before - dataset.questions.length;
  }

  getSummary(): SummaryResponse {
    const dataset = this.requireDataset();

    return {
      totalQuestions: dataset.questions.length,
      lastImportedAt: dataset.importedAt,
      levels: LEVELS.map((level) => ({
        level,
        count: dataset.questions.filter((question) => question.level === level).length
      }))
    };
  }

  getQuestions(level?: Level, search?: string): Question[] {
    const dataset = this.requireDataset();
    const tokens = tokenizeSearch(search);

    return dataset.questions.filter((question) => {
      if (level && question.level !== level) {
        return false;
      }

      if (!tokens.length) {
        return true;
      }

      return tokens.every((token) => matchesQuestionToken(question, token));
    });
  }

  listQuestions(options: QuestionListOptions): { questions: Question[]; pagination: PaginationMeta } {
    const filtered = this.getQuestions(options.level, options.search);
    const { items, pagination } = paginateItems(filtered, options.page, options.pageSize);
    return { questions: items, pagination };
  }

  getStudentQuestions(level: Level): StudentQuestion[] {
    return this.getQuestions(level).map((question) => ({
      id: question.id,
      level: question.level,
      sourceQuestionNo: question.sourceQuestionNo,
      prompt: question.prompt,
      options: question.options,
      answerSlotCount: MATRIX_ROW_COUNT
    }));
  }

  getQuestionsByIds(questionIds: string[]): Question[] {
    const questionMap = new Map(this.requireDataset().questions.map((question) => [question.id, question]));
    return questionIds.flatMap((questionId) => {
      const question = questionMap.get(questionId);
      return question ? [question] : [];
    });
  }

  getRandomStudentQuestions(level: Level, requestedCount: number): StudentQuestion[] {
    const questions = [...this.getQuestions(level)];

    for (let index = questions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [questions[index], questions[swapIndex]] = [questions[swapIndex], questions[index]];
    }

    return questions.slice(0, Math.min(requestedCount, questions.length)).map((question) => ({
      id: question.id,
      level: question.level,
      sourceQuestionNo: question.sourceQuestionNo,
      prompt: question.prompt,
      options: question.options,
      answerSlotCount: MATRIX_ROW_COUNT
    }));
  }

  async seedFromWorkbook(workbookPath: string): Promise<void> {
    if (!this.dataset) {
      this.dataset = { ...EMPTY_DATASET, questions: [] };
    }

    const parsed = await parseWorkbookFromFile(workbookPath);
    await this.replaceLevels(parsed.importedLevels, parsed.questions);
  }

  private requireDataset(): Dataset {
    if (!this.dataset) {
      throw new Error("Question store has not been initialized.");
    }

    return this.dataset;
  }

  private getNextQuestionNo(level: Level): string {
    const sameLevel = this.requireDataset().questions
      .filter((question) => question.level === level)
      .map((question) => Number(question.sourceQuestionNo))
      .filter((value) => Number.isFinite(value));

    return String((sameLevel.length ? Math.max(...sameLevel) : 0) + 1);
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.dataFilePath), { recursive: true });
    await writeFile(this.dataFilePath, `${JSON.stringify(this.requireDataset(), null, 2)}\n`, "utf8");
  }
}
