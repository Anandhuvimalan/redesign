import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Workbook, type CellValue, type Worksheet } from "exceljs";
import { type Level, type Question } from "../../shared/types";

const SHEET_LEVEL_MAP: Record<string, Level> = {
  Basic: "basic",
  Medium: "medium",
  Hard: "hard"
};

interface ParsedWorkbook {
  importedLevels: Level[];
  questions: Question[];
}

type SheetRow = [unknown?, unknown?, unknown?, unknown?, unknown?, unknown?, unknown?, unknown?];
type WorkbookBufferInput = Parameters<Workbook["xlsx"]["load"]>[0];

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function cleanText(value: unknown): string {
  return hasValue(value) ? String(value).replace(/\s+/g, " ").trim() : "";
}

function formatQuestionNo(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  }

  return cleanText(value).replace(/\.0+$/, "");
}

function parseAmount(value: unknown): number | null {
  if (!hasValue(value)) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCellValue(value: CellValue): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const candidate = value as {
    text?: string;
    result?: CellValue;
    richText?: Array<{ text?: string }>;
    error?: string;
  };

  if (typeof candidate.text === "string") {
    return candidate.text;
  }

  if (candidate.result !== undefined) {
    return normalizeCellValue(candidate.result);
  }

  if (Array.isArray(candidate.richText)) {
    return candidate.richText.map((part) => part.text ?? "").join("");
  }

  if (candidate.error) {
    return candidate.error;
  }

  return null;
}

function worksheetToRows(worksheet: Worksheet): SheetRow[] {
  const rows: SheetRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push([
      normalizeCellValue(row.getCell(1).value),
      normalizeCellValue(row.getCell(2).value),
      normalizeCellValue(row.getCell(3).value),
      normalizeCellValue(row.getCell(4).value),
      normalizeCellValue(row.getCell(5).value),
      normalizeCellValue(row.getCell(6).value),
      normalizeCellValue(row.getCell(7).value),
      normalizeCellValue(row.getCell(8).value)
    ]);
  });

  return rows;
}

function parseSheet(worksheet: Worksheet, level: Level, sheetName: string, importedAt: string): Question[] {
  const rows = worksheetToRows(worksheet);
  const questions: Question[] = [];
  let current:
    | {
        sourceQuestionNo: string;
        prompt: string;
        options: string[];
        answerRows: Question["answerRows"];
      }
    | undefined;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    const uniqueOptions: string[] = [];
    const seen = new Set<string>();

    for (const option of current.options) {
      const key = option.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueOptions.push(option);
      }
    }

    questions.push({
      id: `${level}-${current.sourceQuestionNo}`,
      level,
      sourceQuestionNo: current.sourceQuestionNo,
      prompt: current.prompt,
      options: uniqueOptions,
      answerRows: current.answerRows,
      sheetName,
      importedAt
    });
  };

  for (const row of rows.slice(1)) {
    const [no, particularsB, particularsA, , answerDropdown, debit, credit] = row;

    if (hasValue(no)) {
      pushCurrent();
      current = {
        sourceQuestionNo: formatQuestionNo(no),
        prompt: cleanText(particularsB),
        options: [],
        answerRows: []
      };
    }

    if (!current) {
      continue;
    }

    const optionText = cleanText(particularsA);
    if (optionText) {
      current.options.push(optionText);
    }

    const answerText = cleanText(answerDropdown);
    const debitAmount = parseAmount(debit);
    const creditAmount = parseAmount(credit);

    if (answerText || debitAmount !== null || creditAmount !== null) {
      current.answerRows.push({
        id: randomUUID(),
        account: answerText,
        debit: debitAmount,
        credit: creditAmount
      });
    }
  }

  pushCurrent();
  return questions.filter((question) => question.prompt && question.options.length > 0);
}

function parseWorkbook(workbook: Workbook): ParsedWorkbook {
  const importedAt = new Date().toISOString();
  const importedLevels: Level[] = [];
  const questions: Question[] = [];

  for (const [sheetName, level] of Object.entries(SHEET_LEVEL_MAP)) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      continue;
    }

    importedLevels.push(level);
    questions.push(...parseSheet(worksheet, level, sheetName, importedAt));
  }

  if (importedLevels.length === 0) {
    throw new Error("Workbook must include at least one of these sheets: Basic, Medium, Hard.");
  }

  return { importedLevels, questions };
}

export async function parseWorkbookFromFile(filePath: string): Promise<ParsedWorkbook> {
  if (!existsSync(filePath)) {
    throw new Error(`Workbook not found at ${filePath}`);
  }

  const workbook = new Workbook();
  await workbook.xlsx.readFile(filePath);
  return parseWorkbook(workbook);
}

export async function parseWorkbookFromBuffer(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as WorkbookBufferInput);
  return parseWorkbook(workbook);
}
