"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { mainNavItems, footerNavItems, type NavItem } from "./nav-items";

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-6 font-semibold">
        <Network className="h-5 w-5" />
        <span>Contact Graph</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-4">
        {mainNavItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="border-t p-4">
        {footerNavItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground md:block">
      <SidebarContent />
    </aside>
  );
}
