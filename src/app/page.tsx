import { Users, MessageSquare, MessagesSquare, Network } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

type Tile = {
  title: string;
  icon: LucideIcon;
  value: string;
};

const tiles: Tile[] = [
  { title: "Контакты", icon: Users, value: "—" },
  { title: "Чаты", icon: MessageSquare, value: "—" },
  { title: "Сообщения", icon: MessagesSquare, value: "—" },
  { title: "Связи", icon: Network, value: "—" },
];

export default function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Дашборд"
        description="Общая статистика по вашему графу контактов"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ title, icon: Icon, value }) => (
          <Card key={title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {title}
              </CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
