"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { Input } from "@/components/ui/input";
import { chatColumns } from "./chats-columns";
import type { ChatRow } from "./chats-types";

type TypeFilter =
  | "all"
  | "direct"
  | "self"
  | "group"
  | "supergroup"
  | "channel";

function matchesSearch(c: ChatRow, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  if (c.title && c.title.toLowerCase().includes(ql)) return true;
  if (c.description && c.description.toLowerCase().includes(ql)) return true;
  return false;
}

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function ChatsDataTable({ chats }: { chats: ChatRow[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const c of chats) set.add(c.source);
    return Array.from(set).sort();
  }, [chats]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return chats.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
      if (!matchesSearch(c, q)) return false;
      return true;
    });
  }, [chats, search, typeFilter, sourceFilter]);

  return (
    <DataTable<ChatRow>
      data={filtered}
      columns={chatColumns}
      getRowId={(r) => r.id}
      storageKey="chats-table:v1"
      totalAll={chats.length}
      emptyMessage={
        search || typeFilter !== "all" || sourceFilter !== "all"
          ? "Ничего не найдено"
          : "Нет чатов — запустите импорт через /import"
      }
      leftSlot={
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[16rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск: название, описание…"
              className="pl-9"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            aria-label="Тип чата"
          >
            <option value="all">Все типы</option>
            <option value="direct">Личные</option>
            <option value="self">Saved Messages</option>
            <option value="group">Группы</option>
            <option value="supergroup">Супергруппы</option>
            <option value="channel">Каналы</option>
          </select>
          {sources.length > 1 && (
            <select
              className={SELECT_CLASS}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Источник"
            >
              <option value="all">Все источники</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
      }
    />
  );
}
