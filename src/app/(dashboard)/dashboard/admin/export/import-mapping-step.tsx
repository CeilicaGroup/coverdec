"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelForColumnIndex } from "@/features/imports/excel-columns";
import { getFieldDefinitions } from "@/features/imports/import-fields";
import type { ImportMapping, SheetColumnOption } from "@/features/imports/types";

interface ImportMappingStepProps {
  sheetNames: string[];
  columnOptions: SheetColumnOption[];
  mapping: ImportMapping;
  onMappingChange: (mapping: ImportMapping) => void;
  disabled?: boolean;
}

export function ImportMappingStep({
  sheetNames,
  columnOptions,
  mapping,
  onMappingChange,
  disabled,
}: ImportMappingStepProps) {
  const fields = getFieldDefinitions();

  function setSheet(sheetName: string) {
    onMappingChange({ ...mapping, sheetName });
  }

  function setColumn(field: string, col: number | null) {
    onMappingChange({
      ...mapping,
      columnMap: { ...mapping.columnMap, [field]: col },
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 max-w-sm">
        <Label>Hoja</Label>
        <Select
          value={mapping.sheetName}
          onValueChange={(v) => v && setSheet(v)}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona hoja" />
          </SelectTrigger>
          <SelectContent>
            {sheetNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border divide-y">
        {fields.map((field) => {
          const current =
            mapping.columnMap[field.key as keyof typeof mapping.columnMap];
          const value = current != null ? String(current) : "__none__";
          const selectedLabel = labelForColumnIndex(columnOptions, current);

          return (
            <div
              key={field.key}
              className="grid gap-2 sm:grid-cols-[1fr_1fr] items-center px-3 py-2 text-sm"
            >
              <span>
                {field.label}
                {field.required ? (
                  <span className="text-destructive ml-0.5">*</span>
                ) : null}
              </span>
              <Select
                value={value}
                onValueChange={(v) => {
                  if (!v || v === "__none__") setColumn(field.key, null);
                  else setColumn(field.key, Number(v));
                }}
                disabled={disabled}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="— No mapear —">
                    {selectedLabel ?? undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No mapear —</SelectItem>
                  {columnOptions.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
