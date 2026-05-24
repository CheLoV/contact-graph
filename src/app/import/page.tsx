import { MessageCircle, Briefcase, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { VCardImportCard } from "@/components/import/VCardImportCard";
import { TelegramImportCard } from "@/components/import/TelegramImportCard";
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
        <TelegramImportCard />
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
