import Link from "next/link";
import { Upload, Users } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { AddContactDialog } from "@/components/contacts/AddContactDialog";
import { ContactsTable } from "@/components/contacts/ContactsTable";
import { contactListInclude } from "@/app/api/contacts/route";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const [contacts, total] = await db.$transaction([
    db.contact.findMany({
      where: { isArchived: false },
      include: contactListInclude,
      orderBy: [{ displayName: "asc" }],
      take: 50,
    }),
    db.contact.count({ where: { isArchived: false } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Контакты"
        description="Все ваши контакты из всех источников"
        action={<AddContactDialog />}
      />

      {total === 0 ? (
        <EmptyState />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Всего: <span className="font-medium text-foreground">{total}</span>
          </p>
          <ContactsTable contacts={contacts} />
        </>
      )}
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
