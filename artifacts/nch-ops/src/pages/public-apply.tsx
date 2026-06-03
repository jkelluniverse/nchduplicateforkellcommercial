import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatPropertyOption } from "@/lib/property-utils";
import nchLogo from "@/assets/nch-logo.png";

const RED = "#8B0000";

function FieldError({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <p className="text-sm text-red-600 mt-1">{msg}</p>;
}

function ReqStar() {
  return <span className="text-red-600 ml-0.5">*</span>;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatMoney(raw: string): string {
  const digits = raw.replace(/[^\d.]/g, "");
  if (!digits) return "";
  const parts = digits.split(".");
  const whole = parts[0].replace(/^0+(?=\d)/, "");
  const cents = parts[1] ? "." + parts[1].slice(0, 2) : "";
  return whole + cents;
}

interface FormState {
  loginEmail: string;
  propertyAddress: string;
  viewedProperty: "" | "yes" | "no";
  moveInDate: string;
  fullLegalName: string;
  phone: string;
  employer: string;
  monthlyIncome: string;
  occupants: string;
  pets: string;
  secondContact: string;
  idFile: File | null;
  proofFile: File | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\d{3}-\d{3}-\d{4}$/;

export default function PublicApply() {
  const [form, setForm] = useState<FormState>({
    loginEmail: "",
    propertyAddress: "",
    viewedProperty: "",
    moveInDate: "",
    fullLegalName: "",
    phone: "",
    employer: "",
    monthlyIncome: "",
    occupants: "",
    pets: "",
    secondContact: "",
    idFile: null,
    proofFile: null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ firstName: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [publicProperties, setPublicProperties] = useState<
    Array<{ id: number; address: string; resident1Name: string | null; resident2Name: string | null }>
  >([]);
  const [propSearch, setPropSearch] = useState("");
  const [propOpen, setPropOpen] = useState(false);

  useEffect(() => {
    fetch("/api/public/properties")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setPublicProperties(rows))
      .catch(() => {});
  }, []);

  const validations = useMemo(() => {
    const e: Record<string, string> = {};
    if (form.loginEmail && !EMAIL_RE.test(form.loginEmail)) e.loginEmail = "Invalid email";
    if (form.phone && !PHONE_RE.test(form.phone)) e.phone = "Use format xxx-xxx-xxxx";
    return e;
  }, [form]);

  const isValid =
    !!form.loginEmail &&
    EMAIL_RE.test(form.loginEmail) &&
    !!form.propertyAddress &&
    !!form.viewedProperty &&
    !!form.moveInDate &&
    !!form.fullLegalName &&
    PHONE_RE.test(form.phone) &&
    !!form.employer &&
    !!form.monthlyIncome &&
    !!form.occupants &&
    !!form.pets &&
    !!form.idFile;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => {
      const n = { ...prev };
      delete n[key as string];
      return n;
    });
  }

  function onSelectFile(key: "idFile" | "proofFile", files: FileList | null) {
    const file = files?.[0] ?? null;
    if (file && file.size > 10 * 1024 * 1024) {
      setErrors((e) => ({ ...e, [key]: "File must be under 10MB" }));
      return;
    }
    if (file && !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      setErrors((e) => ({ ...e, [key]: "JPG, PNG, or PDF only" }));
      return;
    }
    setField(key, file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const localErrors: Record<string, string> = { ...validations };
    if (!form.viewedProperty) localErrors.viewedProperty = "Required";
    if (!form.idFile) localErrors.idFile = "Required";
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v instanceof File) fd.append(k, v);
      else if (v !== null && v !== undefined) fd.append(k, String(v));
    }
    // Backend still expects contactEmail — reuse the single email field.
    fd.append("contactEmail", form.loginEmail);

    setSubmitting(true);
    setProgress(0);
    try {
      const url = "/api/public/tenant-application";
      const result: { ok: boolean; firstName?: string; error?: string } = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) setProgress(Math.round((evt.loaded / evt.total) * 100));
        };
        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
            else reject(new Error(parsed.error ?? `Request failed (${xhr.status})`));
          } catch {
            reject(new Error(`Request failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      });
      if (result.ok) setDone({ firstName: result.firstName ?? form.fullLegalName.split(/\s+/)[0] });
    } catch (err: any) {
      setServerError(err?.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <ThankYou firstName={done.firstName} title="Thank you" body={`Thank you ${done.firstName}. Your application has been received. Nice City Homes will contact you within 1-2 business days.`} />;
  }

  return (
    <PublicFormShell title="Nice City Homes Resident Application">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <FormField label="Email" required error={errors.loginEmail ?? validations.loginEmail}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.loginEmail}
            onChange={(e) => setField("loginEmail", e.target.value)}
          />
        </FormField>

        <FormField label="Address of Property You Are Applying For" required error={errors.propertyAddress}>
          {publicProperties.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPropOpen((v) => !v)}
                className="w-full h-12 px-3 rounded-lg border border-gray-300 bg-white text-left flex items-center justify-between gap-2"
              >
                <span className={`truncate text-sm ${form.propertyAddress ? "text-gray-900" : "text-gray-400"}`}>
                  {form.propertyAddress
                    ? formatPropertyOption(
                        publicProperties.find((p) => p.address === form.propertyAddress) ?? { address: form.propertyAddress, resident1Name: null, resident2Name: null }
                      ).label
                    : "Select a property…"}
                </span>
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>
              </button>
              {propOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 flex flex-col">
                  <div className="p-2 border-b border-gray-200">
                    <input
                      className="w-full h-9 px-3 text-sm border border-gray-300 rounded-md outline-none"
                      placeholder="Search address or name…"
                      value={propSearch}
                      onChange={(e) => setPropSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {publicProperties
                      .filter((p) => {
                        const q = propSearch.toLowerCase();
                        return (
                          !q ||
                          p.address.toLowerCase().includes(q) ||
                          p.resident1Name?.toLowerCase().includes(q) ||
                          p.resident2Name?.toLowerCase().includes(q)
                        );
                      })
                      .map((p) => {
                        const opt = formatPropertyOption(p);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setField("propertyAddress", p.address);
                              setPropOpen(false);
                              setPropSearch("");
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm truncate"
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Input
              value={form.propertyAddress}
              onChange={(e) => setField("propertyAddress", e.target.value)}
              placeholder="Type address…"
            />
          )}
        </FormField>

        <FormField label="Have you viewed the property?" required error={errors.viewedProperty}>
          <div className="flex gap-6 pt-1">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="viewedProperty"
                value="yes"
                checked={form.viewedProperty === "yes"}
                onChange={() => setField("viewedProperty", "yes")}
              />
              Yes
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="viewedProperty"
                value="no"
                checked={form.viewedProperty === "no"}
                onChange={() => setField("viewedProperty", "no")}
              />
              No
            </label>
          </div>
        </FormField>

        <FormField label="Desired Move-In Date" required error={errors.moveInDate}>
          <Input
            type="date"
            value={form.moveInDate}
            onChange={(e) => setField("moveInDate", e.target.value)}
          />
        </FormField>

        <FormField label="Full Legal Name" required error={errors.fullLegalName}>
          <Input
            autoComplete="name"
            value={form.fullLegalName}
            onChange={(e) => setField("fullLegalName", e.target.value)}
          />
        </FormField>

        <FormField label="Phone Number" required error={errors.phone ?? validations.phone}>
          <Input
            type="tel"
            inputMode="tel"
            placeholder="xxx-xxx-xxxx"
            value={form.phone}
            onChange={(e) => setField("phone", formatPhone(e.target.value))}
          />
        </FormField>

        <FormField label="Current Employer" required error={errors.employer}>
          <Input value={form.employer} onChange={(e) => setField("employer", e.target.value)} />
        </FormField>

        <FormField label="Monthly Gross Income" required error={errors.monthlyIncome}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <Input
              className="pl-7"
              inputMode="decimal"
              value={form.monthlyIncome}
              onChange={(e) => setField("monthlyIncome", formatMoney(e.target.value))}
            />
          </div>
        </FormField>

        <FormField label="Number of Occupants (including yourself)" required error={errors.occupants}>
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={form.occupants}
            onChange={(e) => setField("occupants", e.target.value.replace(/[^\d]/g, ""))}
          />
        </FormField>

        <FormField label='Pets — Type and Number (or "None")' required error={errors.pets}>
          <Input value={form.pets} onChange={(e) => setField("pets", e.target.value)} />
        </FormField>

        <FormField label="Second Contact Person (name, phone, email)" error={errors.secondContact}>
          <Textarea
            rows={2}
            value={form.secondContact}
            onChange={(e) => setField("secondContact", e.target.value)}
          />
        </FormField>

        <FormField label="Upload Driver's License / Photo ID" required error={errors.idFile}>
          <FileInput
            accept="image/jpeg,image/png,application/pdf"
            file={form.idFile}
            onChange={(files) => onSelectFile("idFile", files)}
          />
        </FormField>

        <FormField label="Upload Proof of Income or Payment History" error={errors.proofFile}>
          <FileInput
            accept="image/jpeg,image/png,application/pdf"
            file={form.proofFile}
            onChange={(files) => onSelectFile("proofFile", files)}
          />
        </FormField>

        {serverError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
            {serverError}
          </div>
        )}

        {submitting && (
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 transition-all"
              style={{ width: `${progress}%`, background: RED }}
            />
          </div>
        )}

        <Button
          type="submit"
          disabled={!isValid || submitting}
          className="w-full h-12 text-white font-semibold rounded-lg"
          style={{ background: RED }}
        >
          {submitting ? "Submitting..." : "Submit Application"}
        </Button>
      </form>
    </PublicFormShell>
  );
}

export function PublicFormShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-xl mx-auto px-4 pt-6 pb-4 flex flex-col items-center">
          <img src={nchLogo} alt="Nice City Homes" className="h-16 w-auto" />
        </div>
        <div className="w-full text-white px-4 py-4" style={{ background: RED }}>
          <div className="max-w-xl mx-auto">
            <h1 className="text-xl sm:text-2xl font-bold leading-tight">{title}</h1>
            {subtitle && <p className="text-sm mt-1 opacity-90">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm p-5 sm:p-6">{children}</div>
        <p className="text-center text-xs text-gray-400 mt-6">
          Nice City Homes LLC
        </p>
      </main>
    </div>
  );
}

export function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
        {label}
        {required && <ReqStar />}
      </Label>
      {children}
      <FieldError msg={error} />
    </div>
  );
}

function FileInput({
  file,
  onChange,
  accept,
}: {
  file: File | null;
  onChange: (files: FileList | null) => void;
  accept: string;
}) {
  const preview = useMemo(() => {
    if (!file) return null;
    if (file.type.startsWith("image/")) return URL.createObjectURL(file);
    return null;
  }, [file]);
  return (
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files)}
        className="block w-full text-sm text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:text-white"
        style={{ color: "#444" }}
      />
      {file && (
        <div className="mt-3 flex items-center gap-3">
          {preview ? (
            <img src={preview} alt="preview" className="h-16 w-16 object-cover rounded" />
          ) : (
            <div className="h-16 w-16 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-500">
              PDF
            </div>
          )}
          <div className="text-sm">
            <div className="font-medium text-gray-900 break-all">{file.name}</div>
            <div className="text-gray-500">{(file.size / 1024).toFixed(0)} KB</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThankYou({ firstName, title, body }: { firstName?: string; title: string; body: string }) {
  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col items-center justify-center px-4">
      <img src={nchLogo} alt="Nice City Homes" className="h-24 w-auto mb-6" />
      <div className="bg-white rounded-xl shadow-sm p-8 max-w-md w-full text-center">
        <h1 className="text-2xl font-bold" style={{ color: RED }}>
          {title}
        </h1>
        <p className="mt-4 text-gray-700 leading-relaxed">{body}</p>
        {firstName ? null : null}
      </div>
    </div>
  );
}
