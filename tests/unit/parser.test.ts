import { describe, expect, it, vi } from "vitest";
import { ParserSource, TransactionType } from "@prisma/client";
import {
  OpenAiCompatibleLlmClient,
  type ILlmParserClient,
} from "@/lib/integrations/llm-client";
import {
  DEFAULT_MAX_PDF_BYTES,
  UnpdfTextExtractor,
} from "@/lib/integrations/pdf-extractor";
import { HybridParser } from "@/modules/finances/hybrid-parser";
import {
  normalizeAmountString,
  parsePdfStatementRows,
  parseWithRules,
} from "@/modules/finances/rule-parser";

function buildMinimalPdfBuffer(text: string): Buffer {
  const escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
  const streamContent = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const streamLength = Buffer.byteLength(streamContent, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}endstream\nendobj\n`,
  ];

  const header = "%PDF-1.4\n";
  const parts: string[] = [header];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "utf8");

  for (const obj of objects) {
    offsets.push(cursor);
    parts.push(obj);
    cursor += Buffer.byteLength(obj, "utf8");
  }

  const xrefOffset = cursor;
  parts.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n \n`).join(""),
  );
  parts.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.from(parts.join(""), "utf8");
}

describe("Rule-Based Parser (PARSE-02)", () => {
  it("normalizes US, ES/LATAM, and COP/CLP/ARS amounts to exact Decimal(19,4) without float drift", () => {
    expect(normalizeAmountString("1,234.56")).toBe("1234.5600");
    expect(normalizeAmountString("1.234,56")).toBe("1234.5600");
    expect(normalizeAmountString("12,50", "EUR")).toBe("12.5000");
    expect(normalizeAmountString("50.000", "COP")).toBe("50000.0000");
    expect(normalizeAmountString("1.250.000", "CLP")).toBe("1250000.0000");
    expect(normalizeAmountString("$45.50 USD")).toBe("45.5000");
    expect(normalizeAmountString("0.0001")).toBe("0.0001");
    expect(normalizeAmountString("999999999999999.9999")).toBe(
      "999999999999999.9999",
    );

    // Reject zero, overflow, and non-numeric strings
    expect(normalizeAmountString("0")).toBeNull();
    expect(normalizeAmountString("0.0000")).toBeNull();
    expect(normalizeAmountString("1000000000000000.0000")).toBeNull();
    expect(normalizeAmountString("abc")).toBeNull();
  });

  it("parses English debit card purchase alert accurately", () => {
    const res = parseWithRules({
      subject: "Purchase alert: USD 45.50 at Whole Foods",
      bodyText:
        "You made a debit card purchase of $45.50 USD at Whole Foods Market on 2026-11-20 using card ending in 4321.",
    });

    expect(res.type).toBe(TransactionType.EXPENSE);
    expect(res.amount).toBe("45.5000");
    expect(res.currency).toBe("USD");
    expect(res.merchant).toBe("Whole Foods Market");
    expect(res.accountLastFour).toBe("4321");
    expect(res.categoryHint).toBe("Groceries");
    expect(res.date?.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("parses Spanish purchase alerts accurately", () => {
    const aws = parseWithRules({
      subject: "Notificación de compra",
      bodyText: "Compra aprobada por USD 80.00 en Amazon Web Services",
    });
    expect(aws.type).toBe(TransactionType.EXPENSE);
    expect(aws.amount).toBe("80.0000");
    expect(aws.currency).toBe("USD");
    expect(aws.merchant).toBe("Amazon Web Services");
    expect(aws.confidence).toBeGreaterThanOrEqual(0.85);

    const cafe = parseWithRules({
      subject: "Alerta bancaria",
      bodyText: "Compra aprobada por USD 64.25 en Cafe Central el 15/11/2026.",
    });
    expect(cafe.type).toBe(TransactionType.EXPENSE);
    expect(cafe.amount).toBe("64.2500");
    expect(cafe.currency).toBe("USD");
    expect(cafe.merchant).toBe("Cafe Central");
    expect(cafe.date?.toISOString().slice(0, 10)).toBe("2026-11-15");
  });

  it("parses card charge, income deposit, and transfer emails", () => {
    const charge = parseWithRules({
      bodyText: "Card charge USD 110.00 at Metro Airlines",
    });
    expect(charge.type).toBe(TransactionType.EXPENSE);
    expect(charge.amount).toBe("110.0000");
    expect(charge.currency).toBe("USD");
    expect(charge.merchant).toBe("Metro Airlines");

    const payroll = parseWithRules({
      subject: "Direct deposit received",
      bodyText: "Payroll deposit of $3,250.00 USD credited to your account.",
    });
    expect(payroll.type).toBe(TransactionType.INCOME);
    expect(payroll.amount).toBe("3250.0000");
    expect(payroll.currency).toBe("USD");

    const transfer = parseWithRules({
      subject: "Transferencia enviada",
      bodyText: "Transferencia entre cuentas por EUR 1.234,56.",
    });
    expect(transfer.type).toBe(TransactionType.TRANSFER);
    expect(transfer.amount).toBe("1234.5600");
    expect(transfer.currency).toBe("EUR");
  });

  it("assigns low confidence and null amount for non-financial emails", () => {
    const res = parseWithRules({
      subject: "Hey quick note",
      bodyText: "Let's catch up sometime next week for lunch.",
    });

    expect(res.amount).toBeNull();
    expect(res.confidence).toBeLessThanOrEqual(0.25);
  });

  it("extracts tabular PDF statement rows", () => {
    const pdfText = [
      "Monthly Statement",
      "2026-11-18  Whole Foods Market  USD 45.50",
      "19/11/2026  Payroll Deposit  +2500.00",
    ].join("\n");

    const rows = parsePdfStatementRows(pdfText, "USD");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      description: "Whole Foods Market",
      amount: "45.5000",
      currency: "USD",
      type: TransactionType.EXPENSE,
    });
    expect(rows[1]).toMatchObject({
      description: "Payroll Deposit",
      amount: "2500.0000",
      currency: "USD",
      type: TransactionType.INCOME,
    });
  });
});

describe("UnpdfTextExtractor (PARSE-01)", () => {
  const extractor = new UnpdfTextExtractor();

  it("extracts text cleanly from a genuine minimal PDF-1.4 buffer", async () => {
    const pdf = buildMinimalPdfBuffer(
      "Compra aprobada por USD 80.00 en Amazon Web Services",
    );
    const result = await extractor.extract(pdf);

    expect(result.ok).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain(
      "Compra aprobada por USD 80.00 en Amazon Web Services",
    );
  });

  it("degrades gracefully without throwing on empty, corrupt, or oversized PDFs", async () => {
    const emptyRes = await extractor.extract(Buffer.alloc(0));
    expect(emptyRes.ok).toBe(false);
    expect(emptyRes.error).toMatch(/empty/i);

    const notPdfRes = await extractor.extract(
      Buffer.from("NOT_A_REAL_PDF_BINARY_DATA"),
    );
    expect(notPdfRes.ok).toBe(false);
    expect(notPdfRes.error).toMatch(/%PDF-/);

    const corruptPdfRes = await extractor.extract(
      Buffer.from("%PDF-1.4\ncorrupted-binary-payload-without-xref"),
    );
    expect(corruptPdfRes.ok).toBe(false);

    const oversizedRes = await extractor.extract(
      Buffer.alloc(1024, 0x25),
      { maxBytes: 512 },
    );
    expect(oversizedRes.ok).toBe(false);
    expect(oversizedRes.error).toMatch(/exceeds maximum allowed size/i);
    expect(DEFAULT_MAX_PDF_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("OpenAiCompatibleLlmClient (PARSE-03)", () => {
  it("skips network calls and returns NO_API_KEY when unconfigured", async () => {
    const fetchSpy = vi.fn();
    const client = new OpenAiCompatibleLlmClient({
      provider: "openai",
      apiKey: "",
      fetchFn: fetchSpy as unknown as typeof fetch,
    });

    expect(client.isConfigured()).toBe(false);
    const result = await client.parseTransaction({
      subject: "Test",
      bodyText: "Test body",
    });

    expect(result).toEqual({ ok: false, skippedReason: "NO_API_KEY" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates structured JSON response with Zod and normalizes Decimal(19,4)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"type":"EXPENSE","amount":"19.99","currency":"usd","merchant":"Spotify","description":"Spotify Premium","date":"2026-11-20","confidence":0.91}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new OpenAiCompatibleLlmClient({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://mock.llm.local/v1",
      model: "gpt-4o-mini",
      fetchFn: fetchSpy as unknown as typeof fetch,
    });

    expect(client.isConfigured()).toBe(true);
    const result = await client.parseTransaction({
      subject: "Receipt",
      bodyText: "Your Spotify renewal",
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      type: TransactionType.EXPENSE,
      amount: "19.9900",
      currency: "USD",
      merchant: "Spotify",
      confidence: 0.91,
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("degrades cleanly on invalid JSON, Zod validation failure, or HTTP error", async () => {
    const badJsonClient = new OpenAiCompatibleLlmClient({
      provider: "openai",
      apiKey: "test-key",
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
            { status: 200 },
          ),
        ) as unknown as typeof fetch,
    });
    const badJsonRes = await badJsonClient.parseTransaction({
      bodyText: "abc",
    });
    expect(badJsonRes.ok).toBe(false);
    expect(badJsonRes.error).toMatch(/invalid JSON/i);

    const badZodClient = new OpenAiCompatibleLlmClient({
      provider: "openai",
      apiKey: "test-key",
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      type: "EXPENSE",
                      amount: "-50.00",
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ) as unknown as typeof fetch,
    });
    const badZodRes = await badZodClient.parseTransaction({ bodyText: "abc" });
    expect(badZodRes.ok).toBe(false);
    expect(badZodRes.error).toMatch(/schema validation/i);

    const httpErrClient = new OpenAiCompatibleLlmClient({
      provider: "openai",
      apiKey: "test-key",
      fetchFn: vi
        .fn()
        .mockResolvedValue(
          new Response("Rate limit exceeded", { status: 429 }),
        ) as unknown as typeof fetch,
    });
    const httpErrRes = await httpErrClient.parseTransaction({
      bodyText: "abc",
    });
    expect(httpErrRes.ok).toBe(false);
    expect(httpErrRes.error).toMatch(/HTTP 429/);
  });
});

describe("HybridParser Orchestration (PARSE-01..03)", () => {
  it("skips LLM when deterministic rules achieve high confidence", async () => {
    const llmMock: ILlmParserClient = {
      isConfigured: () => true,
      parseTransaction: vi.fn(),
    };
    const parser = new HybridParser({ llmClient: llmMock });

    const out = await parser.parse({
      subject: "Purchase alert: USD 45.50 at Whole Foods",
      bodyText:
        "You made a debit card purchase of $45.50 USD at Whole Foods Market on 2026-11-20.",
    });

    expect(out.parserSource).toBe(ParserSource.RULES);
    expect(out.parsedAmount).toBe("45.5000");
    expect(out.parsedCurrency).toBe("USD");
    expect(out.parsedMerchant).toBe("Whole Foods Market");
    expect(llmMock.parseTransaction).not.toHaveBeenCalled();
  });

  it("invokes LLM fallback when rules have low confidence and merges result", async () => {
    const llmMock: ILlmParserClient = {
      isConfigured: () => true,
      parseTransaction: vi.fn().mockResolvedValue({
        ok: true,
        model: "gpt-4o-mini",
        data: {
          type: TransactionType.EXPENSE,
          amount: "29.0000",
          currency: "USD",
          merchant: "Notion Labs",
          description: "Notion Plus monthly plan",
          confidence: 0.88,
        },
      }),
    };
    const parser = new HybridParser({ llmClient: llmMock });

    const out = await parser.parse({
      subject: "Your workspace receipt",
      bodyText: "Thanks for continuing with Notion Plus.",
    });

    expect(llmMock.parseTransaction).toHaveBeenCalledOnce();
    expect(out.parserSource).toBe(ParserSource.LLM);
    expect(out.parsedAmount).toBe("29.0000");
    expect(out.parsedMerchant).toBe("Notion Labs");
    expect(out.confidence).toBe("0.8800");
  });

  it("extracts PDF text and degrades gracefully on corrupt PDF without LLM key", async () => {
    const unconfiguredLlm = new OpenAiCompatibleLlmClient({
      provider: "none",
      apiKey: "",
    });
    const parser = new HybridParser({ llmClient: unconfiguredLlm });

    const validPdf = buildMinimalPdfBuffer(
      "Card charge USD 110.00 at Metro Airlines",
    );
    const pdfOut = await parser.parse({
      subject: "Monthly Statement",
      bodyText: "Attached statement",
      pdfAttachments: [{ fileName: "statement.pdf", buffer: validPdf }],
    });
    expect(pdfOut.parserSource).toBe(ParserSource.RULES);
    expect(pdfOut.parsedAmount).toBe("110.0000");
    expect(pdfOut.parsedMerchant).toBe("Metro Airlines");

    const corruptOut = await parser.parse({
      subject: "Corrupted statement",
      bodyText: "See attached PDF.",
      pdfAttachments: [
        {
          fileName: "corrupt.pdf",
          buffer: Buffer.from("NOT_A_PDF"),
        },
      ],
    });
    expect(corruptOut.parserSource).toBe(ParserSource.FAILED);
    expect(corruptOut.parsedAmount).toBeNull();
    expect(corruptOut.parserNotes).toMatch(/extraction failed/i);
  });
});
