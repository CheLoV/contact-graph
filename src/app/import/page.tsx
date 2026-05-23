import { MessageCircle, Send, Briefcase, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { VCardImportCard } from "@/components/import/VCardImportCard";
import { ImportSourceCard } from "@/components/import/ImportSourceCard";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Импорт данных"
        description="Загрузите выгрузки из ваших источников"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <VCardImportCard />
        <ImportSourceCard
          icon={Send}
          title="Telegram"
          description="Выгрузка JSON из Telegram Desktop"
          comingSoon
          comingSoonHint="День 3: разбор chats/users/messages.json"
        />
        <ImportSourceCard
          icon={MessageCircle}
          title="WhatsApp"
          description="Экспорт чата в .txt из мобильного приложения"
          comingSoon
        />
        <ImportSourceCard
          icon={Briefcase}
          title="LinkedIn"
          description="Архив данных аккаунта (Connections.csv)"
          comingSoon
        />
        <ImportSourceCard
          icon={Users}
          title="Facebook"
          description="Архив данных профиля (friends.html / messages)"
          comingSoon
        />
      </div>
    </div>
  );
}
