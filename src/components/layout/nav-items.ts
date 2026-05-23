import {
  Home,
  Users,
  MessageSquare,
  Network,
  Search,
  Upload,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const mainNavItems: NavItem[] = [
  { href: "/", label: "Дашборд", icon: Home },
  { href: "/contacts", label: "Контакты", icon: Users },
  { href: "/chats", label: "Чаты", icon: MessageSquare },
  { href: "/graph", label: "Граф", icon: Network },
  { href: "/search", label: "Поиск", icon: Search },
  { href: "/import", label: "Импорт", icon: Upload },
];

export const footerNavItems: NavItem[] = [
  { href: "/settings", label: "Настройки", icon: Settings },
];

export const allNavItems: NavItem[] = [...mainNavItems, ...footerNavItems];

export function pageTitleForPath(pathname: string): string {
  const exact = allNavItems.find((item) => item.href === pathname);
  if (exact) return exact.label;
  // Match nested routes (e.g. /contacts/123 → "Контакты")
  const nested = allNavItems.find(
    (item) => item.href !== "/" && pathname.startsWith(`${item.href}/`),
  );
  return nested?.label ?? "Contact Graph";
}
