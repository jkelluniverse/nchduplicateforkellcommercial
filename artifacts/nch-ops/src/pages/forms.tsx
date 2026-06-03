import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ClipboardList,
  Plug,
  ExternalLink,
  Share2,
  Eye,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SheetButtonRow } from "@/components/sheet-button-row";
import PublicApply from "./public-apply";
import PublicUtilities from "./public-utilities";

interface FormMeta {
  key: "apply" | "utilities";
  title: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

const FORMS: FormMeta[] = [
  {
    key: "apply",
    title: "Tenant Application",
    description: "Public resident application with ID and income upload.",
    path: "/apply",
    icon: <ClipboardList className="w-6 h-6" />,
  },
  {
    key: "utilities",
    title: "Utility Accounts",
    description: "Tenants submit electric, gas, and water account numbers.",
    path: "/utilities",
    icon: <Plug className="w-6 h-6" />,
  },
];

export default function FormsPage() {
  const { user } = useAuth();
  const [openForm, setOpenForm] = useState<"apply" | "utilities" | null>(null);
  const [showSubs, setShowSubs] = useState<"apply" | "utilities" | null>(null);
  const isJacob = user?.role === "jacob";
  const { toast } = useToast();

  async function share(path: string) {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ url, title: "Nice City Homes Form" });
        return;
      }
    } catch {
      // fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Link", description: url });
    }
  }

  if (openForm === "apply") {
    return (
      <div className="relative">
        <InlineCloseButton onClick={() => setOpenForm(null)} />
        <PublicApply />
      </div>
    );
  }
  if (openForm === "utilities") {
    return (
      <div className="relative">
        <InlineCloseButton onClick={() => setOpenForm(null)} />
        <PublicUtilities />
      </div>
    );
  }
  if (showSubs) {
    return <SubmissionsView kind={showSubs} onBack={() => setShowSubs(null)} />;
  }

  return (
    <div className="pb-24">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold">Forms</h1>
        <p className="text-sm opacity-90">Public tenant forms</p>
      </div>

      <div className="p-4 space-y-4">
        {FORMS.map((f) => (
          <Card key={f.key}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 p-3 rounded-full text-primary shrink-0">
                  {f.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-lg leading-tight">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.description}</p>
                  <p className="text-xs text-muted-foreground mt-1 break-all">
                    {window.location.origin}
                    {f.path}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="w-full"
                  onClick={() => setOpenForm(f.key)}
                >
                  <ExternalLink className="w-4 h-4 mr-2" /> Open Form
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => share(f.path)}
                >
                  <Share2 className="w-4 h-4 mr-2" /> Send Link
                </Button>
                {isJacob && (
                  <Button
                    variant="secondary"
                    className="w-full col-span-2"
                    onClick={() => setShowSubs(f.key)}
                  >
                    <Eye className="w-4 h-4 mr-2" /> View Submissions
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function InlineCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed top-3 right-3 z-50 bg-white/90 border border-gray-300 rounded-full w-10 h-10 flex items-center justify-center shadow"
      aria-label="Close form"
    >
      <X className="w-5 h-5" />
    </button>
  );
}

// ── Status badge ────────────────────────────────────────────────────────
type AppStatus = "new" | "approved" | "declined" | "pending";

const STATUS_LABEL: Record<AppStatus, string> = {
  new: "New",
  approved: "Approved",
  declined: "Declined",
  pending: "Pending",
};

const STATUS_CLASSES: Record<AppStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  pending: "bg-amber-100 text-amber-800",
};

function StatusBadge({ status }: { status: AppStatus }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ── Full interfaces ──────────────────────────────────────────────────────
interface TenantApp {
  id: number;
  fullLegalName: string;
  propertyAddress: string;
  viewedProperty: "yes" | "no";
  moveInDate: string;
  phone: string;
  loginEmail: string;
  contactEmail: string;
  employer: string;
  monthlyIncome: string;
  occupants: string;
  pets: string;
  secondContact: string;
  idFileUrl: string | null;
  proofFileUrl: string | null;
  status: AppStatus;
  createdAt: string;
}

interface UtilitySub {
  id: number;
  accountHolder: string;
  propertyAddress: string;
  email: string;
  electricProvider: string;
  electricAccount: string;
  gasProvider: string;
  gasAccount: string;
  waterProvider: string;
  waterAccount: string;
  createdAt: string;
}

// ── Submissions view ────────────────────────────────────────────────────
function SubmissionsView({
  kind,
  onBack,
}: {
  kind: "apply" | "utilities";
  onBack: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem("nch_token");
    const endpoint =
      kind === "apply"
        ? "/api/forms/tenant-applications"
        : "/api/forms/utility-submissions";
    fetch(endpoint, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json();
      })
      .then((data) => setRows(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pb-24">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <button onClick={onBack} className="text-sm underline">
          Back
        </button>
        <h1 className="text-xl font-bold">
          {kind === "apply" ? "Tenant Applications" : "Utility Submissions"}
        </h1>
      </div>
      <div className="p-4 space-y-3">
        {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">No submissions yet.</div>
        )}
        {kind === "apply" &&
          (rows as TenantApp[]).map((r) => (
            <TenantAppCard
              key={r.id}
              app={r}
              onStatusChange={(newStatus) => {
                setRows((prev) =>
                  prev.map((row) => (row.id === r.id ? { ...row, status: newStatus } : row)),
                );
              }}
            />
          ))}
        {kind === "utilities" &&
          (rows as UtilitySub[]).map((r) => (
            <UtilitySubCard key={r.id} sub={r} />
          ))}
      </div>
    </div>
  );
}

// ── Tenant Application Card ─────────────────────────────────────────────
function TenantAppCard({
  app,
  onStatusChange,
}: {
  app: TenantApp;
  onStatusChange: (s: AppStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  async function updateStatus(status: AppStatus) {
    setSaving(true);
    try {
      const token = localStorage.getItem("nch_token");
      const r = await fetch(`/api/forms/tenant-applications/${app.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (r.ok) onStatusChange(status);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <button
          className="w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight">{app.fullLegalName}</div>
              <div className="text-sm text-muted-foreground">{app.propertyAddress}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Applied: {new Date(app.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={app.status} />
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </button>

        {expanded && (
          <div className="space-y-3 pt-1 border-t border-border">
            {/* Property */}
            <DetailSection title="Property">
              <DetailRow label="Applying for" value={app.propertyAddress} />
              <DetailRow label="Viewed property" value={app.viewedProperty === "yes" ? "Yes" : "No"} />
              <DetailRow label="Desired move-in" value={app.moveInDate} />
            </DetailSection>

            {/* Contact */}
            <DetailSection title="Contact">
              <DetailRow label="Phone" value={app.phone} />
              <DetailRow label="Email" value={app.contactEmail} />
            </DetailSection>

            {/* Employment */}
            <DetailSection title="Employment">
              <DetailRow label="Employer" value={app.employer} />
              <DetailRow label="Monthly income" value={`$${app.monthlyIncome}`} />
            </DetailSection>

            {/* Household */}
            <DetailSection title="Household">
              <DetailRow label="Occupants" value={app.occupants} />
              <DetailRow label="Pets" value={app.pets || "None"} />
            </DetailSection>

            {/* Second Contact */}
            <DetailSection title="Second Contact">
              <p className="text-sm">
                {app.secondContact?.trim() || "None provided"}
              </p>
            </DetailSection>

            {/* Documents */}
            <DetailSection title="Documents">
              <div className="flex flex-wrap gap-3">
                {app.idFileUrl ? (
                  <a
                    href={app.idFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary underline"
                  >
                    <FileText className="w-4 h-4" /> ID Photo
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">ID Photo — not uploaded</span>
                )}
                {app.proofFileUrl ? (
                  <a
                    href={app.proofFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary underline"
                  >
                    <FileText className="w-4 h-4" /> Proof of Income
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">Proof of Income — not uploaded</span>
                )}
              </div>
            </DetailSection>

            {/* Status actions */}
            <div className="pt-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Update Status
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(["new", "pending", "approved", "declined"] as AppStatus[]).map((s) => (
                  <button
                    key={s}
                    disabled={saving || app.status === s}
                    onClick={() => void updateStatus(s)}
                    className={`rounded-lg py-2 text-sm font-semibold border transition-opacity disabled:opacity-40 ${
                      app.status === s
                        ? STATUS_CLASSES[s] + " border-transparent"
                        : "border-border bg-background"
                    }`}
                  >
                    {saving && app.status !== s ? "..." : STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Utility Submission Card ─────────────────────────────────────────────
function UtilitySubCard({ sub }: { sub: UtilitySub }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <button
          className="w-full text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight">{sub.accountHolder}</div>
              <div className="text-sm text-muted-foreground">{sub.propertyAddress}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Submitted: {new Date(sub.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="shrink-0">
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </button>

        {expanded && (
          <div className="space-y-3 pt-1 border-t border-border">
            <DetailSection title="Contact">
              <DetailRow label="Email" value={sub.email} />
            </DetailSection>
            <DetailSection title="Accounts">
              <DetailRow
                label="Electric"
                value={`${sub.electricProvider} — Account #${sub.electricAccount}`}
              />
              <DetailRow
                label="Gas"
                value={`${sub.gasProvider} — Account #${sub.gasAccount}`}
              />
              <DetailRow
                label="Water"
                value={`${sub.waterProvider} — Account #${sub.waterAccount}`}
              />
            </DetailSection>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Shared detail helpers ───────────────────────────────────────────────
function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="font-medium break-words min-w-0">{value}</span>
    </div>
  );
}
