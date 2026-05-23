import { PageHeader } from "@/components/layout/PageHeader";

export default function ChatsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Чаты"
        description="Личные и групповые чаты из подключённых источников"
      />
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Скоро здесь появятся данные
      </div>
    </div>
  );
}
