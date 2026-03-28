/**
 * pdfmake-based PDF generator for class and teacher timetables.
 * Uses only built-in PDF standard fonts (Helvetica) — no font files required.
 *
 * Keep the import statically analyzable so Next/Vercel traces the package into
 * the route bundle while `serverExternalPackages` keeps it on the Node side.
 */

import * as pdfMakeImport from 'pdfmake';
import { TimetableGrid, CellData, cellColor } from './timetable-grid';

/** pdfmake rowSpan + omitted columns is fragile; duplicate lab 2nd period as a normal cell. */
function flattenGridCellsForPdf(cells: (CellData | null)[][]): (CellData | null)[][] {
  const out: (CellData | null)[][] = cells.map((row) =>
    row.map((c) => (c ? { ...c } : null))
  );
  for (let p = 0; p < out.length; p++) {
    for (let d = 0; d < (out[p]?.length ?? 0); d++) {
      const c = out[p][d];
      const above = p > 0 ? out[p - 1][d] : null;
      if (c?.rowSpan === 0) {
        out[p][d] = above
          ? {
              line1: above.line1,
              line2: above.line2,
              isLab: above.isLab,
              isGames: above.isGames,
              isYoga: above.isYoga,
              isLibrary: above.isLibrary,
              isInnovation: above.isInnovation,
              isWE: above.isWE,
              subjectId: above.subjectId,
            }
          : null;
      } else if (c && c.rowSpan === 2) {
        const { rowSpan: _r, ...rest } = c;
        out[p][d] = rest as CellData;
      }
    }
  }
  return out;
}

