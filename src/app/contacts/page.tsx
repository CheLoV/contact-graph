import Link from "next/link";
import { Upload, Users, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddContactDialog } from "@/components/contacts/AddContactDialog";
import { ContactsTable } from "@/components/contacts/ContactsTable";
import {
  contactListInclude,
  type ContactListItem,
} from "@/app/api/contacts/route";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

function parsePage(raw: string | string[] | undefined): number {
  if (Array.isArray(raw)) raw = raw[0];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parseSearch(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) raw = raw[0];
  return (raw ?? "").trim();
}

function matchesSearch(c: ContactListItem, q: string): boolean {
  const ql = q.toLowerCase();
  if (c.displayName.toLowerCase().includes(ql)) return true;
  if (c.notes && c.notes.toLowerCase().includes(ql)) return true;
  for (const p of c.phoneNumbers) {
    if (p.number.toLowerCase().includes(ql)) return true;
  }
  for (const e of c.emails) {
    if (e.address.toLowerCase().includes(ql)) return true;
  }
  for (const i of c.identities) {
    if (i.handle && i.handle.toLowerCase().includes(ql)) return true;
  }
  return false;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const search = parseSearch(params.search);

  let contacts: ContactListItem[];
  let filteredTotal: number;
  let allTotal: number;

  if (search) {
    // In-memory case-insensitive filtering (SQLite `contains` is case-sensitive).
    // На масштабе до ~10k контактов это безопасно.
    const all = await db.contact.findMany({
      where: { isArchived: false },
      include: contactListInclude,
      orderBy: [{ displayName: "asc" }],
    });
    allTotal = all.length;
    const matched = all.filter((c) => matchesSearch(c, search));
    filteredTotal = matched.length;
    contacts = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  } else {
    const [pageRows, total] = await db.$transaction([
      db.contact.findMany({
        where: { isArchived: false },
        include: contactListInclude,
        orderBy: [{ displayName: "asc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.contact.count({ where: { isArchived: false } }),
    ]);
    contacts = pageRows;
    filteredTotal = total;
    allTotal = total;
  }

  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Контакты"
        description="Все ваши контакты из всех источников"
        action={<AddContactDialog />}
      />

      {allTotal === 0 ? (
        <EmptyState />
      ) : (
        <>
          <form className="flex gap-2" action="/contacts" method="get">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                name="search"
                defaultValue={search}
                placeholder="Поиск по имени, телефону, email…"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="outline">
              Найти
            </Button>
            {search ? (
              <Link
                href="/contacts"
                className={buttonVariants({ variant: "ghost" })}
              >
                Сбросить
              </Link>
            ) : null}
          </form>

          <p className="text-sm text-muted-foreground">
            {search ? (
              <>
                Найдено:{" "}
                <span className="font-medium text-foreground">
                  {filteredTotal}
                </span>{" "}
                из {allTotal}
              </>
            ) : (
              <>
                Всего:{" "}
                <span className="font-medium text-foreground">{allTotal}</span>
              </>
            )}
          </p>

          {contacts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            <ContactsTable contacts={contacts} />
          )}

          <Pagination
            page={safePage}
            pageCount={pageCount}
            search={search}
          />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  search,
}: {
  page: number;
  pageCount: number;
  search: string;
}) {
  if (pageCount <= 1) return null;

  const mkHref = (p: number) => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (p > 1) qs.set("page", String(p));
    const q = qs.toString();
    return q ? `/contacts?${q}` : "/contacts";
  };

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={mkHref(page - 1)}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          prevDisabled && "pointer-events-none opacity-50",
        )}
        aria-disabled={prevDisabled}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Назад
      </Link>
      <span className="text-sm text-muted-foreground tabular-nums">
        {page} / {pageCount}
      </span>
      <Link
        href={mkHref(page + 1)}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          nextDisabled && "pointer-events-none opacity-50",
        )}
        aria-disabled={nextDisabled}
      >
        Вперёд
        <ChevronRight className="ml-1 h-4 w-4" />
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Users className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">У вас пока нет контактов</p>
        <p className="text-sm text-muted-foreground">
          Импортируйте из vCard или Telegram, или добавьте вручную.
        </p>
      </div>
      <Link href="/import" className={buttonVariants({ variant: "outline" })}>
        <Upload className="mr-1 h-4 w-4" />
        Импортировать
      </Link>
    </div>
  );
}
