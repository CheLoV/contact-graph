"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { Input } from "@/components/ui/input";
import { contactColumns } from "./contacts-columns";
import { contactPresets } from "./contacts-presets";
import type { ContactRow } from "./contacts-types";

function matchesSearch(c: ContactRow, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (c.displayName.toLowerCase().includes(ql)) return true;
  if (c.nickname && c.nickname.toLowerCase().includes(ql)) return true;
  if (c.organization && c.organization.toLowerCase().includes(ql)) return true;
  for (const p of c.phoneNumbers) {
    if (p.number.toLowerCase().includes(ql)) return true;
  }
  for (const e of c.emails) {
    if (e.address.toLowerCase().includes(ql)) return true;
  }
  return false;
}

export function ContactsDataTable({ contacts }: { contacts: ContactRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return contacts;
    return contacts.filter((c) => matchesSearch(c, q));
  }, [contacts, search]);

  return (
    <DataTable<ContactRow>
      data={filtered}
      columns={contactColumns}
      presets={contactPresets}
      getRowId={(r) => r.id}
      storageKey="contacts-table:v1"
      totalAll={contacts.length}
      emptyMessage={search ? "Ничего не найдено" : "Нет контактов"}
      leftSlot={
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: имя, никнейм, компания, телефон, email…"
            className="pl-9"
          />
        </div>
      }
    />
  );
}
