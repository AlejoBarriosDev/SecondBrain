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
import { formatMoney, formatPercent } from "@/lib/ui/format";
import type { SerializedBudgetWithProgress } from "@/modules/finances/serializers";

export function BudgetsBento({
  budgets,
}: {
  budgets: SerializedBudgetWithProgress[];
}) {
  return (
    <Card className="col-span-12 lg:col-span-6">
      <CardHeader>
        <div>
          <CardTitle>Presupuestos del Mes</CardTitle>
          <CardDescription>
            Seguimiento de gasto frente a límite mensual
          </CardDescription>
        </div>
        <Link
          href="/budgets"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-400"
        >
          <span>Ver todos</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>

      <CardContent>
        {budgets.length === 0 ? (
          <p className="sb-text-secondary py-6 text-center text-xs">
            No hay presupuestos definidos para este mes. Configúralos en{" "}
            <Link href="/budgets" className="text-indigo-500 underline">
              Presupuestos
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3.5">
            {budgets.slice(0, 5).map((b) => {
              const barWidth = Math.min(100, Math.max(0, b.percentUsed));
              const barColor =
                b.alertStatus === "EXCEEDED"
                  ? "bg-rose-500"
                  : b.alertStatus === "WARNING"
                    ? "bg-amber-500"
                    : "bg-emerald-500";
              const badgeVariant =
                b.alertStatus === "EXCEEDED"
                  ? "danger"
                  : b.alertStatus === "WARNING"
                    ? "warning"
                    : "success";

              return (
                <li key={b.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="sb-text-primary truncate font-medium">
                      {b.category.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="sb-text-secondary tabular-nums">
                        {formatMoney(b.spent, b.currency)} /{" "}
                        {formatMoney(b.amount, b.currency)}
                      </span>
                      <Badge variant={badgeVariant}>
                        {formatPercent(b.percentUsed)}
                      </Badge>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-500/20">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
