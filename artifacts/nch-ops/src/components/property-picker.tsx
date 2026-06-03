import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDown, Check, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { type PropertyOption, formatPropertyOption, searchProperties } from "@/lib/property-utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("nch_token")}` };
}

interface Props {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PropertyPicker({ value, onChange, placeholder = "Select property...", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(false);

  const { data: properties = [] } = useQuery<PropertyOption[]>({
    queryKey: ["properties-local-picker"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/properties`, { headers: authHeaders() });
      if (!r.ok) return [];
      const rows: PropertyOption[] = await r.json();
      return rows.slice().sort((a, b) => a.address.localeCompare(b.address));
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => searchProperties(properties, search), [properties, search]);

  const selectedProperty = properties.find((p) => p.address === value);
  const displayLabel = selectedProperty
    ? formatPropertyOption(selectedProperty).label
    : value || "";

  if (customMode) {
    return (
      <div className="space-y-1.5">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type full address..."
          className="h-12"
          autoFocus
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(""); }}
          className="text-xs text-primary font-medium hover:underline"
        >
          Pick from property list instead
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full h-12 px-3 rounded-lg border border-input bg-background text-left flex items-center justify-between gap-2 hover:border-primary/50 transition-colors disabled:opacity-50"
      >
        <span className={`truncate text-sm ${displayLabel ? "text-foreground" : "text-muted-foreground"}`}>
          {displayLabel || placeholder}
        </span>
        <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-72 flex flex-col">
          <div className="p-2 border-b border-border shrink-0">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search address or name..."
              className="h-9"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.map((p) => {
              const opt = formatPropertyOption(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onChange(p.address); setOpen(false); setSearch(""); }}
                  className="w-full text-left px-3 py-2.5 hover:bg-muted flex items-center gap-2 text-sm"
                >
                  <Check className={`w-4 h-4 shrink-0 ${value === p.address ? "text-primary" : "text-transparent"}`} />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No matching properties</p>
            )}
          </div>
          <div className="border-t border-border p-2 shrink-0">
            <button
              type="button"
              onClick={() => { setCustomMode(true); setOpen(false); setSearch(""); onChange(""); }}
              className="w-full text-left px-3 py-2 hover:bg-muted rounded-md flex items-center gap-2 text-sm text-primary font-medium"
            >
              <Pencil className="w-4 h-4" />
              Type a custom address
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
