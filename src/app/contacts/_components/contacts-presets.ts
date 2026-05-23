import type { DataTablePreset } from "@/components/data-table/types";

// Имя (displayName) добавляется автоматически в начало — все пресеты
// перечисляют только дополнительные колонки.
export const contactPresets: DataTablePreset[] = [
  {
    id: "phonebook",
    label: "Контактная книга",
    visibleColumnIds: ["phones", "emails"],
  },
  {
    id: "professional",
    label: "Профессиональный",
    visibleColumnIds: ["organization", "title", "emails", "address"],
  },
  {
    id: "social",
    label: "Социальный",
    visibleColumnIds: ["sources", "tags"],
  },
  {
    id: "extended",
    label: "Расширенный",
    visibleColumnIds: [
      "sources",
      "phones",
      "emails",
      "organization",
      "title",
      "address",
    ],
  },
  {
    id: "full",
    label: "Полный",
    visibleColumnIds: [
      "nickname",
      "sources",
      "phones",
      "emails",
      "organization",
      "title",
      "address",
      "birthday",
      "tags",
      "urls",
      "notes",
      "createdAt",
      "updatedAt",
    ],
  },
];
