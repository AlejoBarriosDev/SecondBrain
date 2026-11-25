import { ParserSource, Prisma, TransactionType } from "@prisma/client";
import {
  type ILlmParserClient,
  OpenAiCompatibleLlmClient,
} from "@/lib/integrations/llm-client";
import {
  type IPdfTextExtractor,
  UnpdfTextExtractor,
} from "@/lib/integrations/pdf-extractor";
import { parseWithRules } from "./rule-parser";

const MAX_DECIMAL_19_4 = new Prisma.Decimal("999999999999999.9999");
export const DEFAULT_LLM_FALLBACK_THRESHOLD = 0.7;

export interface HybridParsePdfInput {
  fileName: string;
  buffer: Buffer;
}

export interface HybridParseInput {
  fromAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  pdfAttachments?: HybridParsePdfInput[];
  defaultCurrency?: string;
  aiParserEnabled?: boolean;
}

export interface HybridParseOutput {
  parserSource: ParserSource;
  parserNotes: string | null;
  confidence: string; // Decimal(5,4) string e.g. "0.9000"
  parsedType: TransactionType | null;
  parsedAmount: string | null; // Decimal(19,4) string or null
  parsedCurrency: string | null; // 3-char uppercase ISO or null
  parsedMerchant: string | null;
  parsedDescription: string | null;
  parsedDate: Date | null;
  accountLastFour: string | null;
  categoryHint: string | null;
  rawExtractedJson: Prisma.InputJsonValue;
}

export interface HybridParserOptions {
  pdfExtractor?: IPdfTextExtractor;
  llmClient?: ILlmParserClient;
  llmFallbackThreshold?: number;
}

function clampConfidence(value: number): string {
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return new Prisma.Decimal(safe.toFixed(4)).toFixed(4);
}

function sanitizeAmount(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const dec = new Prisma.Decimal(value);
    if (!dec.isFinite() || dec.lte(0) || dec.gt(MAX_DECIMAL_19_4)) {
      return null;
    }
    return dec.toFixed(4);
  } catch {
    return null;
  }
}

function sanitizeCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

export class HybridParser {
  private readonly pdfExtractor: IPdfTextExtractor;
  private readonly llmClient: ILlmParserClient;
  private readonly llmFallbackThreshold: number;

  constructor(options: HybridParserOptions = {}) {
    this.pdfExtractor = options.pdfExtractor ?? new UnpdfTextExtractor();
    this.llmClient = options.llmClient ?? new OpenAiCompatibleLlmClient();
    this.llmFallbackThreshold =
      options.llmFallbackThreshold ?? DEFAULT_LLM_FALLBACK_THRESHOLD;
  }

