import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicFormShell, FormField, ThankYou } from "./public-apply";

const RED = "#8B0000";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface FormState {
  email: string;
  accountHolder: string;
  propertyAddress: string;
  electricProvider: string;
  electricAccount: string;
  gasProvider: string;
  gasAccount: string;
  waterProvider: string;
  waterAccount: string;
}

export default function PublicUtilities() {
  const [form, setForm] = useState<FormState>({
    email: "",
    accountHolder: "",
    propertyAddress: "",
    electricProvider: "",
    electricAccount: "",
    gasProvider: "",
    gasAccount: "",
    waterProvider: "",
    waterAccount: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validations = useMemo(() => {
    const e: Record<string, string> = {};
    if (form.email && !EMAIL_RE.test(form.email)) e.email = "Invalid email";
    return e;
  }, [form]);

  const isValid =
    EMAIL_RE.test(form.email) &&
    !!form.accountHolder &&
    !!form.propertyAddress &&
    !!form.electricProvider &&
    !!form.electricAccount &&
    !!form.gasProvider &&
    !!form.gasAccount &&
    !!form.waterProvider &&
    !!form.waterAccount;

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((prev) => {
      const n = { ...prev };
      delete n[key as string];
      return n;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const localErrors: Record<string, string> = { ...validations };
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch("/api/public/utility-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? `Request failed (${resp.status})`);
      setDone(true);
    } catch (err: any) {
      setServerError(err?.message ?? "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <ThankYou title="Thank you" body="Thank you. Your utility information has been received." />;
  }

  return (
    <PublicFormShell
      title="Tenant Utility Accounts"
      subtitle="Please provide your utility account numbers within 3 days of taking possession of your property."
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <FormField label="Email Address" required error={errors.email ?? validations.email}>
          <Input
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => setField("email", e.target.value)}
          />
        </FormField>

        <FormField label="Account Holder Full Name" required error={errors.accountHolder}>
          <Input
            value={form.accountHolder}
            onChange={(e) => setField("accountHolder", e.target.value)}
          />
        </FormField>

        <FormField label="Property Address" required error={errors.propertyAddress}>
          <Input
            value={form.propertyAddress}
            onChange={(e) => setField("propertyAddress", e.target.value)}
          />
        </FormField>

        <FormField label="Electric Provider" required error={errors.electricProvider}>
          <Input
            value={form.electricProvider}
            onChange={(e) => setField("electricProvider", e.target.value)}
          />
        </FormField>
        <FormField label="Electric Account Number" required error={errors.electricAccount}>
          <Input
            value={form.electricAccount}
            onChange={(e) => setField("electricAccount", e.target.value)}
          />
        </FormField>

        <FormField label="Gas Provider" required error={errors.gasProvider}>
          <Input
            value={form.gasProvider}
            onChange={(e) => setField("gasProvider", e.target.value)}
          />
        </FormField>
        <FormField label="Gas Account Number" required error={errors.gasAccount}>
          <Input
            value={form.gasAccount}
            onChange={(e) => setField("gasAccount", e.target.value)}
          />
        </FormField>

        <FormField label="Water Provider" required error={errors.waterProvider}>
          <Input
            value={form.waterProvider}
            onChange={(e) => setField("waterProvider", e.target.value)}
          />
        </FormField>
        <FormField label="Water Account Number" required error={errors.waterAccount}>
          <Input
            value={form.waterAccount}
            onChange={(e) => setField("waterAccount", e.target.value)}
          />
        </FormField>

        {serverError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded">
            {serverError}
          </div>
        )}

        <Button
          type="submit"
          disabled={!isValid || submitting}
          className="w-full h-12 text-white font-semibold rounded-lg"
          style={{ background: RED }}
        >
          {submitting ? "Submitting..." : "Submit"}
        </Button>
      </form>
    </PublicFormShell>
  );
}
