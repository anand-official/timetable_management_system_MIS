import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as pdfMakeImport from 'pdfmake';

export interface DailySubstituteReportPeriod {
  periodNumber: number;
  startTime: string;
  endTime: string;
}

export interface DailySubstituteReportTeacherColumn {
  teacherId: string;
  teacherLabel: string;
}

export interface DailySubstituteReportCell {
  teacherId: string;
  periodNumber: number;
  sectionName: string;
  subjectName: string;
  subjectCode?: string;
  substituteTeacher?: string;
  status: 'Assigned' | 'Unassigned';
}

type PdfMakeSingleton = {
  setFonts: (fonts: typeof FONTS) => void;
  createPdf: (def: unknown) => { getBuffer: () => Promise<Buffer> };
  setUrlAccessPolicy?: (cb: (url: string) => boolean | undefined) => void;
};

const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

let pdfMakeSingleton: PdfMakeSingleton | null = null;
let logoDataUrlPromise: Promise<string | null> | null = null;

function loadPdfMake(): PdfMakeSingleton {
  if (pdfMakeSingleton) return pdfMakeSingleton;
  const mod = (
    typeof (pdfMakeImport as { default?: unknown }).default === 'object'
      ? (pdfMakeImport as { default: unknown }).default
      : pdfMakeImport
  ) as PdfMakeSingleton;
  mod.setUrlAccessPolicy?.(() => false);
  pdfMakeSingleton = mod;
  return mod;
}

async function loadSchoolLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = readFile(path.join(process.cwd(), 'public', 'logo.png'))
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch(() => null);
  }
  return logoDataUrlPromise;
}

function formatReportDate(dateValue: string) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function buildCellBlock(cell?: DailySubstituteReportCell) {
  if (!cell) {
    return {
      text: 'NO CLASS',
      fontSize: 8,
      color: '#94A3B8',
      alignment: 'center',
      margin: [2, 14, 2, 14],
      fillColor: '#F8FAFC',
    };
  }

  const statusColor = cell.status === 'Assigned' ? '#047857' : '#B45309';
  const statusFill = cell.status === 'Assigned' ? '#ECFDF5' : '#FFF7ED';

  return {
    stack: [
      { text: cell.sectionName, bold: true, fontSize: 8.5, color: '#0F172A' },
      { text: cell.subjectCode || cell.subjectName, fontSize: 8, color: '#334155', margin: [0, 1, 0, 0] },
      {
        text: cell.substituteTeacher ? `Substitute: ${cell.substituteTeacher}` : 'Substitute: Not assigned',
        fontSize: 8,
        color: statusColor,
        margin: [0, 3, 0, 0],
      },
    ],
    margin: [4, 5, 4, 5],
    fillColor: statusFill,
  };
}

