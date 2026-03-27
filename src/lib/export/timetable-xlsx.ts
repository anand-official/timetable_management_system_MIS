/**
 * exceljs-based Excel (.xlsx) generator for class and teacher timetables.
 */

import ExcelJS from 'exceljs';
import { TimetableGrid, CellData, cellColorArgb } from './timetable-grid';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' },
};

const PERIOD_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' },
};

const PERIOD_FILL_ALT: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' },
};

const EMPTY_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' },
};

const EMPTY_FILL_ALT: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6F8' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left:   { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right:  { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const MEDIUM_OUTLINE: ExcelJS.Border = { style: 'medium', color: { argb: 'FF64748B' } };

const CENTER: Partial<ExcelJS.Alignment> = {
  horizontal: 'center', vertical: 'middle', wrapText: true,
};

function outlineTableBlock(
  ws: ExcelJS.Worksheet,
  firstRow: number,
  lastRow: number,
  firstCol: number,
  lastCol: number,
): void {
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      const prev = cell.border;
      const b: Partial<ExcelJS.Borders> = {
        top:    prev?.top    ?? THIN_BORDER.top,
        bottom: prev?.bottom ?? THIN_BORDER.bottom,
        left:   prev?.left   ?? THIN_BORDER.left,
        right:  prev?.right  ?? THIN_BORDER.right,
      };
      if (r === firstRow) b.top = MEDIUM_OUTLINE;
      if (r === lastRow) b.bottom = MEDIUM_OUTLINE;
      if (c === firstCol) b.left = MEDIUM_OUTLINE;
      if (c === lastCol) b.right = MEDIUM_OUTLINE;
      cell.border = b as ExcelJS.Borders;
    }
  }
}

function colLetter(index: number): string {
  let letter = '';
  let n = index;
  do {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letter;
}

function applyDataCell(
  cell: ExcelJS.Cell,
  data: CellData | null,
  isLabMergeStart = false,
  emptyStripe = false,
): void {
  if (!data) {
    cell.value    = '';
    cell.fill     = emptyStripe ? EMPTY_FILL_ALT : EMPTY_FILL;
    cell.border   = THIN_BORDER;
    cell.alignment = CENTER;
    return;
  }

  cell.value = {
    richText: [
      { text: data.line1, font: { bold: true,  size: 10, color: { argb: data.isLab ? 'FF1D4ED8' : 'FF111827' } } },
      ...(data.line2
        ? [
            { text: '\n' },
            { text: data.line2, font: { bold: false, size: 9, color: { argb: data.isLab ? 'FF3B82F6' : 'FF4B5563' } } },
          ]
        : []),
      ...(data.line3
        ? [
            { text: '\n' },
            { text: data.line3, font: { bold: false, size: 8, color: { argb: 'FF64748B' } } },
          ]
        : []),
      ...(isLabMergeStart ? [{ text: '\nLab', font: { bold: false, size: 8, italic: true, color: { argb: 'FF93C5FD' } } }] : []),
    ],
  };

  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: cellColorArgb(data) } };
  cell.border    = THIN_BORDER;
  cell.alignment = CENTER;
}

/** Excel sheet name: max 31 chars, no \\ / * ? : [ ] */
export function sanitizeExcelSheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[:\\/?*[\]]/g, '_').trim().slice(0, 31) || 'Timetable';
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = `_${n}`;
    name = (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
    n++;
  }
  used.add(name);
  return name;
}

/**
 * Append one timetable grid to a workbook as a new worksheet.
 */
