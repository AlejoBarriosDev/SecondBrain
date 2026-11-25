import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/ui/format";
import type {
  CurrencyCashflow,
  CurrencyNetWorth,
} from "@/modules/finances/dashboard";

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function NetWorthHero({
  netWorthByCurrency,
  monthlyCashflow,
  defaultCurrency,
}: {
  netWorthByCurrency: CurrencyNetWorth[];
  monthlyCashflow: {
    year: number;
    month: number;
    byCurrency: CurrencyCashflow[];
  };
  defaultCurrency: string;
}) {
  const primaryNetWorth =
    netWorthByCurrency.find((n) => n.currency === defaultCurrency) ??
    netWorthByCurrency[0] ?? {
      currency: defaultCurrency,
      totalBalance: "0.0000",
      assets: "0.0000",
      liabilities: "0.0000",
    };

  const primaryCashflow =
    monthlyCashflow.byCurrency.find(
      (c) => c.currency === primaryNetWorth.currency,
    ) ??
    monthlyCashflow.byCurrency[0] ?? {
      currency: primaryNetWorth.currency,
      income: "0.0000",
      expense: "0.0000",
      net: "0.0000",
    };

  const monthLabel = `${MONTH_NAMES[(monthlyCashflow.month - 1) % 12] ?? ""} ${monthlyCashflow.year}`;

  return (
    <Card className="col-span-12 lg:col-span-8">
      <CardHeader>
        <div>
          <p className="sb-text-muted text-xs font-medium tracking-wider uppercase">
            Patrimonio Neto ({primaryNetWorth.currency})
          </p>
          <p
            data-testid="net-worth-total"
            className="sb-text-primary mt-1.5 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl"
          >
            {formatMoney(primaryNetWorth.totalBalance, primaryNetWorth.currency)}
          </p>
        </div>
        <Badge variant="accent">
          <Wallet className="h-3 w-3" aria-hidden="true" />
          <span>{monthLabel}</span>
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sb-elevated rounded-xl border p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="sb-text-secondary">Ingresos del mes</span>
              <TrendingUp
                className="h-3.5 w-3.5 text-emerald-500"
                aria-hidden="true"
              />
            </div>
            <p className="mt-1.5 text-lg font-semibold text-emerald-500 tabular-nums">
              {formatMoney(primaryCashflow.income, primaryCashflow.currency)}
            </p>
          </div>

          <div className="sb-elevated rounded-xl border p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="sb-text-secondary">Gastos del mes</span>
              <TrendingDown
                className="h-3.5 w-3.5 text-rose-500"
                aria-hidden="true"
              />
            </div>
            <p className="mt-1.5 text-lg font-semibold text-rose-500 tabular-nums">
              {formatMoney(primaryCashflow.expense, primaryCashflow.currency)}
            </p>
          </div>

          <div className="sb-elevated rounded-xl border p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="sb-text-secondary">Flujo neto</span>
            </div>
            <p className="sb-text-primary mt-1.5 text-lg font-semibold tabular-nums">
              {formatMoney(primaryCashflow.net, primaryCashflow.currency)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <span className="sb-text-secondary">
              Activos:{" "}
              <strong className="sb-text-primary font-semibold tabular-nums">
                {formatMoney(primaryNetWorth.assets, primaryNetWorth.currency)}
              </strong>
            </span>
            <span className="sb-text-secondary">
              Pasivos:{" "}
              <strong className="text-rose-500 font-semibold tabular-nums">
                {formatMoney(
                  primaryNetWorth.liabilities,
                  primaryNetWorth.currency,
                )}
              </strong>
            </span>
          </div>

          {netWorthByCurrency.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {netWorthByCurrency
                .filter((n) => n.currency !== primaryNetWorth.currency)
                .map((n) => (
                  <Badge key={n.currency} variant="default">
                    {n.currency}:{" "}
                    <span className="tabular-nums">
                      {formatMoney(n.totalBalance, n.currency)}
                    </span>
                  </Badge>
                ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
