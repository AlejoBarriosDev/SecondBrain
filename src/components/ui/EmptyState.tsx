import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-10 text-center">
      <div className="sb-elevated mb-3 flex h-11 w-11 items-center justify-center rounded-xl border text-indigo-500">
        {icon}
      </div>
      <h3 className="sb-text-primary text-sm font-semibold">{title}</h3>
      <p className="sb-text-secondary mt-1 max-w-sm text-xs leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
