import { createHash } from "node:crypto";
import { deterministicId } from "../agent/graph-operations";
import type { ContentSegment, SourceArtifact } from "./contracts";

/**
 * P3-4 multi-modal ingestion adapters (image/pdf only; audio/video are out of
 * scope for this iteration).
 *
 * - image: OCR via tesseract.js (chi_sim+eng).
 * - pdf: text-layer extraction via pdfjs-dist; falls back to page-render OCR
 *   for scanned PDFs (rendered with @napi-rs/canvas, then OCR).
 *
 * Adapters produce normalized ContentSegments so the pipeline
 * (claim extraction → graph matching → candidate) can consume them uniformly.
 */

export type ParseableKind = "image" | "pdf";

export interface ParsedFileText {
  artifact: SourceArtifact;
  segments: readonly ContentSegment[];
  /** Free-form notes about extraction (e.g. OCR language, page count). */
  notes?: string[];
}

function checksumOf(file: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(file)).digest("hex").slice(0, 24);
}

function mimeOfKind(kind: ParseableKind, originalMime: string | undefined): string {
  if (originalMime) return originalMime;
  return kind === "pdf" ? "application/pdf" : "image/png";
}

function segmentFrom(artifact: SourceArtifact, text: string): ContentSegment[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n|(?<=[。！？.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6);
  return paragraphs.slice(0, 40).map((item, order) => ({
    id: `${artifact.id}:segment:${order + 1}`,
    artifactId: artifact.id,
    order,
    text: item,
    locator: `segment:${order + 1}`,
  }));
}

/** Lazy, cached OCR engine shared across image & scanned-pdf paths. */
let ocrPromise: Promise<{ recognize: (data: Uint8Array) => Promise<string> }> | undefined;
async function loadOcr(): Promise<{ recognize: (data: Uint8Array) => Promise<string> }> {
  if (!ocrPromise) {
    ocrPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("chi_sim+eng");
      return {
        async recognize(data: Uint8Array) {
          const result = await worker.recognize(Buffer.from(data));
          return result.data.text ?? "";
        },
      };
    })();
  }
  return ocrPromise;
}

export async function extractImage(file: Uint8Array, title: string, suppliedBy: string, originalMime?: string): Promise<ParsedFileText> {
  const checksum = checksumOf(file);
  const artifact: SourceArtifact = {
    id: deterministicId("artifact", { kind: "image", title, checksum }),
    title,
    kind: "image",
    modality: "image",
    mimeType: mimeOfKind("image", originalMime),
    checksum,
    suppliedAt: new Date().toISOString(),
    suppliedBy,
  };
    const notes: string[] = [];
    let text = "";
    try {
      const ocr = await loadOcr();
      text = await ocr.recognize(file);
      notes.push("OCR 识别（中英文）");
      if (!text.trim()) notes.push("未识别到文字，请确认图片包含清晰文本。");
    } catch (error) {
      notes.push(`OCR 失败：${error instanceof Error ? error.message : "unknown error"}`);
    }
    return { artifact, segments: segmentFrom(artifact, text), notes };
}

export async function extractPdf(file: Uint8Array, title: string, suppliedBy: string, originalMime?: string): Promise<ParsedFileText> {
  const checksum = checksumOf(file);
  const artifact: SourceArtifact = {
    id: deterministicId("artifact", { kind: "document", title, checksum }),
    title,
    kind: "document",
    modality: "document",
    mimeType: mimeOfKind("pdf", originalMime),
    checksum,
    suppliedAt: new Date().toISOString(),
    suppliedBy,
  };
  const notes: string[] = [];
  let text = "";
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ data: file, useWorkerFetch: false, useSystemFonts: true }).promise;
    notes.push(`共 ${doc.numPages} 页`);
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items = content.items as unknown as Array<{ str?: string }>;
      const pageText = items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) pageTexts.push(pageText);
    }
    text = pageTexts.join("\n");
    if (!text.trim()) {
      notes.push("PDF 无文本层（可能为扫描件），尝试逐页 OCR…");
      text = await ocrScannedPdf(file);
    }
  } catch (error) {
    notes.push(`PDF 解析失败：${error instanceof Error ? error.message : "unknown error"}`);
    text = "";
  }
  return { artifact, segments: segmentFrom(artifact, text), notes };
}

async function ocrScannedPdf(file: Uint8Array): Promise<string> {
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await import("@napi-rs/canvas");
    const ocr = await loadOcr();
    const doc = await getDocument({ data: file, useWorkerFetch: false, useSystemFonts: true }).promise;
    const pageTexts: string[] = [];
    const pageCount = Math.min(doc.numPages, 8); // bound OCR cost
    for (let i = 1; i <= pageCount; i += 1) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      const renderTask = page.render({ canvas, canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]);
      await renderTask.promise;
      const png = canvas.toBuffer("image/png");
      const pageText = await ocr.recognize(new Uint8Array(png));
      if (pageText.trim()) pageTexts.push(pageText);
    }
    return pageTexts.join("\n");
  } catch {
    return "";
  }
}

export function supportsFile(kind: "image" | "pdf", mimeType: string): boolean {
  if (kind === "pdf" || mimeType === "application/pdf") return true;
  return kind === "image" && /^image\/(png|jpe?g|webp|bmp|gif)$/.test(mimeType);
}

export async function extractFile(kind: "image" | "pdf", file: Uint8Array, title: string, suppliedBy: string, originalMime?: string): Promise<ParsedFileText> {
  if (kind === "pdf" || originalMime === "application/pdf") return extractPdf(file, title, suppliedBy, originalMime);
  return extractImage(file, title, suppliedBy, originalMime);
}