const FONTS = {
  Helvetica: {
    normal:      'Helvetica',
    bold:        'Helvetica-Bold',
    italics:     'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

type PdfMakeSingleton = {
  setFonts: (fonts: typeof FONTS) => void;
  createPdf: (def: unknown) => { getBuffer: () => Promise<Buffer> };
  setUrlAccessPolicy?: (cb: (url: string) => boolean | undefined) => void;
};

let pdfMakeSingleton: PdfMakeSingleton | null = null;

function loadPdfMake(): PdfMakeSingleton {
  if (pdfMakeSingleton) return pdfMakeSingleton;
  const mod = (
    typeof (pdfMakeImport as { default?: unknown }).default === 'object'
      ? (pdfMakeImport as { default: unknown }).default
      : pdfMakeImport
  ) as PdfMakeSingleton;
  if (typeof mod?.setFonts !== 'function' || typeof mod?.createPdf !== 'function') {
    throw new Error(
      'pdfmake failed to load (missing setFonts/createPdf). Ensure it is installed and bundled for the server runtime.'
    );
  }
  mod.setUrlAccessPolicy?.(() => false);
  pdfMakeSingleton = mod;
  return mod;
}

const HEADER_BG   = '#0F172A';
const PERIOD_BG   = '#F1F5F9';
const PERIOD_BG_ALT = '#E2E8F0';
const EMPTY_BG    = '#FAFAFA';
const EMPTY_BG_ALT = '#F4F6F8';
const LABEL_TEXT  = '#64748B';

function buildDataCell(cell: CellData | null, rowStripe: boolean): any {
  if (!cell) {
    return { text: '', fillColor: rowStripe ? EMPTY_BG_ALT : EMPTY_BG };
  }

  const bg          = cellColor(cell);
  const line1Color  = cell.isLab ? '#1D4ED8' : '#111827';
  const line2Color  = cell.isLab ? '#3B82F6' : '#4B5563';
  const line3Color  = '#64748B';
  const stack = [
    { text: cell.line1, bold: true, fontSize: 9.5, color: line1Color },
  ];

  if (cell.line2) {
    stack.push({ text: cell.line2, bold: false, fontSize: 8.5, color: line2Color });
  }

  if (cell.line3) {
    stack.push({ text: cell.line3, bold: false, fontSize: 7.5, color: line3Color });
  }

  return {
    stack,
    alignment: 'center',
    margin: [3, 5, 3, 5],
    fillColor: bg,
  };
}

function buildPeriodCell(
  periodNumber: number,
  startTime: string,
  endTime: string,
  stripe: boolean,
): any {
  return {
    stack: [
      { text: `P ${periodNumber}`, bold: true,  fontSize: 9.5,  color: '#1E293B' },
      { text: startTime,           bold: false, fontSize: 7.5,  color: LABEL_TEXT },
      { text: endTime,             bold: false, fontSize: 7.5,  color: LABEL_TEXT },
    ],
    alignment: 'center',
    margin: [3, 5, 3, 5],
    fillColor: stripe ? PERIOD_BG_ALT : PERIOD_BG,
  };
}

function buildTableBody(grid: TimetableGrid): any[][] {
  const { days, periods, cells: rawCells } = grid;
  const cells = flattenGridCellsForPdf(rawCells);

  const headerRow: any[] = [
    {
      text:      'Period / Time',
      bold:      true,
      fontSize:  10,
      color:     'white',
      alignment: 'center',
      fillColor: HEADER_BG,
      margin:    [4, 8, 4, 8],
    },
    ...days.map(d => ({
      text:      d.name,
      bold:      true,
      fontSize:  10,
      color:     'white',
      alignment: 'center',
      fillColor: HEADER_BG,
      margin:    [4, 8, 4, 8],
    })),
  ];

  const rows: any[][] = [headerRow];

  for (let p = 0; p < periods.length; p++) {
    const period = periods[p];
    const stripe = p % 2 === 1;
    const row: any[] = [
      buildPeriodCell(period.periodNumber, period.startTime, period.endTime, stripe),
    ];

    for (let d = 0; d < days.length; d++) {
      row.push(buildDataCell(cells[p]?.[d] ?? null, stripe));
    }

    rows.push(row);
  }

  return rows;
}

function buildLegend(): any {
  const items = [
    { label: 'Lab',        color: '#DBEAFE' },
    { label: 'Games',      color: '#DCFCE7' },
    { label: 'Yoga/Aer',   color: '#F3E8FF' },
    { label: 'Library',    color: '#FEF9C3' },
    { label: 'Innovation', color: '#FFEDD5' },
    { label: 'W.E./Music/Dance/Art', color: '#FCE7F3' },
  ];

  return {
    columns: items.map(item => ({
      columns: [
        { canvas: [{ type: 'rect', x: 0, y: 2, w: 10, h: 10, color: item.color }], width: 14 },
        { text: item.label, fontSize: 7, color: '#374151', margin: [0, 2, 8, 0] },
      ],
      width: 'auto',
    })),
    margin: [0, 8, 0, 0],
  };
}

/** One timetable table + legend + footer (for single or multi-page PDF). */
export function buildPdfContentBlocks(grid: TimetableGrid): any[] {
  const nDays = grid.days.length;
  const colWidths: (string | number)[] = [52, ...Array(nDays).fill('*')];
  const tableBody = buildTableBody(grid);

  return [
    {
      stack: [
        { text: grid.title, style: 'title' },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 3, x2: 780, y2: 3, lineWidth: 1.25, lineColor: '#1E3A5F' },
          ],
          margin: [0, 0, 0, 2],
        },
      ],
      margin: [0, 0, 0, 2],
    },
    { text: grid.subtitle, style: 'subtitle' },
    { text: ' ', margin: [0, 6] },
    {
      table: {
        headerRows: 1,
        widths:     colWidths,
        body:       tableBody,
      },
      layout: {
        hLineWidth(i: number, node: any) {
          if (i === 0 || i === node.table.body.length) return 1.2;
          if (i === 1) return 1;
          return 0.45;
        },
        vLineWidth(i: number, node: any) {
          const n = node.table.widths.length;
          if (i === 0 || i === n) return 1;
          return 0.45;
        },
        hLineColor: () => '#94A3B8',
        vLineColor: () => '#94A3B8',
        paddingLeft:   () => 0,
        paddingRight:  () => 0,
        paddingTop:    () => 0,
        paddingBottom: () => 0,
      },
    },
    buildLegend(),
    {
      margin: [0, 40, 0, 0],
      columns: [
        {
          width: '50%',
          stack: [
            { text: '______________________________', fontSize: 9, color: '#0F172A' },
            { text: 'Principal', fontSize: 8.5, bold: true, color: '#334155', margin: [0, 3, 0, 0] },
            { text: 'Retd. Col. Raju Peter', fontSize: 8, color: '#475569' },
          ],
        },
        {
          width: '50%',
          alignment: 'right',
          stack: [
            { text: '______________________________', fontSize: 9, color: '#0F172A' },
            { text: 'Time Table Incharge', fontSize: 8.5, bold: true, color: '#334155', margin: [0, 3, 0, 0] },
            { text: 'A.K. Jha', fontSize: 8, color: '#475569' },
          ],
        },
      ],
    },
    {
      text:      `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      fontSize:  7,
      color:     LABEL_TEXT,
      alignment: 'right',
      margin:    [0, 6, 0, 0],
    },
  ];
}

async function createPdfBuffer(content: any[]): Promise<Buffer> {
  const pdfMake = loadPdfMake();
  pdfMake.setFonts(FONTS);

  const docDefinition: any = {
    pageOrientation: 'landscape',
    pageSize:        'A4',
    pageMargins:     [28, 40, 28, 40],
    content,
    styles: {
      title:    { fontSize: 16, bold: true,  color: '#0F172A', margin: [0, 0, 0, 0] },
      subtitle: { fontSize: 9.5, bold: false, color: LABEL_TEXT, margin: [0, 2, 0, 0] },
    },
    defaultStyle: { font: 'Helvetica', fontSize: 9.5 },
  };

  const output = pdfMake.createPdf(docDefinition);
  return output.getBuffer();
}

export async function generateTimetablePdf(grid: TimetableGrid): Promise<Buffer> {
  return createPdfBuffer(buildPdfContentBlocks(grid));
}

/** One landscape page per timetable (full school export). */
export async function generateBulkTimetablePdf(grids: TimetableGrid[]): Promise<Buffer> {
  if (grids.length === 0) {
    return createPdfBuffer([
      { text: 'No timetables to export', style: 'title' },
    ]);
  }

  const content: any[] = [];
  for (let i = 0; i < grids.length; i++) {
    if (i > 0) content.push({ text: '', pageBreak: 'before' });
    content.push(...buildPdfContentBlocks(grids[i]));
  }

  return createPdfBuffer(content);
}
