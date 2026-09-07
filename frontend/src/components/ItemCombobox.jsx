import { useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";


/**
 * Searchable dropdown for inventory items.
 *
 * `portal={false}` keeps the popover inside the maintenance dialog's
 * scroll container. This avoids the Radix Dialog scroll-lock blocking
 * mouse-wheel events on a portalled dropdown.
 */
export default function ItemCombobox({
  items = [],
  value,
  onChange,
  testId,
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);

  const selected = items.find(
    (item) => item.id === value
  );

  const selectedLabel = selected
    ? `${selected.item_code} · ${selected.item_name}`
    : "Select item…";

  const onWheel = (event) => {
    const list = listRef.current;
    if (!list) return;

    if (list.scrollHeight <= list.clientHeight) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    list.scrollTop += event.deltaY;
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          data-testid={testId}
          title={selected ? selectedLabel : undefined}
          className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          <span
            className={cn(
              "block min-w-0 max-w-full flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
              !selected && "text-slate-400"
            )}
          >
            {selectedLabel}
          </span>

          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        portal={false}
        className="w-[--radix-popover-trigger-width] max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        <Command
          filter={(valueText, search) =>
            valueText
              .toLowerCase()
              .includes(search.toLowerCase())
              ? 1
              : 0
          }
        >
          <CommandInput
            placeholder="Search code, name, category, part no…"
            data-testid="combobox-search"
          />

          <CommandList
            ref={listRef}
            onWheelCapture={onWheel}
            className="max-h-[300px] overscroll-contain"
          >
            <CommandEmpty>
              No matching spare part found.
            </CommandEmpty>

            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={[
                    item.item_code,
                    item.item_name,
                    item.category,
                    item.part_number,
                    item.type,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  data-testid={`combobox-item-${item.id}`}
                  className="min-w-0"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === item.id
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />

                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="text-sm text-slate-900">
                      <span className="font-mono text-xs text-slate-500">
                        {item.item_code}
                      </span>
                      <span> · </span>
                      <span className="break-words">
                        {item.item_name}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      {item.category || "Uncategorized"}
                      {" · "}
                      {item.type}
                      {" · "}
                      Stock: {item.stock} {item.unit}
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
