export interface PdfExtractorOptions {
  maxBytes?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export interface PdfExtractionResult {
  ok: boolean;
  text: string;
  pageCount: number;
  truncated: boolean;
  error?: string;
}

export interface IPdfTextExtractor {
  extract(
    buffer: Buffer | Uint8Array,
    options?: PdfExtractorOptions,
  ): Promise<PdfExtractionResult>;
}

export const DEFAULT_MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_MAX_PDF_PAGES = 25;
export const DEFAULT_PDF_TIMEOUT_MS = 10_000;

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

function hasPdfHeader(data: Uint8Array): boolean {
  const searchLen = Math.min(data.byteLength, 1024);
  if (searchLen < PDF_MAGIC.length) {
    return false;
  }
  const slice = Buffer.from(data.buffer, data.byteOffset, searchLen);
  return slice.indexOf(PDF_MAGIC) !== -1;
}

function toCleanUint8Array(input: Buffer | Uint8Array): Uint8Array {
  const copy = new Uint8Array(input.byteLength);
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  return copy;
}

export class UnpdfTextExtractor implements IPdfTextExtractor {
  private readonly defaultOptions: Required<PdfExtractorOptions>;

  constructor(options: PdfExtractorOptions = {}) {
    this.defaultOptions = {
      maxBytes: options.maxBytes ?? DEFAULT_MAX_PDF_BYTES,
      maxPages: options.maxPages ?? DEFAULT_MAX_PDF_PAGES,
      timeoutMs: options.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS,
    };
  }

  async extract(
    buffer: Buffer | Uint8Array,
    options?: PdfExtractorOptions,
  ): Promise<PdfExtractionResult> {
    const maxBytes = options?.maxBytes ?? this.defaultOptions.maxBytes;
    const maxPages = options?.maxPages ?? this.defaultOptions.maxPages;
    const timeoutMs = options?.timeoutMs ?? this.defaultOptions.timeoutMs;

    if (!buffer || buffer.byteLength === 0) {
      return {
        ok: false,
        text: "",
        pageCount: 0,
        truncated: false,
        error: "PDF buffer is empty",
      };
    }

    if (buffer.byteLength > maxBytes) {
      return {
        ok: false,
        text: "",
        pageCount: 0,
        truncated: false,
        error: `PDF exceeds maximum allowed size of ${maxBytes} bytes (got ${buffer.byteLength} bytes)`,
      };
    }

    if (!hasPdfHeader(buffer)) {
      return {
        ok: false,
        text: "",
        pageCount: 0,
        truncated: false,
        error: "Invalid PDF header: missing %PDF- signature",
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let proxy: unknown = null;

    try {
      const work = (async (): Promise<PdfExtractionResult> => {
        const { getDocumentProxy, extractText } = await import("unpdf");
        const data = toCleanUint8Array(buffer);
        const pdf = await getDocumentProxy(data);
        proxy = pdf;

        const extracted = await extractText(pdf, { mergePages: false });
        const totalPages =
          typeof extracted.totalPages === "number" ? extracted.totalPages : 0;
        const pages = Array.isArray(extracted.text)
          ? extracted.text
          : [String(extracted.text ?? "")];

        const truncated = totalPages > maxPages || pages.length > maxPages;
        const keptPages = pages.slice(0, maxPages);
        const text = keptPages
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .join("\n\n")
          .trim();

        return {
          ok: true,
          text,
          pageCount: totalPages || keptPages.length,
          truncated,
        };
      })();
      work.catch(() => undefined);

      const timeoutPromise = new Promise<PdfExtractionResult>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`PDF extraction timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      return await Promise.race([work, timeoutPromise]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to extract PDF text";
      return {
        ok: false,
        text: "",
        pageCount: 0,
        truncated: false,
        error: message,
      };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (proxy && typeof proxy === "object") {
        const disposable = proxy as {
          destroy?: () => Promise<void> | void;
          cleanup?: () => Promise<void> | void;
        };
        try {
          if (typeof disposable.destroy === "function") {
            await disposable.destroy();
          } else if (typeof disposable.cleanup === "function") {
            await disposable.cleanup();
          }
        } catch {
          // Ignore cleanup errors on already-disposed or corrupt PDF proxies
        }
      }
    }
  }
}
