import { Prisma, TransactionType } from "@prisma/client";
import { z } from "zod";
import { DECIMAL_REGEX } from "@/lib/db/decimal";

const MAX_DECIMAL_19_4 = new Prisma.Decimal("999999999999999.9999");

export const llmParsedTransactionSchema = z.object({
  type: z.nativeEnum(TransactionType).nullable().optional(),
  amount: z
    .string()
    .trim()
    .regex(DECIMAL_REGEX, "amount must be a positive decimal string")
    .refine(
      (val) => {
        try {
          const dec = new Prisma.Decimal(val);
          return dec.isFinite() && dec.gt(0) && dec.lte(MAX_DECIMAL_19_4);
        } catch {
          return false;
        }
      },
      { message: "amount must be > 0 and within Decimal(19,4) bounds" },
    )
    .nullable()
    .optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
    .nullable()
    .optional(),
  merchant: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().min(1).max(255).nullable().optional(),
  date: z
    .string()
    .trim()
    .refine((val) => !Number.isNaN(Date.parse(val)), {
      message: "date must be a valid ISO date string",
    })
    .nullable()
    .optional(),
  categoryHint: z.string().trim().min(1).max(80).nullable().optional(),
  accountLastFour: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "accountLastFour must be 4 digits")
    .nullable()
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type LlmParsedTransaction = z.infer<typeof llmParsedTransactionSchema>;

export interface LlmParseInput {
  fromAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  pdfText?: string | null;
  defaultCurrency?: string;
}

export interface LlmParseResult {
  ok: boolean;
  data?: LlmParsedTransaction;
  skippedReason?: "NO_API_KEY";
  error?: string;
  model?: string;
}

export interface ILlmParserClient {
  isConfigured(): boolean;
  parseTransaction(input: LlmParseInput): Promise<LlmParseResult>;
}

export interface OpenAiCompatibleLlmClientOptions {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 15_000;

function stripMarkdownJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1] !== undefined) {
    return fenced[1].trim();
  }
  return trimmed;
}

const SYSTEM_PROMPT = `You are a strict financial email & bank statement parser (English and Spanish).
Extract a single financial transaction from the provided email/PDF text and return ONLY a valid JSON object matching this schema:
{
  "type": "EXPENSE" | "INCOME" | "TRANSFER" | null,
  "amount": "123.4500" | null,
  "currency": "USD" | "EUR" | "COP" | "MXN" | ... (3-letter ISO code) | null,
  "merchant": string | null,
  "description": string | null,
  "date": "YYYY-MM-DD" | ISO-8601 string | null,
  "categoryHint": string | null,
  "accountLastFour": "1234" | null,
  "confidence": number between 0 and 1,
  "notes": string | null
}
Rules:
- Format "amount" as a positive decimal string with up to 4 decimals and a dot separator (e.g. "45.5000"), NEVER a number or negative value.
- If the message is NOT a financial transaction, return null for type/amount/currency/merchant and confidence <= 0.2.
- Output raw JSON only, with no prose.`;

export class OpenAiCompatibleLlmClient implements ILlmParserClient {
  private readonly provider: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiCompatibleLlmClientOptions = {}) {
    this.provider = (
      options.provider ??
      process.env.LLM_PROVIDER ??
      "none"
    )
      .trim()
      .toLowerCase();
    this.apiKey = (options.apiKey ?? process.env.LLM_API_KEY ?? "").trim();
    this.baseUrl = (
      options.baseUrl ??
      process.env.LLM_BASE_URL ??
      DEFAULT_BASE_URL
    )
      .trim()
      .replace(/\/+$/, "");
    this.model = (
      options.model ??
      process.env.LLM_MODEL ??
      DEFAULT_MODEL
    ).trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.provider !== "none";
  }

  async parseTransaction(input: LlmParseInput): Promise<LlmParseResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        skippedReason: "NO_API_KEY",
      };
    }

    const userContentParts: string[] = [];
    if (input.fromAddress) userContentParts.push(`From: ${input.fromAddress}`);
    if (input.subject) userContentParts.push(`Subject: ${input.subject}`);
    if (input.defaultCurrency) {
      userContentParts.push(`User default currency: ${input.defaultCurrency}`);
    }
    if (input.bodyText) {
      userContentParts.push(`Email Body:\n${input.bodyText.slice(0, 6000)}`);
    }
    if (input.pdfText) {
      userContentParts.push(
        `PDF Attachment Text:\n${input.pdfText.slice(0, 8000)}`,
      );
    }

    const endpoint = `${this.baseUrl}/chat/completions`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContentParts.join("\n\n") },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const bodyPreview = await response.text().catch(() => "");
        return {
          ok: false,
          error: `LLM HTTP ${response.status}: ${bodyPreview.slice(0, 200)}`,
          model: this.model,
        };
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
          };
        }>;
      };

      const rawContent = payload.choices?.[0]?.message?.content;
      if (typeof rawContent !== "string" || rawContent.trim().length === 0) {
        return {
          ok: false,
          error: "LLM response did not contain message content",
          model: this.model,
        };
      }

      const cleaned = stripMarkdownJsonFences(rawContent);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(cleaned);
      } catch (jsonErr) {
        return {
          ok: false,
          error: `LLM returned invalid JSON: ${jsonErr instanceof Error ? jsonErr.message : "parse error"}`,
          model: this.model,
        };
      }

      const validated = llmParsedTransactionSchema.safeParse(parsedJson);
      if (!validated.success) {
        return {
          ok: false,
          error: `LLM JSON failed schema validation: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          model: this.model,
        };
      }

      const normalized: LlmParsedTransaction = {
        ...validated.data,
        amount:
          validated.data.amount != null
            ? new Prisma.Decimal(validated.data.amount).toFixed(4)
            : validated.data.amount,
      };

      return {
        ok: true,
        data: normalized,
        model: this.model,
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Unexpected LLM client error",
        model: this.model,
      };
    }
  }
}