export async function generateDailySubstitutePdf(args: {
  title: string;
  subtitle: string;
  schoolName: string;
  academicYear: string;
  reportDate: string;
  reportDay: string;
  periods: DailySubstituteReportPeriod[];
  teachers: DailySubstituteReportTeacherColumn[];
  cells: DailySubstituteReportCell[];
}) {
  const pdfMake = loadPdfMake();
  pdfMake.setFonts(FONTS);
  const logoDataUrl = await loadSchoolLogoDataUrl();

  const cellMap = new Map(
    args.cells.map((cell) => [`${cell.periodNumber}|${cell.teacherId}`, cell] as const)
  );

  const teacherColumnWidth = args.periods.length >= 8 ? 120 : 140;
  const periodColumnWidths: Array<number | string> = args.periods.map(() => '*');
  const pageSize = args.periods.length >= 9 ? 'A3' : 'A4';

  const body: any[][] = [
    [
      {
        text: 'Absent Teacher',
        bold: true,
        fontSize: 10,
        color: 'white',
        fillColor: '#0F172A',
        alignment: 'center',
        margin: [4, 8, 4, 8],
      },
      ...args.periods.map((period) => ({
        stack: [
          { text: `P${period.periodNumber}`, bold: true, fontSize: 9.5, color: 'white' },
          { text: `${period.startTime}-${period.endTime}`, fontSize: 7.5, color: '#CBD5E1', margin: [0, 2, 0, 0] },
        ],
        fillColor: '#0F172A',
        alignment: 'center',
        margin: [4, 7, 4, 7],
      })),
    ],
  ];

  for (const teacher of args.teachers) {
    body.push([
      {
        stack: [
          { text: teacher.teacherLabel, bold: true, fontSize: 9, color: '#0F172A' },
          { text: 'Absent Teacher', fontSize: 7.5, color: '#64748B', margin: [0, 2, 0, 0] },
        ],
        fillColor: '#F1F5F9',
        alignment: 'center',
        margin: [4, 8, 4, 8],
      },
      ...args.periods.map((period) =>
        buildCellBlock(cellMap.get(`${period.periodNumber}|${teacher.teacherId}`))
      ),
    ]);
  }

  const colWidths: Array<number | string> = [teacherColumnWidth, ...periodColumnWidths];
  const formattedDate = formatReportDate(args.reportDate);

  const output = pdfMake.createPdf({
    pageSize,
    pageOrientation: 'landscape',
    pageMargins: [24, 28, 24, 28],
    footer: (currentPage: number, pageCount: number) => ({
      margin: [24, 0, 24, 16],
      columns: [
        { text: 'Modern Indian School | Substitute Management Office', fontSize: 7.5, color: '#64748B' },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7.5, color: '#64748B', alignment: 'right' },
      ],
    }),
    content: [
      {
        columns: [
          logoDataUrl
            ? { image: logoDataUrl, width: 54, margin: [0, 2, 12, 0] }
            : { text: '', width: 54 },
          {
            width: '*',
            stack: [
              { text: args.schoolName, fontSize: 20, bold: true, color: '#0F172A', alignment: 'center' },
              { text: args.title, fontSize: 13, bold: true, color: '#0F172A', alignment: 'center', margin: [0, 6, 0, 0] },
            ],
          },
          {
            width: 150,
            table: {
              widths: [58, '*'],
              body: [
                [{ text: 'Date', bold: true, fontSize: 8.5, color: '#334155' }, { text: formattedDate, fontSize: 8.5, color: '#0F172A' }],
                [{ text: 'Day', bold: true, fontSize: 8.5, color: '#334155' }, { text: args.reportDay, fontSize: 8.5, color: '#0F172A' }],
                [{ text: 'Report', bold: true, fontSize: 8.5, color: '#334155' }, { text: 'Substitute Duty Sheet', fontSize: 8.5, color: '#0F172A' }],
              ],
            },
            layout: {
              fillColor: (rowIndex: number) => (rowIndex % 2 === 0 ? '#F8FAFC' : '#FFFFFF'),
              hLineColor: () => '#CBD5E1',
              vLineColor: () => '#CBD5E1',
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              paddingLeft: () => 6,
              paddingRight: () => 6,
              paddingTop: () => 5,
              paddingBottom: () => 5,
            },
          },
        ],
        columnGap: 8,
      },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 0, x2: 780, y2: 0, lineWidth: 1, lineColor: '#CBD5E1' },
        ],
        margin: [0, 10, 0, 12],
      },
      {
        text: 'Official daily substitute allocation for internal academic circulation.',
        fontSize: 8.5,
        color: '#64748B',
        italics: true,
        margin: [0, 0, 0, 10],
      },
      args.teachers.length === 0
        ? { text: 'No absent teachers or substitute entries found for this day.', fontSize: 11, color: '#64748B' }
        : {
            table: {
              headerRows: 1,
              widths: colWidths,
              body,
            },
            layout: {
              hLineColor: () => '#CBD5E1',
              vLineColor: () => '#CBD5E1',
              hLineWidth: () => 0.6,
              vLineWidth: () => 0.6,
              paddingLeft: () => 2,
              paddingRight: () => 2,
              paddingTop: () => 1,
              paddingBottom: () => 1,
            },
          },
      {
        margin: [0, 14, 0, 0],
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
        text: `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
        fontSize: 7.5,
        color: '#94A3B8',
        alignment: 'right',
        margin: [0, 8, 0, 0],
      },
    ],
    defaultStyle: { font: 'Helvetica', fontSize: 9 },
  });

  return output.getBuffer();
}
