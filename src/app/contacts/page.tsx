import Link from "next/link";
import { Upload, Users } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { AddContactDialog } from "@/components/contacts/AddContactDialog";
import { ContactsDataTable } from "./_components/ContactsDataTable";
import { contactRowInclude } from "./_components/contacts-types";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await db.contact.findMany({
    where: { isArchived: false },
    include: contactRowInclude,
    orderBy: [{ displayName: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Контакты"
        description="Все ваши контакты из всех источников"
        action={<AddContactDialog />}
      />

      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <ContactsDataTable contacts={contacts} />
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
