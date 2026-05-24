import Link from "next/link";
import { MessageSquare, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { ChatsDataTable } from "./_components/ChatsDataTable";
import { chatRowSelect } from "./_components/chats-types";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const chats = await db.chat.findMany({
    where: { isArchived: false },
    select: chatRowSelect,
    orderBy: [{ memberCount: "desc" }, { title: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Чаты"
        description="Личные и групповые чаты из подключённых источников"
      />

      {chats.length === 0 ? <EmptyState /> : <ChatsDataTable chats={chats} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Пока нет чатов</p>
        <p className="text-sm text-muted-foreground">
          Запустите импорт Telegram через /import — там и контакты, и чаты.
        </p>
      </div>
      <Link href="/import" className={buttonVariants({ variant: "outline" })}>
        <Upload className="mr-1 h-4 w-4" />
        Импортировать
      </Link>
    </div>
  );
}
