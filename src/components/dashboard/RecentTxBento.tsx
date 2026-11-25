import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatMoney } from "@/lib/ui/format";
import type { SerializedTransaction } from "@/modules/finances/serializers";

export function RecentTxBento({
  transactions,
}: {
  transactions: SerializedTransaction[];
}) {
  return (
    <Card className="col-span-12 lg:col-span-7">
      <CardHeader>
        <div>
          <CardTitle>Movimientos Recientes</CardTitle>
          <CardDescription>Últimas operaciones registradas</CardDescription>
        </div>
        <Link
          href="/transactions"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-400"
        >
          <span>Historial</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>

      <CardContent>
        {transactions.length === 0 ? (
          <p className="sb-text-secondary py-6 text-center text-xs">
            Sin movimientos recientes. Registra tu primer ingreso o gasto.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {transactions.slice(0, 6).map((tx) => {
              const isIncome =
                tx.type === "INCOME" ||
                (tx.type === "TRANSFER" && tx.transferDirection === "IN");
              const sign = isIncome ? "+" : "-";
              const amountClass =
                tx.status === "VOID"
                  ? "sb-text-muted line-through"
                  : isIncome
                    ? "text-emerald-500"
                    : "sb-text-primary";

              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="sb-text-primary truncate text-sm font-medium">
                      {tx.description}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="sb-text-muted">
                        {formatDate(tx.occurredAt)}
                      </span>
                      {tx.account ? (
                        <span className="sb-text-secondary">
                          · {tx.account.name}
                        </span>
                      ) : null}
                      {tx.category ? (
                        <Badge variant="default">{tx.category.name}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <p
                    className={`shrink-0 text-sm font-semibold tabular-nums ${amountClass}`}
                  >
                    {sign}
                    {formatMoney(tx.amount, tx.currency)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
