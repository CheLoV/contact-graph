import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ImportSourceCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  comingSoon?: boolean;
  comingSoonHint?: string;
  children?: ReactNode;
};

export function ImportSourceCard({
  icon: Icon,
  title,
  description,
  comingSoon,
  comingSoonHint,
  children,
}: ImportSourceCardProps) {
  return (
    <Card className={cn(comingSoon && "opacity-60")}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {title}
              {comingSoon ? (
                <Badge variant="outline" className="text-xs font-normal">
                  Скоро
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {comingSoon ? (
          <p className="text-sm text-muted-foreground">
            {comingSoonHint ?? "Появится в одном из следующих обновлений."}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
