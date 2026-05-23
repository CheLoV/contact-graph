import { PageHeader } from "@/components/layout/PageHeader";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Настройки" description="Параметры приложения" />
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Скоро здесь появятся данные
      </div>
    </div>
  );
}
