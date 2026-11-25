import Link from "next/link";
import { ArrowRight, CreditCard, Landmark, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatMoney } from "@/lib/ui/format";
import type { SerializedFinancialAccount } from "@/modules/finances/serializers";

const TYPE_LABEL: Record<SerializedFinancialAccount["type"], string> = {
  BANK: "Banco",
  CASH: "Efectivo",
  CREDIT_CARD: "Crédito",
};

export function AccountsBento({
  accounts,
}: {
  accounts: SerializedFinancialAccount[];
}) {
  return (
    <Card className="col-span-12 lg:col-span-6">
      <CardHeader>
        <div>
          <CardTitle>Cuentas Activas</CardTitle>
          <CardDescription>
            Saldos en tiempo real (activos y tarjetas)
          </CardDescription>
        </div>
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-400"
        >
          <span>Gestionar</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>

      <CardContent>
        {accounts.length === 0 ? (
          <p className="sb-text-secondary py-6 text-center text-xs">
            Aún no tienes cuentas registradas. Crea tu primera cuenta en{" "}
            <Link href="/accounts" className="text-indigo-500 underline">
              Cuentas
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2.5">
            {accounts.slice(0, 6).map((account) => {
              const Icon =
                account.type === "CREDIT_CARD"
                  ? CreditCard
                  : account.type === "BANK"
                    ? Landmark
                    : Wallet;

              return (
                <li
                  key={account.id}
                  className="sb-elevated flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-500">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="sb-text-primary truncate text-sm font-medium">
                        {account.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge variant="default">
                          {TYPE_LABEL[account.type]}
                        </Badge>
                        {account.lastFour ? (
                          <span className="sb-text-muted text-[11px] tabular-nums">
                            •••• {account.lastFour}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="sb-text-primary text-sm font-semibold tabular-nums">
                      {formatMoney(account.balance, account.currency)}
                    </p>
                    {account.availableCredit !== null ? (
                      <p className="sb-text-muted text-[11px] tabular-nums">
                        Disp:{" "}
                        {formatMoney(account.availableCredit, account.currency)}
                      </p>
                    ) : null}
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
