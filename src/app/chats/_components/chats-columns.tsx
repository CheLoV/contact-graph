"use client";

import { Badge } from "@/components/ui/badge";
import type { DataTableColumnDef } from "@/components/data-table/types";
import type { ChatRow } from "./chats-types";

const TYPE_LABEL: Record<string, string> = {
  direct: "Личный",
  self: "Saved Messages",
  group: "Группа",
  supergroup: "Супергруппа",
  channel: "Канал",
};

const SOURCE_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  slack: "Slack",
};

function truncate(s: string | null, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatSeconds(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s === 0) return "0";
  if (s < 60) return `${s}с`;
  if (s < 3600) return `${Math.round(s / 60)}мин`;
  return `${Math.round(s / 3600)}ч`;
}

export const chatColumns: DataTableColumnDef<ChatRow>[] = [
  {
    id: "title",
    header: "Название",
    alwaysFirst: true,
    alwaysVisible: true,
    accessor: (r) => r.title ?? "",
    sortable: true,
    cell: (r) => (
      <span className="font-medium">{r.title ?? "Без названия"}</span>
    ),
  },
  {
    id: "type",
    header: "Тип",
    accessor: (r) => r.type,
    sortable: true,
    defaultVisible: true,
    cell: (r) => (
      <Badge variant="secondary" className="font-normal">
        {TYPE_LABEL[r.type] ?? r.type}
      </Badge>
    ),
  },
  {
    id: "source",
    header: "Источник",
    accessor: (r) => r.source,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {SOURCE_LABEL[r.source] ?? r.source}
      </span>
    ),
  },
  {
    id: "memberCount",
    header: "Участников",
    accessor: (r) => r.memberCount ?? 0,
    sortable: true,
    defaultVisible: true,
    cell: (r) => (
      <span className="tabular-nums text-sm">
        {r.memberCount ?? "—"}
      </span>
    ),
  },
  {
    id: "description",
    header: "Описание",
    accessor: (r) => r.description,
    sortable: false,
    defaultVisible: true,
    cell: (r) => (
      <span
        className="block max-w-md text-sm text-muted-foreground"
        title={r.description ?? undefined}
      >
        {truncate(r.description, 100) || "—"}
      </span>
    ),
  },
  {
    id: "creationDate",
    header: "Создан",
    accessor: (r) => r.creationDate,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatDate(r.creationDate)}
      </span>
    ),
  },
  {
    id: "isPublic",
    header: "Публичный",
    accessor: (r) => (r.isPublic ? 1 : 0),
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {r.isPublic ? "да" : "—"}
      </span>
    ),
  },
  {
    id: "hasPhoto",
    header: "Фото",
    accessor: (r) => (r.photoFileId ? 1 : 0),
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {r.photoFileId ? "есть" : "—"}
      </span>
    ),
  },
  {
    id: "messageCount",
    header: "Сообщений",
    accessor: (r) => r.messageCount,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="tabular-nums text-sm">
        {r.messageCount > 0 ? r.messageCount : "—"}
      </span>
    ),
  },
  {
    id: "slowmode",
    header: "Slowmode",
    accessor: (r) => r.slowmodeSeconds ?? 0,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {formatSeconds(r.slowmodeSeconds)}
      </span>
    ),
  },
];
