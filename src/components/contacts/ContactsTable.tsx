import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContactListItem } from "@/app/api/contacts/route";

const SOURCE_LABELS: Record<string, string> = {
  vcard: "vCard",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  manual: "Вручную",
};

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source;
}

export function ContactsTable({ contacts }: { contacts: ContactListItem[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Имя</TableHead>
            <TableHead>Источники</TableHead>
            <TableHead>Телефоны</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-12 text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => {
            const uniqSources = Array.from(
              new Set(c.identities.map((i) => i.source)),
            );
            const firstPhones = c.phoneNumbers.slice(0, 2);
            const firstEmail = c.emails[0];
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.displayName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {uniqSources.length === 0 ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Вручную
                      </Badge>
                    ) : (
                      uniqSources.map((s) => (
                        <Badge key={s} variant="secondary">
                          {sourceLabel(s)}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {firstPhones.length === 0
                    ? "—"
                    : firstPhones.map((p) => p.number).join(", ")}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {firstEmail?.address ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Действия">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
