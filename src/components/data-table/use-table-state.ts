"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataTableColumnDef,
  DataTablePreset,
  DataTableSortState,
  DataTableState,
} from "./types";

function buildDefaults<T>(columns: DataTableColumnDef<T>[]): DataTableState {
  const visibility: Record<string, boolean> = {};
  const order: string[] = [];
  // Сначала alwaysFirst
  for (const col of columns) {
    if (col.alwaysFirst) {
      order.push(col.id);
      visibility[col.id] = true;
    }
  }
  for (const col of columns) {
    if (col.alwaysFirst) continue;
    order.push(col.id);
    visibility[col.id] = col.alwaysVisible ? true : col.defaultVisible ?? false;
  }
  return { visibility, order, sort: null, pageSize: 50 };
}

function isValidState<T>(
  raw: unknown,
  columns: DataTableColumnDef<T>[],
): raw is DataTableState {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<DataTableState>;
  if (!s.visibility || typeof s.visibility !== "object") return false;
  if (!Array.isArray(s.order)) return false;
  if (typeof s.pageSize !== "number") return false;
  // Все колонки из state должны существовать
  const known = new Set(columns.map((c) => c.id));
  for (const id of s.order) if (typeof id !== "string" || !known.has(id)) return false;
  return true;
}

function reconcileWithColumns<T>(
  state: DataTableState,
  columns: DataTableColumnDef<T>[],
): DataTableState {
  // Удаляем неизвестные id, добавляем новые в конец, форсим alwaysFirst в начало.
  const known = new Set(columns.map((c) => c.id));
  const filteredOrder = state.order.filter((id) => known.has(id));
  for (const col of columns) {
    if (!filteredOrder.includes(col.id)) filteredOrder.push(col.id);
  }
  // alwaysFirst — в начало
  const firstIds = columns.filter((c) => c.alwaysFirst).map((c) => c.id);
  const ordered = [
    ...firstIds,
    ...filteredOrder.filter((id) => !firstIds.includes(id)),
  ];
  // visibility: alwaysVisible форсим true
  const visibility = { ...state.visibility };
  for (const col of columns) {
    if (col.alwaysVisible) visibility[col.id] = true;
    if (visibility[col.id] === undefined) {
      visibility[col.id] = col.defaultVisible ?? false;
    }
  }
  return { ...state, order: ordered, visibility };
}

export function useTableState<T>(
  storageKey: string,
  columns: DataTableColumnDef<T>[],
) {
  const defaults = useMemo(() => buildDefaults(columns), [columns]);
  const [state, setState] = useState<DataTableState>(defaults);
  const [hydrated, setHydrated] = useState(false);
  const initialLoad = useRef(true);

  // Hydration из localStorage: оборачиваем в queueMicrotask, чтобы setState
  // не считался синхронным вызовом внутри effect body. SSR рендерит defaults,
  // микротаск догоняет stored state сразу после первого render на клиенте.
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isValidState(parsed, columns)) {
            setState(reconcileWithColumns(parsed, columns));
          }
        }
      } catch {
        // localStorage недоступен — оставляем defaults
      }
      setHydrated(true);
    });
  }, [storageKey, columns]);

  // Запись в localStorage при изменениях (после первоначальной hydration).
  useEffect(() => {
    if (!hydrated) return;
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // noop
    }
  }, [storageKey, state, hydrated]);

  const setVisibility = useCallback((id: string, visible: boolean) => {
    setState((s) => {
      const col = columns.find((c) => c.id === id);
      if (col?.alwaysVisible) return s;
      return { ...s, visibility: { ...s.visibility, [id]: visible } };
    });
  }, [columns]);

  const setOrder = useCallback((order: string[]) => {
    setState((s) => {
      // alwaysFirst всегда в начале
      const firstIds = columns.filter((c) => c.alwaysFirst).map((c) => c.id);
      const filtered = order.filter((id) => !firstIds.includes(id));
      return { ...s, order: [...firstIds, ...filtered] };
    });
  }, [columns]);

  const setSort = useCallback((sort: DataTableSortState | null) => {
    setState((s) => ({ ...s, sort }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setState((s) => ({ ...s, pageSize }));
  }, []);

  const applyPreset = useCallback(
    (preset: DataTablePreset) => {
      setState((s) => {
        const firstIds = columns
          .filter((c) => c.alwaysFirst)
          .map((c) => c.id);
        const presetOrder = preset.visibleColumnIds.filter(
          (id) => !firstIds.includes(id),
        );
        const visibleSet = new Set([...firstIds, ...presetOrder]);
        const order = [
          ...firstIds,
          ...presetOrder,
          ...columns
            .map((c) => c.id)
            .filter((id) => !visibleSet.has(id)),
        ];
        const visibility: Record<string, boolean> = {};
        for (const col of columns) {
          visibility[col.id] = col.alwaysVisible
            ? true
            : visibleSet.has(col.id);
        }
        return { ...s, order, visibility };
      });
    },
    [columns],
  );

  const reset = useCallback(() => setState(defaults), [defaults]);

  return {
    state,
    hydrated,
    setVisibility,
    setOrder,
    setSort,
    setPageSize,
    applyPreset,
    reset,
  };
}
