import { PageHeader } from "@/components/layout/PageHeader";

export default function SearchPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Поиск"
        description="Поиск по контактам, сообщениям и связям"
      />
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Скоро здесь появятся данные
      </div>
    </div>
  );
}