  async parse(input: HybridParseInput): Promise<HybridParseOutput> {
    const notes: string[] = [];
    const pdfResults: Array<{
      fileName: string;
      ok: boolean;
      pageCount: number;
      truncated: boolean;
      error?: string;
    }> = [];
    const extractedPdfTexts: string[] = [];

    // 1. Extract text from any attached PDFs (never throws)
    if (Array.isArray(input.pdfAttachments) && input.pdfAttachments.length > 0) {
      for (const att of input.pdfAttachments) {
        const res = await this.pdfExtractor.extract(att.buffer);
        pdfResults.push({
          fileName: att.fileName,
          ok: res.ok,
          pageCount: res.pageCount,
          truncated: res.truncated,
          ...(res.error ? { error: res.error } : {}),
        });

        if (res.ok && res.text.length > 0) {
          extractedPdfTexts.push(res.text);
          if (res.truncated) {
            notes.push(`PDF "${att.fileName}" truncated to page limit.`);
          }
        } else if (!res.ok) {
          notes.push(
            `PDF "${att.fileName}" extraction failed: ${res.error ?? "unreadable PDF"}`,
          );
        } else {
          notes.push(`PDF "${att.fileName}" contained no extractable text.`);
        }
      }
    }

    const combinedPdfText = extractedPdfTexts.join("\n\n").trim();

    // 2. Run deterministic bilingual rule-based parser
    const ruleResult = parseWithRules({
      fromAddress: input.fromAddress,
      subject: input.subject,
      bodyText: input.bodyText,
      pdfText: combinedPdfText || null,
      defaultCurrency: input.defaultCurrency,
    });

    const needsLlmFallback =
      ruleResult.confidence < this.llmFallbackThreshold ||
      !ruleResult.amount ||
      !ruleResult.type;

    let parserSource: ParserSource = ParserSource.RULES;
    let parsedType = ruleResult.type;
    let parsedAmount = sanitizeAmount(ruleResult.amount);
    let parsedCurrency = sanitizeCurrency(ruleResult.currency);
    let parsedMerchant = ruleResult.merchant;
    let parsedDescription = ruleResult.description;
    let parsedDate = ruleResult.date;
    let accountLastFour = ruleResult.accountLastFour;
    let categoryHint = ruleResult.categoryHint;
    let finalConfidence = ruleResult.confidence;
    let llmMeta: Record<string, unknown> | null = null;

    // 3. Conditional LLM fallback when rules have low confidence or missing critical fields
    if (needsLlmFallback) {
      if (input.aiParserEnabled === false) {
        notes.push("AI fallback disabled in user settings; kept rule result.");
      } else if (!this.llmClient.isConfigured()) {
        notes.push(
          "AI fallback skipped (LLM_API_KEY not configured); degraded gracefully to rule result.",
        );
        llmMeta = { skippedReason: "NO_API_KEY" };
      } else {
        const llmRes = await this.llmClient.parseTransaction({
          fromAddress: input.fromAddress,
          subject: input.subject,
          bodyText: input.bodyText,
          pdfText: combinedPdfText || null,
          defaultCurrency: input.defaultCurrency,
        });

        llmMeta = {
          ok: llmRes.ok,
          model: llmRes.model ?? null,
          ...(llmRes.skippedReason
            ? { skippedReason: llmRes.skippedReason }
            : {}),
          ...(llmRes.error ? { error: llmRes.error } : {}),
        };

        if (llmRes.ok && llmRes.data) {
          const llm = llmRes.data;
          const hadRuleFields = Boolean(ruleResult.amount || ruleResult.merchant);
          parserSource = hadRuleFields ? ParserSource.HYBRID : ParserSource.LLM;

          parsedType = llm.type ?? parsedType;
          parsedAmount = sanitizeAmount(llm.amount) ?? parsedAmount;
          parsedCurrency = sanitizeCurrency(llm.currency) ?? parsedCurrency;
          parsedMerchant = llm.merchant ?? parsedMerchant;
          parsedDescription =
            llm.description ?? llm.merchant ?? parsedDescription;
          if (llm.date) {
            const parsedLlmDate = new Date(llm.date);
            if (!Number.isNaN(parsedLlmDate.getTime())) {
              parsedDate = parsedLlmDate;
            }
          }
          accountLastFour = llm.accountLastFour ?? accountLastFour;
          categoryHint = llm.categoryHint ?? categoryHint;

          if (typeof llm.confidence === "number") {
            finalConfidence = Math.max(finalConfidence, llm.confidence);
          } else if (parsedAmount && parsedType) {
            finalConfidence = Math.max(finalConfidence, 0.8);
          }

          if (llm.notes) {
            notes.push(`LLM: ${llm.notes}`);
          }
        } else {
          notes.push(
            `AI fallback failed (${llmRes.error ?? llmRes.skippedReason ?? "unknown"}); degraded gracefully.`,
          );
        }
      }
    }

    // If neither rules nor LLM extracted an amount and PDF failed, mark FAILED
    if (
      !parsedAmount &&
      pdfResults.length > 0 &&
      pdfResults.every((r) => !r.ok)
    ) {
      parserSource = ParserSource.FAILED;
    }

    const rawExtractedJson: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify({
        rules: {
          ...ruleResult,
          date: ruleResult.date ? ruleResult.date.toISOString() : null,
          statementRows: ruleResult.statementRows.map((row) => ({
            ...row,
            date: row.date ? row.date.toISOString() : null,
          })),
        },
        pdfs: pdfResults,
        llm: llmMeta,
      }),
    ) as Prisma.InputJsonValue;

    return {
      parserSource,
      parserNotes: notes.length > 0 ? notes.join(" | ") : null,
      confidence: clampConfidence(finalConfidence),
      parsedType,
      parsedAmount,
      parsedCurrency,
      parsedMerchant,
      parsedDescription: parsedDescription
        ? parsedDescription.slice(0, 255)
        : null,
      parsedDate,
      accountLastFour,
      categoryHint,
      rawExtractedJson,
    };
  }
}
