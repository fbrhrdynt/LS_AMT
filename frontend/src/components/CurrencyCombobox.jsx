import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CURRENCIES } from "@/lib/currencies";

export default function CurrencyCombobox({ value, onChange, testId }) {
  const [open, setOpen] = useState(false);
  const selected = CURRENCIES.find((c) => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} data-testid={testId}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-blue-500">
          <span className={cn("truncate", !selected && "text-slate-400")}>
            {selected ? `${selected.code} — ${selected.label}` : "Select currency…"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search currency (code / country)…" data-testid="currency-search" />
          <CommandList>
            <CommandEmpty>No currency found.</CommandEmpty>
            <CommandGroup>
              {CURRENCIES.map((c) => (
                <CommandItem key={c.code} value={`${c.code} ${c.label} ${c.symbol}`}
                  onSelect={() => { onChange(c.code); setOpen(false); }} data-testid={`currency-item-${c.code}`}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono text-xs font-bold text-slate-900 w-12">{c.code}</span>
                  <span className="flex-1 truncate text-sm text-slate-700">{c.label}</span>
                  <span className="ml-2 text-slate-400">{c.symbol}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