export function addTimetableSheet(wb: ExcelJS.Workbook, grid: TimetableGrid, sheetName: string): void {
  const { title, subtitle, days, periods, cells } = grid;

  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const titleSpan = days.length + 1;

  ws.addRow([title]);
  ws.mergeCells(1, 1, 1, titleSpan);
  const titleCell = ws.getCell('A1');
  titleCell.font      = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.border    = {
    bottom: { style: 'medium', color: { argb: 'FF1E3A5F' } },
  };
  ws.getRow(1).height = 26;

  ws.addRow([subtitle]);
  ws.mergeCells(2, 1, 2, titleSpan);
  const subCell = ws.getCell('A2');
  subCell.font      = { size: 10, color: { argb: 'FF64748B' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 16;

  ws.addRow([]);
  ws.getRow(3).height = 6;

  ws.getColumn(1).width = 14;
  days.forEach((_, i) => { ws.getColumn(i + 2).width = 20; });

  const headerRow = ws.addRow(['Period / Time', ...days.map(d => d.name)]);
  headerRow.height = 26;
  headerRow.eachCell(cell => {
    cell.font      = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill      = HEADER_FILL;
    cell.border    = {
      ...THIN_BORDER,
      bottom: { style: 'medium', color: { argb: 'FF334155' } },
    };
    cell.alignment = CENTER;
  });

  const DATA_START_ROW = 5;

  for (let p = 0; p < periods.length; p++) {
    const period  = periods[p];
    const stripe  = p % 2 === 1;
    const excelRow = ws.addRow([
      `P ${period.periodNumber}\n${period.startTime}\n${period.endTime}`,
      ...Array(days.length).fill(''),
    ]);
    excelRow.height = 44;

    const periodCell = excelRow.getCell(1);
    periodCell.value = {
      richText: [
        { text: `P ${period.periodNumber}`, font: { bold: true, size: 10, color: { argb: 'FF1E293B' } } },
        { text: `\n${period.startTime} – ${period.endTime}`, font: { size: 9, color: { argb: 'FF94A3B8' } } },
      ],
    };
    periodCell.fill      = stripe ? PERIOD_FILL_ALT : PERIOD_FILL;
    periodCell.border    = THIN_BORDER;
    periodCell.alignment = CENTER;
  }

  for (let p = 0; p < periods.length; p++) {
    const excelRowNum = DATA_START_ROW + p;
    const stripe      = p % 2 === 1;

    for (let d = 0; d < days.length; d++) {
      const colNum  = d + 2;
      const cell    = cells[p][d];

      if (cell?.rowSpan === 0) continue;

      const excelCell = ws.getCell(excelRowNum, colNum);

      if (cell?.rowSpan === 2) {
        const mergeAddr = `${colLetter(colNum - 1)}${excelRowNum}:${colLetter(colNum - 1)}${excelRowNum + 1}`;
        ws.mergeCells(mergeAddr);
        applyDataCell(excelCell, cell, true, stripe);
      } else {
        applyDataCell(excelCell, cell ?? null, false, stripe);
      }
    }
  }

  const tableHeaderRow = 4;
  const tableLastRow   = DATA_START_ROW + periods.length - 1;
  const tableLastCol   = days.length + 1;
  outlineTableBlock(ws, tableHeaderRow, tableLastRow, 1, tableLastCol);

  const legendRowNum = DATA_START_ROW + periods.length + 1;
  const legendItems = [
    { label: 'Lab',        argb: 'FFDBEAFE' },
    { label: 'Games',      argb: 'FFDCFCE7' },
    { label: 'Yoga/Aer',   argb: 'FFF3E8FF' },
    { label: 'Library',    argb: 'FFFEF9C3' },
    { label: 'Innovation', argb: 'FFFFEDD5' },
    { label: 'W.E.',       argb: 'FFFCE7F3' },
  ];

  legendItems.forEach((item, idx) => {
    const colNum   = idx + 1;
    const lCell    = ws.getCell(legendRowNum, colNum);
    lCell.value    = item.label;
    lCell.fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: item.argb } };
    lCell.font     = { size: 8, color: { argb: 'FF374151' } };
    lCell.border   = THIN_BORDER;
    lCell.alignment = CENTER;
  });

  ws.getRow(legendRowNum).height = 16;

  const tsRow = ws.getRow(legendRowNum + 1);
  const tsCell = tsRow.getCell(titleSpan);
  tsCell.value    = `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  tsCell.font     = { size: 8, italic: true, color: { argb: 'FF9CA3AF' } };
  tsCell.alignment = { horizontal: 'right' };
  tsRow.height    = 14;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
}

export async function generateTimetableXlsx(grid: TimetableGrid): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Modern Indian School Timetable System';
  wb.created  = new Date();
  wb.modified = new Date();

  addTimetableSheet(wb, grid, 'Timetable');

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** One worksheet per grid (full school export). */
export async function generateBulkTimetableXlsx(grids: TimetableGrid[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator  = 'Modern Indian School Timetable System';
  wb.created  = new Date();
  wb.modified = new Date();

  const used = new Set<string>();
  for (const grid of grids) {
    const tail = grid.title.includes('—')
      ? grid.title.split('—').pop()!.trim()
      : grid.title;
    const short = tail.replace(/[\\/*?:[\]]/g, '_').slice(0, 31) || 'Timetable';
    const name = sanitizeExcelSheetName(short, used);
    addTimetableSheet(wb, grid, name);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
