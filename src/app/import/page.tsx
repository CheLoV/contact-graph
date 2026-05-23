import { PageHeader } from "@/components/layout/PageHeader";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Импорт"
        description="Загрузка контактов из vCard, Telegram и других источников"
      />
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Скоро здесь появятся данные
      </div>
    </div>
  );
}
