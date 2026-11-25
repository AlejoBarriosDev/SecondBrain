"use client";

import Link from "next/link";
import { ArrowRight, Play, Repeat } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney } from "@/lib/ui/format";
import type { SerializedRecurringRule } from "@/modules/finances/serializers";

export function RecurringBento({
  rules,
  running,
  onRunDue,
}: {
  rules: SerializedRecurringRule[];
  running: boolean;
  onRunDue: () => void;
}) {
  return (
    <Card className="col-span-12 lg:col-span-5">
      <CardHeader>
        <div>
          <CardTitle>Próximos Recurrentes</CardTitle>
          <CardDescription>Suscripciones y cargos programados</CardDescription>
        </div>
        <Link
          href="/recurring"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-400"
        >
          <span>Gestionar</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>

      <CardContent className="space-y-4">
        {rules.length === 0 ? (
          <p className="sb-text-secondary py-4 text-center text-xs">
            No hay reglas recurrentes activas.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rules.slice(0, 5).map((rule) => (
              <li
                key={rule.id}
                className="sb-elevated flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="sb-text-primary truncate text-sm font-medium">
                    {rule.name}
                  </p>
                  <p className="sb-text-muted mt-0.5 text-xs">
                    Próximo: {formatDate(rule.nextRunAt)} · {rule.frequency}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="sb-text-primary text-sm font-semibold tabular-nums">
                    {formatMoney(rule.amount, rule.currency)}
                  </p>
                  <Badge variant={rule.type === "INCOME" ? "success" : "default"}>
                    <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                    {rule.type}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          variant="secondary"
          size="sm"
          loading={running}
          onClick={onRunDue}
          className="w-full"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Ejecutar reglas vencidas</span>
        </Button>
      </CardContent>
    </Card>
  );
}
