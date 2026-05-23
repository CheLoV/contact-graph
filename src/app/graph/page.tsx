import { PageHeader } from "@/components/layout/PageHeader";

export default function GraphPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Граф"
        description="Визуализация связей между контактами"
      />
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        Скоро здесь появятся данные
      </div>
    </div>
  );
}
