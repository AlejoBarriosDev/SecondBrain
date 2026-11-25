import {
  ArrowLeftRight,
  Brain,
  FolderTree,
  Inbox,
  LayoutDashboard,
  PieChart,
  Receipt,
  Repeat,
  Settings,
  Wallet,
} from "lucide-react";
import type { NavIconKey } from "@/lib/ui/navigation";

export function NavIcon({
  icon,
  className = "h-4 w-4",
}: {
  icon: NavIconKey;
  className?: string;
}) {
  switch (icon) {
    case "dashboard":
      return <LayoutDashboard className={className} aria-hidden="true" />;
    case "accounts":
      return <Wallet className={className} aria-hidden="true" />;
    case "transactions":
      return <Receipt className={className} aria-hidden="true" />;
    case "transfers":
      return <ArrowLeftRight className={className} aria-hidden="true" />;
    case "budgets":
      return <PieChart className={className} aria-hidden="true" />;
    case "categories":
      return <FolderTree className={className} aria-hidden="true" />;
    case "recurring":
      return <Repeat className={className} aria-hidden="true" />;
    case "inbox":
      return <Inbox className={className} aria-hidden="true" />;
    case "settings":
      return <Settings className={className} aria-hidden="true" />;
    default:
      return <Brain className={className} aria-hidden="true" />;
  }
}
