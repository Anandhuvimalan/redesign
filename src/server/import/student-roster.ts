import { extname } from "node:path";
import { Workbook } from "exceljs";

export interface ImportedStudent {
  registerNumber: string;
  name: string;
}

function normalizeValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function parseCsv(buffer: Buffer): ImportedStudent[] {
  const rows = buffer
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const students: ImportedStudent[] = [];

  for (const [index, row] of rows.entries()) {
    const [rawRegisterNumber = "", rawName = ""] = row.split(",").map((value) => value.trim());
    const registerNumber = normalizeValue(rawRegisterNumber);
    const name = normalizeValue(rawName);

    if (index === 0 && /register|id/i.test(registerNumber) && /name/i.test(name)) {
      continue;
    }

    if (registerNumber && name) {
      students.push({ registerNumber, name });
    }
  }

  return students;
}

async function parseWorkbook(buffer: Buffer): Promise<ImportedStudent[]> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const students: ImportedStudent[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const registerNumber = normalizeValue(row.getCell(1).text);
    const name = normalizeValue(row.getCell(2).text);

    if (rowNumber === 1 && /register|id/i.test(registerNumber) && /name/i.test(name)) {
      return;
    }

    if (registerNumber && name) {
      students.push({ registerNumber, name });
    }
  });

  return students;
}

export async function parseStudentRosterFromBuffer(fileName: string, buffer: Buffer): Promise<ImportedStudent[]> {
  const extension = extname(fileName).toLowerCase();

  if (extension === ".csv" || extension === ".txt") {
    return parseCsv(buffer);
  }

  if (extension === ".xlsx") {
    return parseWorkbook(buffer);
  }

  throw new Error("Student upload must be a CSV or XLSX file with register number and name columns.");
}
