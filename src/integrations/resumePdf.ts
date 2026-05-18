import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { fileURLToPath } from "node:url";

export type ResumeLineKind = "heading" | "bullet" | "contact" | "body";

export type ResumeLine = {
  id: string;
  pageIndex: number;
  text: string;
  kind: ResumeLineKind;
  canEdit: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  maxChars: number;
};

export type ExtractedResumePdf = {
  pageCount: number;
  lines: ResumeLine[];
};

export type ResumeLineChange = {
  lineId: string;
  replacementText: string;
  reason: string;
};

export type AppliedResumeLineChange = ResumeLineChange & {
  pageIndex: number;
  originalText: string;
};

export type RejectedResumeLineChange = ResumeLineChange & {
  pageIndex: number;
  originalText: string;
  rejectionReason: string;
};

type RawTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type LineFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
};

type LineAccumulator = {
  fragments: LineFragment[];
  y: number;
};

const BULLET_PREFIX_RE = /^[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25CF\-*]\s+/;
const CONTACT_RE =
  /(@|linkedin\.com|github\.com|portfolio|https?:\/\/|\+?\d[\d\s().-]{6,})/i;

function isRawTextItem(value: unknown): value is RawTextItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RawTextItem>;
  return (
    typeof candidate.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    typeof candidate.fontName === "string" &&
    typeof candidate.hasEOL === "boolean"
  );
}

function normalizeItemText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function classifyLine(text: string): ResumeLineKind {
  if (BULLET_PREFIX_RE.test(text)) {
    return "bullet";
  }

  if (CONTACT_RE.test(text)) {
    return "contact";
  }

  const lettersOnly = text.replace(/[^A-Za-z]/g, "");
  const uppercaseOnly = lettersOnly.replace(/[^A-Z]/g, "");
  const uppercaseRatio =
    lettersOnly.length === 0 ? 0 : uppercaseOnly.length / lettersOnly.length;

  if (
    text.length <= 56 &&
    lettersOnly.length > 0 &&
    uppercaseRatio >= 0.65 &&
    !/[.?!]/.test(text)
  ) {
    return "heading";
  }

  return "body";
}

function getFontSize(item: RawTextItem) {
  const [, b = 0, c = 0, d = 0] = item.transform;
  const scaleY = Math.hypot(c, d);
  const scaleX = Math.hypot(item.transform[0] ?? 0, b);
  return Math.max(item.height, scaleY, scaleX, 1);
}

function finalizeLine(
  pageIndex: number,
  lineNumber: number,
  accumulator: LineAccumulator,
): ResumeLine | null {
  const fragments = accumulator.fragments.sort((left, right) => left.x - right.x);
  if (fragments.length === 0) {
    return null;
  }

  let content = "";
  let rightEdge = 0;
  let widestRightEdge = 0;
  let smallestX = Number.POSITIVE_INFINITY;
  let tallest = 0;
  let largestFontSize = 0;
  let fontName = fragments[0]?.fontName ?? "Helvetica";

  for (const fragment of fragments) {
    const gap = fragment.x - rightEdge;
    const needsSpace =
      content.length > 0 &&
      gap > Math.max(fragment.fontSize * 0.15, 1.5) &&
      !content.endsWith("/") &&
      !fragment.text.startsWith(",") &&
      !fragment.text.startsWith(".") &&
      !fragment.text.startsWith(")");

    if (needsSpace) {
      content += " ";
    }

    content += fragment.text;
    rightEdge = fragment.x + fragment.width;
    widestRightEdge = Math.max(widestRightEdge, rightEdge);
    smallestX = Math.min(smallestX, fragment.x);
    tallest = Math.max(tallest, fragment.height, fragment.fontSize);
    if (fragment.fontSize >= largestFontSize) {
      largestFontSize = fragment.fontSize;
      fontName = fragment.fontName;
    }
  }

  const text = normalizeLineText(content);
  if (!text) {
    return null;
  }

  const width = Math.max(widestRightEdge - smallestX, 8);
  const fontSize = Math.max(largestFontSize, 8);
  const maxChars = Math.max(text.length, Math.floor(width / (fontSize * 0.52)));
  const kind = classifyLine(text);

  return {
    id: `p${pageIndex + 1}-l${lineNumber + 1}`,
    pageIndex,
    text,
    kind,
    canEdit: kind === "bullet" || kind === "body",
    x: smallestX,
    y: accumulator.y,
    width,
    height: Math.max(tallest, fontSize),
    fontSize,
    fontName,
    maxChars,
  };
}

