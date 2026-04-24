"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 xl:mt-6 xl:block xl:space-y-1 xl:overflow-visible xl:pb-0">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-xl border px-3 py-2 text-sm transition xl:block ${
              active
                ? "border-primary/20 bg-primary/10 font-medium text-primary"
                : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground xl:border-transparent"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
