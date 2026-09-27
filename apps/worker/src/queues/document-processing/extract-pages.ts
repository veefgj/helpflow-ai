// Section 5 "Parse (worker)": rejects encrypted PDFs, > 200 pages, or no extractable text with a
// DocumentErrorCode — these are non-retryable, so callers must not rethrow for BullMQ to retry.
import pdfParse from "pdf-parse";
import { DEFAULTS } from "@helpflow/config";
import { DocumentErrorCode } from "@helpflow/types";
import type { DocumentType } from "@helpflow/database";

export class NonRetryableIngestionError extends Error {
  constructor(
    public readonly code: DocumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NonRetryableIngestionError";
  }
}

export interface ExtractedPage {
  pageNumber: number | null;
  text: string;
}

function decodeUtf8OrThrow(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new NonRetryableIngestionError(DocumentErrorCode.NO_TEXT_EXTRACTED, "TXT file is not valid UTF-8");
  }
}

async function extractPdfPages(buffer: Buffer): Promise<ExtractedPage[]> {
  const pageTexts: string[] = [];

  let data;
  try {
    data = await pdfParse(buffer, {
      pagerender: (pageData: any) =>
        pageData.getTextContent().then((content: { items: Array<{ str: string }> }) => {
          const text = content.items.map((item) => item.str).join(" ");
          pageTexts.push(text);
          return text;
        }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("password") || message.includes("encrypt")) {
      throw new NonRetryableIngestionError(DocumentErrorCode.ENCRYPTED_PDF, "PDF requires a password");
    }
    throw new NonRetryableIngestionError(DocumentErrorCode.PARSE_FAILED, "Failed to parse PDF");
  }

  if (data.numpages > DEFAULTS.upload.maxPdfPages) {
    throw new NonRetryableIngestionError(
      DocumentErrorCode.TOO_MANY_PAGES,
      `PDF has ${data.numpages} pages, exceeding the ${DEFAULTS.upload.maxPdfPages}-page limit`,
    );
  }
  if (pageTexts.every((text) => !text.trim())) {
    throw new NonRetryableIngestionError(DocumentErrorCode.NO_TEXT_EXTRACTED, "No extractable text (scanned PDF without OCR?)");
  }

  return pageTexts.map((text, i) => ({ pageNumber: i + 1, text }));
}

export async function extractPages(buffer: Buffer, type: DocumentType): Promise<ExtractedPage[]> {
  if (type === "TXT") {
    const text = decodeUtf8OrThrow(buffer);
    if (!text.trim()) {
      throw new NonRetryableIngestionError(DocumentErrorCode.NO_TEXT_EXTRACTED, "TXT file is empty");
    }
    return [{ pageNumber: null, text }];
  }
  return extractPdfPages(buffer);
}

export function pageCountOf(pages: ExtractedPage[], type: DocumentType): number | null {
  if (type === "TXT") return null;
  return pages.length;
}