function sanitizeReplacementText(originalText: string, replacementText: string) {
  const sanitized = normalizeLineText(replacementText.replace(/\n+/g, " "));
  if (!sanitized) {
    return "";
  }

  if (!BULLET_PREFIX_RE.test(originalText)) {
    return sanitized;
  }

  const bulletMatch = originalText.match(BULLET_PREFIX_RE);
  if (!bulletMatch) {
    return sanitized;
  }

  const bulletPrefix = bulletMatch[0];
  const withoutBullet = sanitized.replace(BULLET_PREFIX_RE, "");
  return `${bulletPrefix}${withoutBullet}`.trimEnd();
}

function pickStandardFontName(fontName: string) {
  const normalized = fontName.toLowerCase();

  if (normalized.includes("cour")) {
    return StandardFonts.Courier;
  }

  if (normalized.includes("times") || normalized.includes("garamond")) {
    return normalized.includes("bold")
      ? StandardFonts.TimesRomanBold
      : StandardFonts.TimesRoman;
  }

  if (normalized.includes("bold")) {
    return StandardFonts.HelveticaBold;
  }

  if (normalized.includes("oblique") || normalized.includes("italic")) {
    return StandardFonts.HelveticaOblique;
  }

  return StandardFonts.Helvetica;
}

async function getFont(
  pdfDoc: PDFDocument,
  cache: Map<string, PDFFont>,
  fontName: string,
) {
  const standardFontName = pickStandardFontName(fontName);
  const cachedFont = cache.get(standardFontName);
  if (cachedFont) {
    return cachedFont;
  }

  const font = await pdfDoc.embedFont(standardFontName);
  cache.set(standardFontName, font);
  return font;
}

function fitsLine(font: PDFFont, text: string, fontSize: number, width: number) {
  return font.widthOfTextAtSize(text, fontSize) <= width + 1.5;
}

function getTextY(line: ResumeLine) {
  return Math.max(line.y - line.fontSize * 0.18, 0);
}

async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function extractResumePdf(
  pdfBuffer: Buffer,
): Promise<ExtractedResumePdf> {
  const pdfjsLib = await loadPdfJs();
  const standardFontDataUrl = fileURLToPath(
    new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
  );
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: false,
    standardFontDataUrl,
  });

  const pdf = await loadingTask.promise;
  const lines: ResumeLine[] = [];

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const rawItems = textContent.items as unknown[];
    const items = rawItems.filter(isRawTextItem).map((item) => ({
      text: normalizeItemText(item.str),
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      fontSize: getFontSize(item),
      hasEOL: item.hasEOL,
    }));

    const sortedItems = items
      .filter((item) => item.text.length > 0)
      .sort((left, right) => {
        const yDelta = Math.abs(left.y - right.y);
        if (yDelta <= 2) {
          return left.x - right.x;
        }
        return right.y - left.y;
      });

    let currentLine: LineAccumulator | null = null;
    let lineNumber = 0;

    for (const item of sortedItems) {
      if (!currentLine || Math.abs(currentLine.y - item.y) > 2) {
        const finalized = currentLine
          ? finalizeLine(pageIndex, lineNumber, currentLine)
          : null;
        if (finalized) {
          lines.push(finalized);
          lineNumber += 1;
        }

        currentLine = {
          y: item.y,
          fragments: [],
        };
      }

      currentLine.fragments.push({
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontName: item.fontName,
        fontSize: item.fontSize,
      });

      if (item.hasEOL && currentLine) {
        const finalized = finalizeLine(pageIndex, lineNumber, currentLine);
        if (finalized) {
          lines.push(finalized);
          lineNumber += 1;
        }
        currentLine = null;
      }
    }

    if (currentLine) {
      const finalized = finalizeLine(pageIndex, lineNumber, currentLine);
      if (finalized) {
        lines.push(finalized);
      }
    }
  }

  return {
    pageCount: pdf.numPages,
    lines,
  };
}

