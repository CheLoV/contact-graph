"use client";

import Link from "next/link";
import { Link as LinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DataTableColumnDef } from "@/components/data-table/types";
import type { ContactRow } from "./contacts-types";

const SOURCE_LABELS: Record<string, string> = {
  vcard: "vCard",
  telegram: "TG",
  whatsapp: "WA",
  linkedin: "LI",
  facebook: "FB",
  vk: "VK",
  twitter: "TW",
  skype: "Skype",
  xmpp: "XMPP",
  aim: "AIM",
  msn: "MSN",
  icq: "ICQ",
  yahoo: "Yahoo",
  gtalk: "GTalk",
  instagram: "IG",
  manual: "Вручную",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const year = dt.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatBirthday(d: Date | string | null): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

function formatAddress(addr: ContactRow["addresses"][number] | undefined): string {
  if (!addr) return "";
  return [addr.city, addr.country].filter(Boolean).join(", ");
}

export const contactColumns: DataTableColumnDef<ContactRow>[] = [
  {
    id: "displayName",
    header: "Имя",
    alwaysFirst: true,
    alwaysVisible: true,
    accessor: (r) => r.displayName,
    sortable: true,
    cell: (r) => (
      <Link
        href={`/contacts/${r.id}`}
        className="font-medium hover:underline"
      >
        {r.displayName}
      </Link>
    ),
  },
  {
    id: "nickname",
    header: "Никнейм",
    accessor: (r) => r.nickname,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {r.nickname ?? "—"}
      </span>
    ),
  },
  {
    id: "sources",
    header: "Источники",
    defaultVisible: true,
    cell: (r) => {
      if (r.identities.length === 0) {
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Вручную
          </Badge>
        );
      }
      return (
        <div className="flex flex-wrap gap-1">
          {r.identities.map((i) => {
            const isSelfReported = i.confidence === "self_reported";
            return (
              <Badge
                key={i.id}
                variant={isSelfReported ? "outline" : "secondary"}
                className={isSelfReported ? "opacity-60" : undefined}
                title={
                  i.handle
                    ? `${sourceLabel(i.source)}: ${i.handle}`
                    : sourceLabel(i.source)
                }
              >
                {sourceLabel(i.source)}
              </Badge>
            );
          })}
        </div>
      );
    },
  },
  {
    id: "phones",
    header: "Телефоны",
    defaultVisible: true,
    cell: (r) => {
      if (r.phoneNumbers.length === 0)
        return <span className="text-muted-foreground">—</span>;
      const first = r.phoneNumbers.slice(0, 2);
      const more = r.phoneNumbers.length - first.length;
      return (
        <span className="text-sm text-muted-foreground">
          {first.map((p) => p.number).join(", ")}
          {more > 0 ? <span className="text-xs"> +{more} ещё</span> : null}
        </span>
      );
    },
  },
  {
    id: "emails",
    header: "Email",
    defaultVisible: true,
    cell: (r) => {
      if (r.emails.length === 0)
        return <span className="text-muted-foreground">—</span>;
      const first = r.emails[0];
      const more = r.emails.length - 1;
      return (
        <span className="text-sm text-muted-foreground">
          {first?.address}
          {more > 0 ? <span className="text-xs"> +{more} ещё</span> : null}
        </span>
      );
    },
  },
  {
    id: "organization",
    header: "Компания",
    accessor: (r) => r.organization,
    sortable: true,
    defaultVisible: true,
    width: "max-w-[16rem]",
    cell: (r) => {
      if (!r.organization)
        return <span className="text-muted-foreground">—</span>;
      return (
        <span title={r.organization} className="block truncate text-sm">
          {truncate(r.organization, 25)}
        </span>
      );
    },
  },
  {
    id: "title",
    header: "Должность",
    accessor: (r) => r.title,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">{r.title ?? "—"}</span>
    ),
  },
  {
    id: "address",
    header: "Адрес",
    accessor: (r) => formatAddress(r.addresses[0]),
    sortable: true,
    defaultVisible: false,
    cell: (r) => {
      const addr = r.addresses[0];
      if (!addr) return <span className="text-muted-foreground">—</span>;
      const text = formatAddress(addr) || addr.formatted;
      return (
        <span className="text-sm text-muted-foreground" title={addr.formatted}>
          {text || "—"}
        </span>
      );
    },
  },
  {
    id: "birthday",
    header: "Дата рождения",
    accessor: (r) => r.birthday,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatBirthday(r.birthday)}
      </span>
    ),
  },
  {
    id: "tags",
    header: "Теги",
    defaultVisible: false,
    cell: (r) => {
      if (r.tagsOnContact.length === 0)
        return <span className="text-muted-foreground">—</span>;
      const first = r.tagsOnContact.slice(0, 2);
      const more = r.tagsOnContact.length - first.length;
      return (
        <div className="flex flex-wrap gap-1">
          {first.map((t) => (
            <Badge key={t.tagId} variant="secondary" className="text-xs">
              {t.tag.name}
            </Badge>
          ))}
          {more > 0 ? (
            <Badge variant="outline" className="text-xs opacity-60">
              +{more}
            </Badge>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "urls",
    header: "URL",
    accessor: (r) => r.urls.length,
    sortable: true,
    defaultVisible: false,
    cell: (r) => {
      if (r.urls.length === 0)
        return <span className="text-muted-foreground">—</span>;
      return (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-xs"
              >
                <LinkIcon className="mr-1 h-3 w-3" />
                {r.urls.length}
              </Button>
            }
          />
          <PopoverContent className="w-80">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Все URL ({r.urls.length}):
            </p>
            <ul className="space-y-1">
              {r.urls.map((u) => (
                <li key={u.id} className="truncate text-xs">
                  <a
                    href={
                      u.url.startsWith("http") ? u.url : `https://${u.url}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                    title={u.url}
                  >
                    {u.label ? `${u.label}: ` : ""}
                    {u.url}
                  </a>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      );
    },
  },
  {
    id: "notes",
    header: "Заметки",
    accessor: (r) => r.notes,
    sortable: true,
    defaultVisible: false,
    cell: (r) => {
      if (!r.notes) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="text-sm text-muted-foreground" title={r.notes}>
          {truncate(r.notes, 50)}
        </span>
      );
    },
  },
  {
    id: "createdAt",
    header: "Создан",
    accessor: (r) => r.createdAt,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDate(r.createdAt)}
      </span>
    ),
  },
  {
    id: "updatedAt",
    header: "Обновлён",
    accessor: (r) => r.updatedAt,
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDate(r.updatedAt)}
      </span>
    ),
  },

  // ---- Telegram-enriched columns (Day 3-A fix) ----
  {
    id: "tgUsername",
    header: "TG @",
    accessor: (r) => telegramIdentity(r)?.handle ?? "",
    sortable: true,
    defaultVisible: true,
    cell: (r) => {
      const tg = telegramIdentity(r);
      if (!tg?.handle) return <span className="text-muted-foreground">—</span>;
      return <span className="text-sm font-mono">@{tg.handle}</span>;
    },
  },
  {
    id: "tgBio",
    header: "Bio",
    accessor: (r) => telegramIdentity(r)?.bio ?? "",
    sortable: false,
    defaultVisible: false,
    cell: (r) => {
      const tg = telegramIdentity(r);
      if (!tg?.bio) return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className="block max-w-[20rem] text-sm text-muted-foreground"
          title={tg.bio}
        >
          {truncate(tg.bio, 60)}
        </span>
      );
    },
  },
  {
    id: "hasPhoto",
    header: "Фото",
    accessor: (r) => (anyPhoto(r) ? 1 : 0),
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm">{anyPhoto(r) ? "📷" : "—"}</span>
    ),
  },
  {
    id: "premium",
    header: "Premium",
    accessor: (r) => (anyPremium(r) ? 1 : 0),
    sortable: true,
    defaultVisible: true,
    cell: (r) => (
      <span className="text-sm" title={anyPremium(r) ? "Telegram Premium" : ""}>
        {anyPremium(r) ? "⭐" : "—"}
      </span>
    ),
  },
  {
    id: "verified",
    header: "Verified",
    accessor: (r) => (anyVerified(r) ? 1 : 0),
    sortable: true,
    defaultVisible: true,
    cell: (r) => (
      <span
        className="text-sm text-blue-500"
        title={anyVerified(r) ? "Verified by Telegram" : ""}
      >
        {anyVerified(r) ? "✓" : "—"}
      </span>
    ),
  },
  {
    id: "commonChats",
    header: "Общие чаты",
    accessor: (r) => telegramIdentity(r)?.commonChatsCount ?? 0,
    sortable: true,
    defaultVisible: true,
    cell: (r) => {
      const n = telegramIdentity(r)?.commonChatsCount;
      if (n === null || n === undefined || n === 0)
        return <span className="text-muted-foreground">—</span>;
      return <span className="tabular-nums text-sm">{n}</span>;
    },
  },
  {
    id: "discoverySource",
    header: "Откуда",
    accessor: (r) => telegramIdentity(r)?.discoverySource ?? "",
    sortable: true,
    defaultVisible: false,
    cell: (r) => {
      const ds = telegramIdentity(r)?.discoverySource;
      if (!ds) return <span className="text-muted-foreground">—</span>;
      const labels: Record<string, string> = {
        contacts_api: "контакт",
        direct_chat: "из чата",
        json_addressbook: "JSON",
        self: "я",
        self_reported: "vCard",
        mention: "упоминание",
        group_member: "группа",
      };
      return (
        <Badge variant="outline" className="font-normal text-xs">
          {labels[ds] ?? ds}
        </Badge>
      );
    },
  },
  {
    id: "phoneVisible",
    header: "Phone виден",
    accessor: (r) => (r.phoneNumbers.length > 0 ? 1 : 0),
    sortable: true,
    defaultVisible: false,
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {r.phoneNumbers.length > 0 ? "да" : "нет"}
      </span>
    ),
  },
];

function telegramIdentity(r: ContactRow) {
  return (
    r.identities.find(
      (i) => i.source === "telegram" && i.confidence === "imported",
    ) ??
    r.identities.find((i) => i.source === "telegram_self") ??
    null
  );
}

function anyPhoto(r: ContactRow): boolean {
  return r.identities.some((i) => i.photoFileId !== null);
}

function anyPremium(r: ContactRow): boolean {
  return r.identities.some((i) => i.isPremium === true);
}

function anyVerified(r: ContactRow): boolean {
  return r.identities.some((i) => i.isVerified === true);
}
