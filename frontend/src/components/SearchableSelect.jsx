import {
  useMemo,
  useState,
} from "react";
import {
  Check,
  ChevronsUpDown,
} from "lucide-react";

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


export default function SearchableSelect({
  label,
  value = "",
  onChange,
  options = [],
  allLabel = "All",
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matching option.",
  testId,
}) {
  const [open, setOpen] = useState(false);

  const normalized = useMemo(
    () =>
      options
        .map((option) => {
          if (typeof option === "string") {
            return {
              value: option,
              label: option,
            };
          }

          return {
            value: option?.value ?? "",
            label:
              option?.label ??
              option?.value ??
              "",
          };
        })
        .filter((option) =>
          String(option.value).trim()
        ),
    [options]
  );

  const selected = normalized.find(
    (option) => option.value === value
  );

  const buttonLabel = value
    ? selected?.label || value
    : allLabel || placeholder;

  return (
    <div>
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </label>
      )}

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
            className="mt-1 flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                !value && "text-slate-600"
              )}
            >
              {buttonLabel}
            </span>

            <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
            />

            <CommandList className="max-h-[300px]">
              <CommandEmpty>
                {emptyText}
              </CommandEmpty>

              <CommandGroup>
                <CommandItem
                  value={`all ${allLabel}`}
                  onSelect={() => {
                    onChange?.("");
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      !value
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  {allLabel}
                </CommandItem>

                {normalized.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      onChange?.(
                        option.value
                      );
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <span className="truncate">
                      {option.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