export async function renderTailoredResumePdf(params: {
  pdfBuffer: Buffer;
  extractedResume: ExtractedResumePdf;
  changes: ResumeLineChange[];
}) {
  const pdfDoc = await PDFDocument.load(params.pdfBuffer);
  const fontCache = new Map<string, PDFFont>();
  const pages = pdfDoc.getPages();
  const lineMap = new Map(
    params.extractedResume.lines.map((line) => [line.id, line] as const),
  );

  const appliedChanges: AppliedResumeLineChange[] = [];
  const rejectedChanges: RejectedResumeLineChange[] = [];
  const seenLineIds = new Set<string>();

  for (const change of params.changes) {
    const line = lineMap.get(change.lineId);
    if (!line) {
      continue;
    }

    if (seenLineIds.has(change.lineId)) {
      rejectedChanges.push({
        ...change,
        pageIndex: line.pageIndex,
        originalText: line.text,
        rejectionReason: "duplicate line change",
      });
      continue;
    }

    seenLineIds.add(change.lineId);

    if (!line.canEdit) {
      rejectedChanges.push({
        ...change,
        pageIndex: line.pageIndex,
        originalText: line.text,
        rejectionReason: "line is not editable",
      });
      continue;
    }

    const replacementText = sanitizeReplacementText(
      line.text,
      change.replacementText,
    );

    if (!replacementText || replacementText === line.text) {
      continue;
    }

    if (replacementText.length > line.maxChars) {
      rejectedChanges.push({
        ...change,
        replacementText,
        pageIndex: line.pageIndex,
        originalText: line.text,
        rejectionReason: "replacement exceeds one-line limit",
      });
      continue;
    }

    const page = pages[line.pageIndex];
    if (!page) {
      continue;
    }

    const font = await getFont(pdfDoc, fontCache, line.fontName);
    if (!fitsLine(font, replacementText, line.fontSize, line.width)) {
      rejectedChanges.push({
        ...change,
        replacementText,
        pageIndex: line.pageIndex,
        originalText: line.text,
        rejectionReason: "replacement width exceeds original line width",
      });
      continue;
    }

    overwriteLine(page, line, font, replacementText);

    appliedChanges.push({
      ...change,
      replacementText,
      pageIndex: line.pageIndex,
      originalText: line.text,
    });
  }

  return {
    pdfBuffer: Buffer.from(await pdfDoc.save()),
    appliedChanges,
    rejectedChanges,
  };
}

function overwriteLine(
  page: PDFPage,
  line: ResumeLine,
  font: PDFFont,
  replacementText: string,
) {
  const paddingX = Math.max(line.fontSize * 0.15, 1);
  const paddingY = Math.max(line.fontSize * 0.2, 1.5);
  const textY = getTextY(line);

  page.drawRectangle({
    x: Math.max(line.x - paddingX, 0),
    y: Math.max(textY - paddingY, 0),
    width: line.width + paddingX * 2,
    height: line.height + paddingY * 2,
    color: rgb(1, 1, 1),
  });

  page.drawText(replacementText, {
    x: line.x,
    y: textY,
    size: line.fontSize,
    font,
    color: rgb(0, 0, 0),
    lineHeight: line.height,
  });
}
