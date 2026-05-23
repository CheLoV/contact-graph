"use client";

import { LayoutTemplate, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DataTablePreset } from "./types";

type PresetsMenuProps = {
  presets: DataTablePreset[];
  onApply: (preset: DataTablePreset) => void;
  onReset: () => void;
};

export function PresetsMenu({ presets, onApply, onReset }: PresetsMenuProps) {
  return (
    <div className="flex gap-1">
      {presets.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                <LayoutTemplate className="mr-1 h-4 w-4" />
                Пресеты
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Применить пресет</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {presets.map((preset) => (
              <DropdownMenuItem key={preset.id} onClick={() => onApply(preset)}>
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="mr-1 h-4 w-4" />
        Сброс
      </Button>
    </div>
  );
}
