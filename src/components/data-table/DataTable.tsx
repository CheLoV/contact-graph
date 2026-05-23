"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ColumnsSheet } from "./ColumnsSheet";
import { PresetsMenu } from "./PresetsMenu";
import { useTableState } from "./use-table-state";
import type {
  DataTableColumnDef,
  DataTablePreset,
  DataTableSortState,
} from "./types";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export type DataTableProps<T> = {
  data: T[];
  columns: DataTableColumnDef<T>[];
  presets?: DataTablePreset[];
  getRowId: (row: T) => string;
  storageKey: string;
  leftSlot?: React.ReactNode;
  totalAll?: number;
  emptyMessage?: string;
};

function compare(
  a: string | number | Date | null | undefined,
  b: string | number | Date | null | undefined,
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ru");
}

export function DataTable<T>({
  data,
  columns,
  presets,
  getRowId,
  storageKey,
  leftSlot,
  totalAll,
  emptyMessage = "Нет данных",
}: DataTableProps<T>) {
  const {
    state,
    hydrated,
    setVisibility,
    setOrder,
    setSort,
    setPageSize,
    applyPreset,
    reset,
  } = useTableState(storageKey, columns);

  const [rawPage, setRawPage] = useState(0);

  const colsById = useMemo(() => {
    const m = new Map<string, DataTableColumnDef<T>>();
    for (const c of columns) m.set(c.id, c);
    return m;
  }, [columns]);

  const visibleColumns = useMemo(() => {
    return state.order
      .map((id) => colsById.get(id))
      .filter(
        (c): c is DataTableColumnDef<T> =>
          !!c && (state.visibility[c.id] ?? false),
      );
  }, [colsById, state.order, state.visibility]);

  const sortedData = useMemo(() => {
    if (!state.sort) return data;
    const col = colsById.get(state.sort.columnId);
    if (!col || !col.accessor) return data;
    const accessor = col.accessor;
    const dir = state.sort.desc ? -1 : 1;
    return [...data].sort((a, b) => compare(accessor(a), accessor(b)) * dir);
  }, [data, state.sort, colsById]);

  const pageCount = Math.max(1, Math.ceil(sortedData.length / state.pageSize));
  // Clamp page derived from data length — без useEffect, чище.
  const page = Math.min(rawPage, pageCount - 1);
  const start = page * state.pageSize;
  const end = Math.min(start + state.pageSize, sortedData.length);
  const pageRows = sortedData.slice(start, end);

  const toggleSort = (col: DataTableColumnDef<T>) => {
    if (!col.accessor || col.sortable === false) return;
    const current = state.sort;
    let next: DataTableSortState | null;
    if (!current || current.columnId !== col.id) {
      next = { columnId: col.id, desc: false };
    } else if (!current.desc) {
      next = { columnId: col.id, desc: true };
    } else {
      next = null;
    }
    setSort(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">{leftSlot}</div>
        <div className="flex items-center gap-2">
          <ColumnsSheet
            columns={columns}
            order={state.order}
            visibility={state.visibility}
            onOrderChange={setOrder}
            onVisibilityChange={setVisibility}
          />
          <PresetsMenu
            presets={presets ?? []}
            onApply={applyPreset}
            onReset={() => {
              reset();
              setRawPage(0);
            }}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    col.width,
                    col.accessor &&
                      col.sortable !== false &&
                      "cursor-pointer select-none",
                  )}
                  onClick={() => toggleSort(col)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.accessor && col.sortable !== false ? (
                      state.sort?.columnId === col.id ? (
                        state.sort.desc ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-30" />
                      )
                    ) : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.length || 1}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow key={getRowId(row)}>
                  {visibleColumns.map((col) => (
                    <TableCell key={col.id} className={col.width}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <div>
          {hydrated && sortedData.length > 0 ? (
            <>
              Показано {start + 1}–{end} из{" "}
              <span className="font-medium text-foreground">
                {sortedData.length}
              </span>
              {typeof totalAll === "number" && totalAll !== sortedData.length ? (
                <> (из {totalAll} всего)</>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs">
            На странице:
            <select
              value={state.pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setRawPage(0);
              }}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRawPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Назад
          </Button>
          <span className="tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRawPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Вперёд
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
