export interface PropertyOption {
  id: number;
  address: string;
  resident1Name: string | null;
  resident2Name: string | null;
}

export function formatPropertyOption(property: {
  address: string;
  resident1Name?: string | null;
  resident2Name?: string | null;
}): { label: string; value: string } {
  const r1 = property.resident1Name?.trim() || null;
  const r2 = property.resident2Name?.trim() || null;

  let tenantLabel = "";
  if (r1 && r2) tenantLabel = ` — ${r1} & ${r2}`;
  else if (r1) tenantLabel = ` — ${r1}`;
  else tenantLabel = " — Vacant";

  return {
    label: property.address + tenantLabel,
    value: property.address,
  };
}

export function searchProperties(properties: PropertyOption[], q: string): PropertyOption[] {
  if (!q.trim()) return properties;
  const lower = q.toLowerCase();
  return properties.filter(
    (p) =>
      p.address.toLowerCase().includes(lower) ||
      p.resident1Name?.toLowerCase().includes(lower) ||
      p.resident2Name?.toLowerCase().includes(lower),
  );
}
