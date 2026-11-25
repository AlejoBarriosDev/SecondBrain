"use client";

import Link from "next/link";
import { ArrowRight, Inbox, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function InboxWidget({
  pendingCount,
  syncing,
  onSync,
}: {
  pendingCount: number;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <Card className="col-span-12 flex flex-col justify-between lg:col-span-4">
      <CardHeader>
        <div>
          <CardTitle>Bandeja Inbox</CardTitle>
          <CardDescription>
            Correos y extractos PDF listos para revisar
          </CardDescription>
        </div>
        <Badge variant={pendingCount > 0 ? "warning" : "success"}>
          <Inbox className="h-3 w-3" aria-hidden="true" />
          <span className="tabular-nums">{pendingCount} pendientes</span>
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="sb-elevated rounded-xl border p-4">
          <p className="sb-text-primary text-3xl font-bold tabular-nums">
            {pendingCount}
          </p>
          <p className="sb-text-secondary mt-1 text-xs">
            {pendingCount === 0
              ? "Todo al día. Ningún cargo pendiente de confirmar."
              : "Requieren confirmación antes de afectar tus saldos."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/inbox"
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <span>Revisar Inbox</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Button
            variant="secondary"
            size="sm"
            loading={syncing}
            onClick={onSync}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sync Gmail</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
