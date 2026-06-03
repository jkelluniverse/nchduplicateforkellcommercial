import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("nch_token")}`, "Content-Type": "application/json" };
}

interface Property {
  id: number;
  address: string;
  resident1Name: string | null;
  resident1Phone: string | null;
  resident1Email: string | null;
  resident2Name: string | null;
  resident2Phone: string | null;
  resident2Email: string | null;
  notes: string | null;
}

export default function Properties() {
  const [search, setSearch] = useState("");

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["properties", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const r = await fetch(`${API_BASE}/api/properties?${params}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold mb-3">Properties</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            className="pl-10 bg-primary-foreground text-foreground border-0 h-12 rounded-xl"
            placeholder="Search address or tenant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : properties.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No properties found.</div>
        ) : (
          properties.map((prop) => (
            <Card key={prop.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <h3 className="font-semibold text-sm">{prop.address}</h3>
                {prop.resident1Name && (
                  <p className="text-xs text-muted-foreground mt-1">{prop.resident1Name}</p>
                )}
                {prop.resident2Name && (
                  <p className="text-xs text-muted-foreground">{prop.resident2Name}</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
