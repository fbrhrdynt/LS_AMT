import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

/**
 * Searchable dropdown for inventory items.
 * items: [{id, item_code, item_name, type, unit, stock}]
 */
export default function ItemCombobox({ items, value, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-slate-400")}>
            {selected ? `${selected.item_code} · ${selected.item_name}` : "Select item…"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search code, name, part no…" data-testid="combobox-search" />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {items.map((it) => (
                <CommandItem
                  key={it.id}
                  value={`${it.item_code} ${it.item_name} ${it.part_number || ""} ${it.type}`}
                  onSelect={() => { onChange(it.id); setOpen(false); }}
                  data-testid={`combobox-item-${it.id}`}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === it.id ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-900">
                      <span className="font-mono text-xs text-slate-500">{it.item_code}</span> · {it.item_name}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {it.type} · {it.stock} {it.unit} in stock
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
