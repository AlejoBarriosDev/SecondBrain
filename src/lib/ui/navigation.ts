export type NavIconKey =
  | "dashboard"
  | "accounts"
  | "transactions"
  | "transfers"
  | "budgets"
  | "categories"
  | "recurring"
  | "inbox"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: NavIconKey;
  section: "primary" | "manage" | "system";
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Command Center",
    shortLabel: "Inicio",
    icon: "dashboard",
    section: "primary",
  },
  {
    href: "/accounts",
    label: "Cuentas",
    shortLabel: "Cuentas",
    icon: "accounts",
    section: "primary",
  },
  {
    href: "/transactions",
    label: "Movimientos",
    shortLabel: "Movs",
    icon: "transactions",
    section: "primary",
  },
  {
    href: "/inbox",
    label: "Bandeja Inbox",
    shortLabel: "Inbox",
    icon: "inbox",
    section: "primary",
  },
  {
    href: "/transfers",
    label: "Transferencias",
    shortLabel: "Transf.",
    icon: "transfers",
    section: "manage",
  },
  {
    href: "/budgets",
    label: "Presupuestos",
    shortLabel: "Presup.",
    icon: "budgets",
    section: "manage",
  },
  {
    href: "/categories",
    label: "Categorías",
    shortLabel: "Categ.",
    icon: "categories",
    section: "manage",
  },
  {
    href: "/recurring",
    label: "Recurrentes",
    shortLabel: "Recurr.",
    icon: "recurring",
    section: "manage",
  },
  {
    href: "/settings",
    label: "Ajustes",
    shortLabel: "Ajustes",
    icon: "settings",
    section: "system",
  },
] as const;

export const MOBILE_PRIMARY_HREFS: readonly string[] = [
  "/",
  "/accounts",
  "/transactions",
  "/inbox",
] as const;

export const MOBILE_MORE_HREFS: readonly string[] = [
  "/transfers",
  "/budgets",
  "/categories",
  "/recurring",
  "/settings",
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
