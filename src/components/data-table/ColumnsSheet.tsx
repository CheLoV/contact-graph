"use client";

import { useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Columns3, GripVertical, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { DataTableColumnDef } from "./types";

type ColumnsSheetProps<T> = {
  columns: DataTableColumnDef<T>[];
  order: string[];
  visibility: Record<string, boolean>;
  onOrderChange: (order: string[]) => void;
  onVisibilityChange: (id: string, visible: boolean) => void;
};

export function ColumnsSheet<T>({
  columns,
  order,
  visibility,
  onOrderChange,
  onVisibilityChange,
}: ColumnsSheetProps<T>) {
  const [open, setOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const colsById = new Map(columns.map((c) => [c.id, c]));
  const orderedCols = order
    .map((id) => colsById.get(id))
    .filter((c): c is DataTableColumnDef<T> => !!c);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(order, oldIdx, newIdx);
    onOrderChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <Columns3 className="mr-1 h-4 w-4" />
            Колонки
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Колонки и порядок</SheetTitle>
          <SheetDescription>
            Перетащите для изменения порядка, отметьте для отображения.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-1 px-4 pb-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedCols.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedCols.map((col) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  visible={visibility[col.id] ?? false}
                  onToggleVisible={(v) => onVisibilityChange(col.id, v)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ColumnRow<T>({
  col,
  visible,
  onToggleVisible,
}: {
  col: DataTableColumnDef<T>;
  visible: boolean;
  onToggleVisible: (v: boolean) => void;
}) {
  const sortable = useSortable({ id: col.id, disabled: col.alwaysFirst });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isLocked = !!col.alwaysFirst;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-card px-2 py-1.5",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        aria-label={isLocked ? "Колонка закреплена" : "Перетащить колонку"}
        disabled={isLocked}
        className={cn(
          "flex h-7 w-6 items-center justify-center text-muted-foreground",
          isLocked ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing",
        )}
        {...attributes}
        {...listeners}
      >
        {isLocked ? (
          <Lock className="h-3.5 w-3.5" />
        ) : (
          <GripVertical className="h-4 w-4" />
        )}
      </button>
      <Checkbox
        checked={visible}
        disabled={col.alwaysVisible}
        onCheckedChange={(c) => onToggleVisible(c === true)}
      />
      <span className="flex-1 text-sm">{col.header}</span>
    </div>
  );
}
