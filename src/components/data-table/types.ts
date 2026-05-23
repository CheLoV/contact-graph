import type { ReactNode } from "react";

export type DataTableColumnDef<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  // Для сортировки/поиска по этому полю. Если не задано — колонка несортируема.
  accessor?: (row: T) => string | number | Date | null | undefined;
  sortable?: boolean;
  alwaysVisible?: boolean; // чекбокс disabled
  alwaysFirst?: boolean; // нельзя двигать; обычно alwaysVisible тоже true
  defaultVisible?: boolean;
  // Ширина колонки (Tailwind class), напр. "w-48" / "min-w-[12rem]"
  width?: string;
};

export type DataTablePreset = {
  id: string;
  label: string;
  // Порядок и состав видимых колонок. Имя контакта (alwaysFirst) добавляется автоматически.
  visibleColumnIds: string[];
};

export type DataTableSortState = {
  columnId: string;
  desc: boolean;
};

export type DataTableState = {
  visibility: Record<string, boolean>;
  order: string[];
  sort: DataTableSortState | null;
  pageSize: number;
};
