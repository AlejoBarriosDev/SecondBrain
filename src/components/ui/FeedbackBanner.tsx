"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export interface FeedbackMessage {
  type: "success" | "error" | "info";
  text: string;
}

export function FeedbackBanner({
  message,
  onDismiss,
}: {
  message: FeedbackMessage | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;

  const styles =
    message.type === "success"
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : message.type === "error"
        ? "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300"
        : "border-indigo-500/35 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300";

  const Icon =
    message.type === "success"
      ? CheckCircle2
      : message.type === "error"
        ? AlertCircle
        : Info;

  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message.text}</span>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Descartar aviso"
          className="rounded-md p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
