// Section 5 "Upload (API)": size, extension, declared MIME and magic bytes, all checked before the
// file ever reaches storage or the worker.
import { extname } from "node:path";
import { DEFAULTS } from "@helpflow/config";
import type { DocumentType } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";

export function detectDocumentType(filename: string, mimetype: string): DocumentType {
  const ext = extname(filename).toLowerCase();
  for (const [type, rule] of Object.entries(DEFAULTS.upload.allowed) as Array<[DocumentType, (typeof DEFAULTS.upload.allowed)["PDF"]]>) {
    if ((rule.ext as readonly string[]).includes(ext) && (rule.mime as readonly string[]).includes(mimetype)) {
      return type;
    }
  }
  throw new HelpFlowApiException(ApiErrorCode.UNSUPPORTED_FILE_TYPE, `Unsupported file: ${filename} (${mimetype})`);
}

export function validateMagicBytes(buffer: Buffer, type: DocumentType): void {
  if (type === "PDF") {
    if (buffer.subarray(0, 5).toString("latin1") !== DEFAULTS.upload.allowed.PDF.magic) {
      throw new HelpFlowApiException(ApiErrorCode.UNSUPPORTED_FILE_TYPE, "File is not a valid PDF");
    }
    return;
  }
  // TXT must decode as valid UTF-8.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new HelpFlowApiException(ApiErrorCode.UNSUPPORTED_FILE_TYPE, "File is not valid UTF-8 text");
  }
}

export function assertFileSize(sizeBytes: number): void {
  const maxBytes = DEFAULTS.upload.maxFileSizeMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new HelpFlowApiException(ApiErrorCode.FILE_TOO_LARGE, `File exceeds the ${DEFAULTS.upload.maxFileSizeMb}MB limit`);
  }
}
