import { useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Scale, FileText, Upload, X, Printer, Ban, Trash2, Camera, Image as ImageIcon, Clock, Mail, Search, Check, Pencil, Plus, AlertTriangle, Landmark } from "lucide-react";
import {
  fetchEviction, advanceStage, writeOffBalance, uploadDocument, accountBalance, hardDeleteCase,
  fetchReady, findContract, sendAttorney, readyKey, deleteDocument, updateEviction,
  downloadBase64Pdf, fileToBase64, documentContent, STAGES, evictionKey, evictionsKey,
  fetchPaymentAgreement, createPaymentAgreement, markInstallmentPaid, setAgreementStatus, paymentAgreementKey,
  type TimelineEntry, type CaseDocument, type ReadyStatus, type EvictionCase,
  type Installment,
} from "@/features/evictions/api";
import { stampPhoto, proofTimestamp, readFileAsDataUrl, driveThumb, driveFull } from "@/features/evictions/stamp";

const money = (n: number | null) => (n == null ? "$0.00" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : iso;
};
const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

const NEXT: Record<string, string> = {
  notice_filed: "court_date_set",
  court_date_set: "hearing_complete",
  hearing_complete: "judgment_issued",
  judgment_issued: "vacated",
  vacated: "closed",
};
const stageIndex = (s: string) => Math.max(0, STAGES.findIndex((x) => x.key === s));
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function EvictionCaseScreen() {
  const { id } = useParams();
  const caseId = Number(id);
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery({ queryKey: evictionKey(caseId), queryFn: () => fetchEviction(caseId), enabled: !!caseId });
  const del = useMutation({
    mutationFn: () => hardDeleteCase(caseId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: evictionsKey }); toast.success("Case deleted"); navigate("/evictions"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const deleteDoc = useMutation({ mutationFn: (docId: number) => deleteDocument(caseId, docId), onSuccess: () => { invalidate(); toast.success("Deleted"); }, onError: (e: Error) => toast.error(e.message) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("other");
  const [viewerDoc, setViewerDoc] = useState<CaseDocument | null>(null);

  const invalidate = () => { void qc.invalidateQueries({ queryKey: evictionKey(caseId) }); void qc.invalidateQueries({ queryKey: evictionsKey }); };

  const balanceMut = useMutation({ mutationFn: () => accountBalance(caseId), onSuccess: (r) => { downloadBase64Pdf(r.filename, r.pdfBase64); invalidate(); toast.success("Account balance generated"); }, onError: (e: Error) => toast.error(e.message) });
  const upload = useMutation({
    mutationFn: async () => { const b64 = await fileToBase64(pendingFile!); return uploadDocument(caseId, { documentName: pendingFile!.name, documentType: docType, fileBase64: b64 }); },
    onSuccess: () => { setPendingFile(null); invalidate(); toast.success("Document uploaded"); }, onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  const c = data.case;
  // A parked 'payment_plan' case is not a pipeline stage: no dot is highlighted
  // (curIdx -1 keeps every `i <= curIdx` check false) — a violet chip shows the
  // state instead. NEXT has no entry for it, so no advance button renders.
  const isPaymentPlan = c.status === "payment_plan";
  const curIdx = isPaymentPlan ? -1 : stageIndex(c.status);
  const next = NEXT[c.status];

  return (
    <div className="pb-28">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex items-start gap-2 shadow-md">
        <Link href="/evictions"><ChevronLeft className="w-6 h-6" /></Link>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold flex items-center gap-1 text-primary-foreground/80"><Scale className="w-3.5 h-3.5" /> EVICTION CASE</p>
          <h1 className="text-lg font-bold leading-tight truncate">{c.propertyAddress}</h1>
          <p className="text-sm text-primary-foreground/80">{c.tenantName} · Opened {fmtDate(c.noticeFiledDate ?? c.createdAt)}</p>
        </div>
        {c.writtenOffAt && <span className="text-[10px] font-bold bg-white/20 rounded-full px-2 py-0.5 shrink-0">Written off</span>}
        <button type="button" onClick={() => setEditOpen(true)} className="shrink-0 p-1.5 rounded-full bg-white/15"><Pencil className="w-4 h-4" /></button>
      </div>

      {/* Pipeline */}
      {isPaymentPlan && (
        <div className="px-4 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-100 text-violet-700 px-3 py-1 text-xs font-bold uppercase tracking-wide">
            <Landmark className="w-3.5 h-3.5" /> Payment Plan
          </span>
        </div>
      )}
      <div className="px-4 pt-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <div className="flex flex-col items-center w-16">
                <span className={`w-4 h-4 rounded-full ${i <= curIdx ? "bg-[#B23A2E]" : "bg-muted border border-border"} ${i === curIdx ? "ring-2 ring-[#B23A2E]/40" : ""}`} />
                <span className={`text-[9px] mt-1 text-center ${i === curIdx ? "font-bold text-[#B23A2E]" : "text-muted-foreground"}`}>{s.label}</span>
              </div>
              {i < STAGES.length - 1 && <span className={`w-4 h-0.5 ${i < curIdx ? "bg-[#B23A2E]" : "bg-border"}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* Current stage card */}
      <div className="mx-4 mt-4 rounded-xl border border-border p-3">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Current stage: {c.statusLabel}</p>
        {c.courtDate && c.status === "court_date_set" && (
          <p className="text-sm mt-1">Court: <span className="font-semibold">{fmtDate(c.courtDate)} {c.courtTime}</span>{c.courtLocation ? ` · ${c.courtLocation}` : ""}</p>
        )}
        {c.hearingOutcome && <p className="text-sm mt-1">Outcome: {c.hearingOutcome}</p>}
        {c.judgmentDate && <p className="text-sm mt-1">Judgment: {fmtDate(c.judgmentDate)}{c.judgmentNotes ? ` — ${c.judgmentNotes}` : ""}</p>}
        {c.vacatedDate && <p className="text-sm mt-1">Vacated: {fmtDate(c.vacatedDate)}</p>}
        {next && (
          <button type="button" onClick={() => setAdvanceOpen(true)}
            className="w-full mt-3 rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: "#B23A2E" }}>
            Advance to {STAGES.find((s) => s.key === next)?.label}
          </button>
        )}
      </div>

      {/* Financial summary */}
      <div className="mx-4 mt-4 rounded-xl border border-border p-3">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Account balance at filing</p>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Monthly Rent</span><span>{money(c.monthlyRent)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Balance When Filed</span><span className="font-semibold">{money(c.balanceAtFiling)}</span></div>
        {c.writtenOffAt && <div className="flex justify-between text-sm text-green-700"><span>Written off</span><span className="font-semibold">{money(c.balanceWrittenOff)}</span></div>}
        <div className="flex gap-2 mt-3">
          {!c.writtenOffAt && (
            <button type="button" onClick={() => setWriteOffOpen(true)} className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2.5 text-sm font-semibold border border-red-300 text-red-700 bg-red-50"><Ban className="w-4 h-4" /> Write Off</button>
          )}
          <button type="button" onClick={() => balanceMut.mutate()} disabled={balanceMut.isPending} className="flex-1 flex items-center justify-center gap-1 rounded-lg py-2.5 text-sm font-semibold border border-border bg-background disabled:opacity-50">
            <Printer className="w-4 h-4" /> {balanceMut.isPending ? "…" : "Print Account Balance"}
          </button>
        </div>
      </div>

      {/* Court Payment Agreement */}
      <PaymentAgreementSection
        caseId={caseId}
        caseStatus={c.status}
        documents={data.documents}
        onChanged={invalidate}
        onViewDoc={setViewerDoc}
      />

      {/* Notice Posted — Proof of Service */}
      <NoticePostedSection
        caseId={caseId}
        address={c.propertyAddress}
        posted={data.documents.find((d) => d.documentType === "notice_posted")}
        onChanged={invalidate}
      />

      {/* Documents */}
      <div className="mx-4 mt-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Case documents</p>
        <div className="space-y-2">
          {data.documents.filter((d) => d.documentType !== "notice_posted").length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
          {data.documents.filter((d) => d.documentType !== "notice_posted").map((d: CaseDocument) => {
            const previewable = d.hasContent || !!d.driveFileId || !!d.driveUrl;
            return (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                <DocThumb caseId={caseId} doc={d} />
                <button
                  type="button"
                  onClick={() => previewable && setViewerDoc(d)}
                  disabled={!previewable}
                  className={`flex-1 text-left text-sm truncate ${previewable ? "" : "text-muted-foreground"}`}
                >
                  {d.documentName}
                </button>
                {previewable && (
                  <button type="button" onClick={() => setViewerDoc(d)} className="text-xs text-primary font-semibold shrink-0">Preview</button>
                )}
                <button type="button" onClick={() => { if (confirm("Delete this document?")) deleteDoc.mutate(d.id); }} className="p-1 text-muted-foreground hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </div>
        {pendingFile ? (
          <div className="mt-2 rounded-lg border border-border p-2.5 space-y-2">
            <p className="text-sm truncate">{pendingFile.name}</p>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-full border border-border rounded-lg px-2 py-2 text-sm bg-background">
              {[["notice_3day", "Notice"], ["court_filing", "Court Filing"], ["summons", "Summons"], ["judgment", "Judgment"], ["other", "Other"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPendingFile(null)} className="flex-1 border border-border rounded-lg py-2 text-xs font-semibold">Cancel</button>
              <button type="button" onClick={() => upload.mutate()} disabled={upload.isPending} className="flex-1 rounded-lg py-2 text-xs font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{upload.isPending ? "Uploading…" : "Upload"}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold border border-border bg-background">
            <Upload className="w-4 h-4" /> Upload Document
          </button>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPendingFile(f); e.target.value = ""; }} />
      </div>

      {/* Timeline */}
      <div className="mx-4 mt-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Case timeline</p>
        <div className="space-y-2">
          {data.timeline.map((t: TimelineEntry) => (
            <div key={t.id} className="flex gap-2 text-sm">
              <span className="text-muted-foreground tabular-nums shrink-0 w-12">{fmtDateTime(t.stageDate)}</span>
              <span className="flex-1">{t.notes ?? t.stage}</span>
            </div>
          ))}
        </div>
      </div>

      {/* File for Court Date */}
      <FileForCourtSection caseId={caseId} onChanged={() => { invalidate(); void qc.invalidateQueries({ queryKey: readyKey(caseId) }); }} />

      {/* Delete case */}
      <div className="mx-4 mt-6">
        <button type="button" disabled={del.isPending}
          onClick={() => { if (confirm("Permanently delete this eviction case and its documents/timeline? This cannot be undone.")) del.mutate(); }}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-red-700 border border-red-300 bg-red-50 disabled:opacity-50">
          <Trash2 className="w-4 h-4" /> {del.isPending ? "Deleting…" : "Delete Case"}
        </button>
      </div>

      {editOpen && <EditCaseSheet c={c} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); invalidate(); void qc.invalidateQueries({ queryKey: readyKey(caseId) }); }} />}

      {advanceOpen && next && <AdvanceSheet caseId={caseId} current={c.status} next={next} courtDate={c.courtDate} onClose={() => setAdvanceOpen(false)} onDone={() => { setAdvanceOpen(false); invalidate(); }} />}
      {writeOffOpen && <WriteOffSheet caseId={caseId} amount={c.balanceAtFiling ?? 0} onClose={() => setWriteOffOpen(false)} onDone={() => { setWriteOffOpen(false); invalidate(); }} />}
      {viewerDoc && <DocumentViewer caseId={caseId} doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

/** Full-screen preview of a case document, served by the app (DB-backed). */
function DocumentViewer({ caseId, doc, onClose }: { caseId: number; doc: CaseDocument; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["eviction-doc-content", caseId, doc.id],
    queryFn: () => documentContent(caseId, doc.id),
    staleTime: 5 * 60 * 1000,
  });
  const mime = data?.mimeType ?? doc.mimeType ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  return (
    <div className="fixed inset-0 z-[95] bg-black/95 flex flex-col">
      <div className="flex items-center justify-between p-3 gap-2">
        <span className="text-white text-sm font-semibold truncate">{doc.documentName}</span>
        <div className="flex items-center gap-3 shrink-0">
          {data && (
            <a href={data.fileBase64} download={doc.documentName} className="text-white text-xs font-semibold underline">Download</a>
          )}
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-6 h-6 text-white" /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {isLoading && <p className="text-white text-sm">Loading…</p>}
        {isError && <p className="text-white text-sm px-6 text-center">Couldn’t load this document’s file. It may not have been stored.</p>}
        {data && isImage && <img src={data.fileBase64} alt={doc.documentName} className="max-h-full max-w-full object-contain" />}
        {data && isPdf && <iframe title={doc.documentName} src={data.fileBase64} className="w-full h-full bg-white rounded" />}
        {data && !isImage && !isPdf && (
          <a href={data.fileBase64} download={doc.documentName} className="text-white text-sm underline">Download {doc.documentName}</a>
        )}
      </div>
    </div>
  );
}

/** Small inline thumbnail on a Case-Documents row — a real image preview for
 *  photos (DB-backed, works without Drive), a file icon for PDFs/other. */
function DocThumb({ caseId, doc }: { caseId: number; doc: CaseDocument }) {
  const looksImage = (doc.mimeType ?? "").startsWith("image/");
  const { data } = useQuery({
    queryKey: ["eviction-doc-content", caseId, doc.id],
    queryFn: () => documentContent(caseId, doc.id),
    enabled: looksImage && (doc.hasContent === true || !!doc.driveFileId),
    staleTime: 5 * 60 * 1000,
  });
  if (looksImage && data) {
    return <img src={data.fileBase64} alt="" className="w-10 h-10 rounded object-cover bg-muted shrink-0" />;
  }
  return (
    <span className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
      <FileText className="w-4 h-4 text-muted-foreground" />
    </span>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-background text-foreground rounded-t-2xl max-h-[92vh] overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-base font-bold">{title}</h3><button type="button" onClick={onClose}><X className="w-5 h-5" /></button></div>
        {children}
        <div className="h-6" />
      </div>
    </div>
  );
}

function AdvanceSheet({ caseId, current, next, courtDate, onClose, onDone }: { caseId: number; current: string; next: string; courtDate: string | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ courtLocation: "Canton Municipal Court, Canton OH" });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const mut = useMutation({
    mutationFn: () => advanceStage(caseId, { status: next, ...f }),
    onSuccess: () => { toast.success("Stage advanced"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const label = STAGES.find((s) => s.key === next)?.label ?? next;
  const I = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background";
  return (
    <Sheet title={`Advance to ${label}`} onClose={onClose}>
      {current === "notice_filed" && (<>
        <label className="text-xs font-semibold block">Court date<input type="date" className={I} onChange={(e) => set("courtDate", e.target.value)} /></label>
        <label className="text-xs font-semibold block">Court time<input type="time" className={I} onChange={(e) => set("courtTime", e.target.value)} /></label>
        <label className="text-xs font-semibold block">Court location<input className={I} defaultValue={f.courtLocation} onChange={(e) => set("courtLocation", e.target.value)} /></label>
      </>)}
      {current === "court_date_set" && (<>
        <p className="text-xs text-muted-foreground">Hearing date: {courtDate ? fmtDate(courtDate) : "—"}</p>
        <label className="text-xs font-semibold block">Outcome
          <select className={I} onChange={(e) => set("hearingOutcome", e.target.value)} defaultValue="">
            <option value="" disabled>Select…</option>
            <option>Judgment for Landlord</option><option>Continued</option><option>Dismissed</option><option>Settled</option>
          </select>
        </label>
        <label className="text-xs font-semibold block">Notes<textarea rows={2} className={`${I} resize-none`} onChange={(e) => set("notes", e.target.value)} /></label>
      </>)}
      {current === "hearing_complete" && (<>
        <label className="text-xs font-semibold block">Judgment date<input type="date" className={I} onChange={(e) => set("judgmentDate", e.target.value)} /></label>
        <label className="text-xs font-semibold block">Judgment notes<textarea rows={2} className={`${I} resize-none`} onChange={(e) => set("judgmentNotes", e.target.value)} /></label>
      </>)}
      {current === "judgment_issued" && (<>
        <label className="text-xs font-semibold block">Vacated date<input type="date" className={I} onChange={(e) => set("vacatedDate", e.target.value)} /></label>
        <label className="text-xs font-semibold block">Property condition notes<textarea rows={2} className={`${I} resize-none`} onChange={(e) => set("notes", e.target.value)} /></label>
      </>)}
      {current === "vacated" && (
        <label className="text-xs font-semibold block">Final notes<textarea rows={2} className={`${I} resize-none`} onChange={(e) => set("notes", e.target.value)} /></label>
      )}
      <button type="button" onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{mut.isPending ? "Saving…" : `Advance to ${label}`}</button>
    </Sheet>
  );
}

function NoticePostedSection({ caseId, address, posted, onChanged }: { caseId: number; address: string; posted: CaseDocument | undefined; onChanged: () => void }) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ url: string; at: string; fromLibrary: boolean; isImage: boolean; name: string } | null>(null);
  const [justUploaded, setJustUploaded] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  const pick = async (file: File, fromLibrary: boolean) => {
    try {
      const raw = await readFileAsDataUrl(file);
      const now = new Date();
      const stamp = `${now.getMonth() + 1}-${now.getDate()}-${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      if (file.type.startsWith("image/")) {
        // Photos get the address + timestamp burned in as proof of service.
        const stamped = await stampPhoto(raw, address, proofTimestamp(now));
        setPending({ url: stamped, at: now.toISOString(), fromLibrary, isImage: true, name: `Notice Posted ${stamp}.jpg` });
      } else {
        // Any other file type (PDF, etc.) is attached as-is — timestamp is
        // recorded on the record + timeline rather than burned into the file.
        const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
        setPending({ url: raw, at: now.toISOString(), fromLibrary, isImage: false, name: `Notice Posted ${stamp}${ext}` });
      }
    } catch (e) { toast.error((e as Error).message); }
  };

  const save = useMutation({
    mutationFn: () =>
      uploadDocument(caseId, { documentName: pending!.name, documentType: "notice_posted", fileBase64: pending!.url, postedAt: pending!.at }),
    onSuccess: () => { setJustUploaded(pending!.url); setPending(null); onChanged(); toast.success(`Photo saved ✓ ${proofTimestamp()}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: () => (posted ? deleteDocument(caseId, posted.id) : Promise.resolve({ ok: true as const })),
    onSuccess: () => { setJustUploaded(null); onChanged(); toast.success("Photo removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // The photo itself comes from the app's DB-backed content endpoint, so it
  // shows here reliably even when Google Drive isn't configured. Drive thumbs
  // remain only as a legacy fallback for old records with no stored bytes.
  const contentQ = useQuery({
    queryKey: ["eviction-doc-content", caseId, posted?.id],
    queryFn: () => documentContent(caseId, posted!.id),
    enabled: !!posted && !justUploaded,
    staleTime: 5 * 60 * 1000,
  });
  const dbSrc = contentQ.data?.fileBase64 ?? null;
  const thumbSrc = justUploaded ?? dbSrc ?? (posted?.driveFileId ? driveThumb(posted.driveFileId) : null);
  const fullSrc = justUploaded ?? dbSrc ?? (posted?.driveFileId ? driveFull(posted.driveFileId) : posted?.driveUrl ?? null);
  const postedTs = posted?.postedAt ? proofTimestamp(new Date(posted.postedAt)) : null;

  return (
    <div className="mx-4 mt-4 rounded-xl border border-border p-3">
      <p className="text-[11px] font-bold text-[#B23A2E] flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> NOTICE POSTED — PROOF OF SERVICE</p>
      <p className="text-xs text-muted-foreground mb-2">Photo of the notice posted on the tenant's door.</p>

      {pending ? (
        <div className="space-y-2">
          {pending.isImage ? (
            <img src={pending.url} alt="Proof preview" className="w-full rounded-lg border border-border" />
          ) : (
            <div className="w-full rounded-lg border border-border bg-muted p-4 text-sm font-medium text-muted-foreground flex items-center gap-2"><FileText className="w-4 h-4" /> {pending.name}</div>
          )}
          {pending.fromLibrary && pending.isImage && <p className="text-[11px] text-amber-700">Timestamp reflects upload time, not original photo time.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPending(null)} className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold">Retake</button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="flex-1 rounded-lg py-2 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{save.isPending ? "Saving…" : "Use This Photo"}</button>
          </div>
        </div>
      ) : posted || justUploaded ? (
        <div className="space-y-2">
          {thumbSrc ? (
            <button type="button" onClick={() => fullSrc && setViewer(fullSrc)}>
              <img src={thumbSrc} alt="Proof of service" className="w-[200px] max-w-full rounded-lg border border-border"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            </button>
          ) : (
            <div className="w-[200px] h-28 rounded-lg border border-border bg-muted flex items-center justify-center text-xs text-muted-foreground">
              {contentQ.isLoading ? "Loading photo…" : <span className="flex items-center gap-1.5 px-2 text-center"><FileText className="w-4 h-4 shrink-0" /> {posted?.documentName ?? "Proof on file"}</span>}
            </div>
          )}
          {postedTs && <p className="text-sm flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-muted-foreground" /> Posted: <span className="font-semibold">{postedTs}</span></p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => fullSrc && setViewer(fullSrc)} className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold">View Full Size</button>
            <button type="button" onClick={() => { if (confirm("Replace existing proof of service photo?")) camRef.current?.click(); }} className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold">Retake</button>
            <button type="button" onClick={() => { if (confirm("Remove this proof-of-service photo?")) removeMut.mutate(); }} className="px-3 border border-border rounded-lg py-2 text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => camRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: "#B23A2E" }}><Camera className="w-4 h-4" /> Take Photo Now</button>
          <button type="button" onClick={() => libRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold border border-border"><ImageIcon className="w-4 h-4" /> Upload from Library</button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-2">This photo serves as documentation of notice delivery. Timestamp is recorded at time of capture.</p>

      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f, false); e.target.value = ""; }} />
      <input ref={libRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f, true); e.target.value = ""; }} />

      {viewer && (
        <div className="fixed inset-0 z-[90] bg-black flex flex-col" onClick={() => setViewer(null)}>
          <div className="flex justify-end p-3"><button type="button" onClick={() => setViewer(null)}><X className="w-6 h-6 text-white" /></button></div>
          <img src={viewer} alt="Proof of service" className="flex-1 w-full object-contain" />
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, onChange, type = "text", area = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; area?: boolean }) {
  const cls = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mt-0.5 font-normal";
  return (
    <label className="text-xs font-semibold block">{label}
      {area
        ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={`${cls} resize-none`} />
        : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />}
    </label>
  );
}

function EditCaseSheet({ c, onClose, onDone }: { c: EvictionCase; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    propertyAddress: c.propertyAddress ?? "",
    tenantName: c.tenantName ?? "",
    noticeType: c.noticeType ?? "3_day",
    status: c.status ?? "notice_filed",
    noticeFiledDate: c.noticeFiledDate ?? "",
    balanceAtFiling: c.balanceAtFiling != null ? String(c.balanceAtFiling) : "",
    monthlyRent: c.monthlyRent != null ? String(c.monthlyRent) : "",
    courtDate: c.courtDate ?? "",
    courtTime: c.courtTime ?? "",
    courtLocation: c.courtLocation ?? "",
    hearingOutcome: c.hearingOutcome ?? "",
    judgmentDate: c.judgmentDate ?? "",
    judgmentNotes: c.judgmentNotes ?? "",
    vacatedDate: c.vacatedDate ?? "",
    notes: c.notes ?? "",
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => updateEviction(c.id, {
      propertyAddress: f.propertyAddress, tenantName: f.tenantName, noticeType: f.noticeType, status: f.status,
      noticeFiledDate: f.noticeFiledDate || null, courtDate: f.courtDate || null, judgmentDate: f.judgmentDate || null, vacatedDate: f.vacatedDate || null,
      courtTime: f.courtTime, courtLocation: f.courtLocation, hearingOutcome: f.hearingOutcome, judgmentNotes: f.judgmentNotes, notes: f.notes,
      balanceAtFiling: f.balanceAtFiling === "" ? null : Number(f.balanceAtFiling),
      monthlyRent: f.monthlyRent === "" ? null : Number(f.monthlyRent),
    }),
    onSuccess: () => { toast.success("Case updated"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const I = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mt-0.5 font-normal";
  return (
    <Sheet title="Edit Case" onClose={onClose}>
      <EditField label="Property address" value={f.propertyAddress} onChange={(v) => set("propertyAddress", v)} />
      <EditField label="Tenant name" value={f.tenantName} onChange={(v) => set("tenantName", v)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">Notice type
          <select value={f.noticeType} onChange={(e) => set("noticeType", e.target.value)} className={I}>
            <option value="3_day">3-Day Notice</option><option value="10_day">10-Day Notice</option>
          </select>
        </label>
        <label className="text-xs font-semibold">Stage
          <select value={f.status} onChange={(e) => set("status", e.target.value)} className={I}>
            {["notice_filed", "awaiting_court_date", "court_date_set", "hearing_complete", "judgment_issued", "payment_plan", "vacated", "closed", "dismissed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2"><EditField label="Notice posted date" value={f.noticeFiledDate} onChange={(v) => set("noticeFiledDate", v)} type="date" /><EditField label="Balance at filing ($)" value={f.balanceAtFiling} onChange={(v) => set("balanceAtFiling", v)} type="number" /></div>
      <EditField label="Monthly rent ($)" value={f.monthlyRent} onChange={(v) => set("monthlyRent", v)} type="number" />
      <div className="grid grid-cols-2 gap-2"><EditField label="Court date" value={f.courtDate} onChange={(v) => set("courtDate", v)} type="date" /><EditField label="Court time" value={f.courtTime} onChange={(v) => set("courtTime", v)} /></div>
      <EditField label="Court location" value={f.courtLocation} onChange={(v) => set("courtLocation", v)} />
      <EditField label="Hearing outcome" value={f.hearingOutcome} onChange={(v) => set("hearingOutcome", v)} area />
      <div className="grid grid-cols-2 gap-2"><EditField label="Judgment date" value={f.judgmentDate} onChange={(v) => set("judgmentDate", v)} type="date" /><EditField label="Vacated date" value={f.vacatedDate} onChange={(v) => set("vacatedDate", v)} type="date" /></div>
      <EditField label="Judgment notes" value={f.judgmentNotes} onChange={(v) => set("judgmentNotes", v)} area />
      <EditField label="Notes" value={f.notes} onChange={(v) => set("notes", v)} area />
      <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{save.isPending ? "Saving…" : "Save Changes"}</button>
    </Sheet>
  );
}

function FileForCourtSection({ caseId, onChanged }: { caseId: number; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: r } = useQuery<ReadyStatus>({ queryKey: readyKey(caseId), queryFn: () => fetchReady(caseId) });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const contractRef = useRef<HTMLInputElement>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: readyKey(caseId) }); onChanged(); };

  const find = useMutation({ mutationFn: () => findContract(caseId), onSuccess: (res) => { refresh(); toast(res.found ? `Found: ${res.fileName}` : "No contract found in the Land Contracts folder"); }, onError: (e: Error) => toast.error(e.message) });
  const uploadContract = useMutation({ mutationFn: async (file: File) => { const b64 = await fileToBase64(file); return uploadDocument(caseId, { documentName: file.name, documentType: "land_contract", fileBase64: b64 }); }, onSuccess: () => { refresh(); toast.success("Contract attached"); }, onError: (e: Error) => toast.error(e.message) });
  const send = useMutation({ mutationFn: () => sendAttorney(caseId), onSuccess: () => { setConfirmOpen(false); refresh(); toast.success("Sent to Drew Gonyias ✓"); }, onError: (e: Error) => toast.error(e.message) });

  if (!r) return null;

  const noticeLabel = r.noticeType === "10_day" ? "10-Day Notice" : "3-Day Notice";
  const dayWord = r.isBusinessDays ? "business day" : "day";
  const fill = Math.min(100, Math.round((r.daysPassed / Math.max(1, r.requiredDays)) * 100));
  const Req = ({ ok, label }: { ok: boolean; label: string }) => (
    <p className={`text-sm flex items-center gap-1 ${ok ? "text-green-700" : "text-red-600"}`}>
      {ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />} {label}
    </p>
  );

  return (
    <div className="mx-4 mt-4 rounded-xl border border-border p-3">
      <p className="text-[11px] font-bold text-[#B23A2E] flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> FILE FOR COURT DATE</p>

      {r.attorneySentAt ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm flex items-center gap-1 text-green-700"><Check className="w-4 h-4" /> Sent to {r.attorneyName}</p>
          <p className="text-xs text-muted-foreground">{new Date(r.attorneySentAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
          <button type="button" onClick={() => setConfirmOpen(true)} className="w-full border border-border rounded-lg py-2 text-sm font-semibold">Resend</button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {/* Notice period — days passed since posting (red until complete) */}
          {r.periodComplete ? (
            <p className="text-sm flex items-center gap-1 text-green-700"><Check className="w-4 h-4" /> {noticeLabel} period complete — {r.requiredDays} {dayWord}s passed</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-red-600">{r.daysPassed} of {r.requiredDays} {dayWord}s passed since posting</p>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-red-500" style={{ width: `${fill}%` }} /></div>
              <p className="text-[11px] text-muted-foreground">{noticeLabel}{r.isBusinessDays ? " — business days only" : ""}. You can still send early at your discretion.</p>
            </>
          )}

          {/* Requirements list — always shown */}
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-xs font-semibold text-muted-foreground">Filing requirements:</p>
            <Req ok={r.hasNotice} label="Notice (3-Day or 10-Day)" />
            <Req ok={r.hasBalance} label="Account Balance Statement" />
            <Req ok={r.hasContract} label="Land Contract / Lease Agreement" />
            {!r.hasContract && (
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => find.mutate()} disabled={find.isPending} className="flex-1 flex items-center justify-center gap-1 border border-border rounded-lg py-2 text-xs font-semibold disabled:opacity-50"><Search className="w-3.5 h-3.5" /> {find.isPending ? "Searching…" : "Search Drive"}</button>
                <button type="button" onClick={() => contractRef.current?.click()} className="flex-1 flex items-center justify-center gap-1 border border-border rounded-lg py-2 text-xs font-semibold"><Upload className="w-3.5 h-3.5" /> Upload Contract</button>
              </div>
            )}
          </div>

          <button type="button" onClick={() => setConfirmOpen(true)}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold text-white" style={{ backgroundColor: "#B23A2E" }}>
            <Mail className="w-4 h-4" /> Send to {r.attorneyName}
          </button>
        </div>
      )}

      <input ref={contractRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadContract.mutate(f); e.target.value = ""; }} />

      {confirmOpen && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end" onClick={() => setConfirmOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-background text-foreground rounded-t-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold">Send to {r.attorneyName}?</h3>
            <p className="text-sm text-muted-foreground">{r.attorneyEmail}</p>
            <div className="text-sm space-y-1">
              <p className="font-semibold">Documents to be sent:</p>
              <p>📄 {noticeLabel}</p>
              <p>📊 Account Balance{r.balanceAtFiling != null ? ` — $${Math.round(r.balanceAtFiling).toLocaleString()}` : ""}</p>
              <p>📋 Land Contract</p>
            </div>
            <p className="text-[11px] text-muted-foreground">You'll be CC'd on the email.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 border border-border rounded-lg py-2.5 text-sm font-semibold">Cancel</button>
              <button type="button" onClick={() => send.mutate()} disabled={send.isPending} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{send.isPending ? "Sending…" : "Send Now"}</button>
            </div>
            <div className="h-4" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Court Payment Agreement ─────────────────────────────────────────────────

const PLAN_VIOLET = "#7C3AED";

function InstallmentChip({ inst }: { inst: Installment }) {
  if (inst.status === "paid") {
    return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 text-green-700">Paid{inst.paidDate ? ` ${fmtDate(inst.paidDate)}` : ""}{inst.manuallyMarked ? " ✓" : ""}</span>;
  }
  if (inst.status === "missed") {
    return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">Missed</span>;
  }
  return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Pending</span>;
}

function PaymentAgreementSection({ caseId, caseStatus, documents, onChanged, onViewDoc }: {
  caseId: number; caseStatus: string; documents: CaseDocument[]; onChanged: () => void; onViewDoc: (d: CaseDocument) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: paymentAgreementKey(caseId), queryFn: () => fetchPaymentAgreement(caseId) });
  const [setupOpen, setSetupOpen] = useState(false);
  const [markInst, setMarkInst] = useState<Installment | null>(null);
  const signedRef = useRef<HTMLInputElement>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: paymentAgreementKey(caseId) }); onChanged(); };

  const a = data?.agreement ?? null;
  const installments = data?.installments ?? [];
  const signedDoc = documents.find((d) => d.documentType === "payment_agreement");

  const statusMut = useMutation({
    mutationFn: (body: { status: "active" | "completed" | "defaulted" | "cancelled"; setoutFiled?: boolean; notes?: string }) => setAgreementStatus(a!.id, body),
    onSuccess: (_r, body) => { refresh(); toast.success(body.status === "defaulted" ? "Set-out filing recorded" : `Agreement ${body.status}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const attachSigned = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await fileToBase64(file);
      return uploadDocument(caseId, { documentName: "Court Payment Agreement (signed)", documentType: "payment_agreement", fileBase64: b64 });
    },
    onSuccess: () => { refresh(); toast.success("Signed agreement attached"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;
  const closed = caseStatus === "closed" || caseStatus === "dismissed";

  // ── No agreement yet ──
  if (!a) {
    if (closed) return null;
    const prominent = caseStatus === "hearing_complete" || caseStatus === "judgment_issued";
    return (
      <div className="mx-4 mt-4 rounded-xl border border-border p-3">
        <p className="text-[11px] font-bold flex items-center gap-1" style={{ color: PLAN_VIOLET }}><Landmark className="w-3.5 h-3.5" /> COURT PAYMENT AGREEMENT</p>
        <p className="text-xs text-muted-foreground mt-1 mb-2">Magistrate-approved installment plan signed after the hearing. Missed payments are detected automatically from the Rentec ledger.</p>
        <button type="button" onClick={() => setSetupOpen(true)}
          className={`w-full flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold ${prominent ? "text-white" : "border border-violet-300 text-violet-700 bg-violet-50"}`}
          style={prominent ? { backgroundColor: PLAN_VIOLET } : undefined}>
          <Plus className="w-4 h-4" /> Set Up Payment Agreement
        </button>
        {setupOpen && <SetupAgreementSheet caseId={caseId} signedDoc={signedDoc} onClose={() => setSetupOpen(false)} onDone={() => { setSetupOpen(false); refresh(); }} />}
      </div>
    );
  }

  // ── Agreement exists ──
  const paidInst = installments.filter((i) => i.status === "paid");
  const paidTotal = paidInst.reduce((s, i) => s + (i.paidAmount ?? i.amount), 0);
  const total = installments.reduce((s, i) => s + i.amount, 0);
  const anyMissed = installments.some((i) => i.status === "missed");
  const isActive = a.status === "active";

  return (
    <div className="mx-4 mt-4 rounded-xl border border-border p-3">
      <p className="text-[11px] font-bold flex items-center gap-1" style={{ color: PLAN_VIOLET }}><Landmark className="w-3.5 h-3.5" /> COURT PAYMENT AGREEMENT</p>

      {/* Missed-payment alert — the legal trigger for a set-out */}
      {anyMissed && isActive && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2.5 space-y-2">
          <p className="text-sm font-semibold text-red-700 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Payment missed — per the court agreement you may file for a set-out date.</p>
          <button type="button" disabled={statusMut.isPending}
            onClick={() => { if (confirm("Record that the set-out has been filed? This marks the payment plan as DEFAULTED.")) statusMut.mutate({ status: "defaulted", setoutFiled: true }); }}
            className="w-full rounded-lg py-2 text-sm font-bold text-white bg-red-600 disabled:opacity-50">
            Record Set-Out Filed
          </button>
        </div>
      )}

      {/* Status line */}
      <div className="mt-2 text-sm">
        {a.status === "defaulted" ? (
          <p className="font-bold text-red-600">DEFAULTED{a.setoutFiledAt ? ` — set-out filed ${fmtDateTime(a.setoutFiledAt)}` : " — filing for set-out"}</p>
        ) : a.status === "completed" ? (
          <p className="font-bold text-green-700">COMPLETED — all {installments.length} payments received</p>
        ) : a.status === "cancelled" ? (
          <p className="font-semibold text-muted-foreground">Cancelled</p>
        ) : (
          <p>Active — <span className="font-semibold">{paidInst.length} of {installments.length} paid</span> · {money(paidTotal)} of {money(total)}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">
          Agreed {fmtDate(a.agreementDate)}{a.courtRef ? ` · ${a.courtRef}` : ""}
        </p>
        {a.notes && <p className="text-xs text-muted-foreground mt-0.5">{a.notes}</p>}
      </div>

      {/* Signed document */}
      {signedDoc ? (
        <button type="button" onClick={() => onViewDoc(signedDoc)} className="mt-2 flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 text-violet-700 px-3 py-1 text-xs font-semibold">
          <FileText className="w-3.5 h-3.5" /> Signed agreement — view
        </button>
      ) : (
        <button type="button" onClick={() => signedRef.current?.click()} disabled={attachSigned.isPending} className="mt-2 flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground disabled:opacity-50">
          <Upload className="w-3.5 h-3.5" /> {attachSigned.isPending ? "Attaching…" : "Attach signed agreement"}
        </button>
      )}
      <input ref={signedRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachSigned.mutate(f); e.target.value = ""; }} />

      {/* Installment schedule */}
      <div className="mt-3 space-y-1.5">
        {installments.map((inst, idx) => (
          <div key={inst.id} className={`flex items-center gap-2 rounded-lg border p-2 ${inst.status === "missed" ? "border-red-300 bg-red-50" : "border-border"}`}>
            <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums">{idx + 1}.</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${inst.status === "missed" ? "font-bold text-red-700" : ""}`}>{fmtDate(inst.dueDate)} · <span className="font-semibold">{money(inst.amount)}</span></p>
              {inst.notes && <p className="text-[11px] text-muted-foreground truncate">{inst.notes}</p>}
            </div>
            <InstallmentChip inst={inst} />
            {inst.status !== "paid" && (
              <button type="button" onClick={() => setMarkInst(inst)} className="text-xs font-semibold text-violet-700 border border-violet-300 rounded-lg px-2 py-1 shrink-0">Mark paid</button>
            )}
          </div>
        ))}
      </div>

      {/* Subtle admin actions */}
      <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
        {isActive && (
          <button type="button" disabled={statusMut.isPending} className="underline"
            onClick={() => { if (confirm("Cancel this payment agreement?")) statusMut.mutate({ status: "cancelled" }); }}>
            Cancel agreement
          </button>
        )}
        {(a.status === "cancelled" || a.status === "defaulted") && (
          <button type="button" disabled={statusMut.isPending} className="underline"
            onClick={() => { if (confirm("Reactivate this payment agreement? Auto-tracking resumes.")) statusMut.mutate({ status: "active" }); }}>
            Reactivate agreement
          </button>
        )}
        {a.status === "cancelled" && !closed && (
          <button type="button" className="underline" onClick={() => setSetupOpen(true)}>Set up new agreement</button>
        )}
      </div>

      {setupOpen && <SetupAgreementSheet caseId={caseId} signedDoc={signedDoc} onClose={() => setSetupOpen(false)} onDone={() => { setSetupOpen(false); refresh(); }} />}

      {markInst && <MarkPaidSheet agreementId={a.id} inst={markInst} onClose={() => setMarkInst(null)} onDone={() => { setMarkInst(null); refresh(); }} />}
    </div>
  );
}

function SetupAgreementSheet({ caseId, signedDoc, onClose, onDone }: { caseId: number; signedDoc: CaseDocument | undefined; onClose: () => void; onDone: () => void }) {
  // Plans are typically ~6 months of payments — start with 6 empty rows.
  const [rows, setRows] = useState<{ dueDate: string; amount: string }[]>(Array.from({ length: 6 }, () => ({ dueDate: "", amount: "" })));
  const [agreementDate, setAgreementDate] = useState(todayISO());
  const [courtRef, setCourtRef] = useState("");
  const [notes, setNotes] = useState("");
  const [uploaded, setUploaded] = useState<string | null>(signedDoc ? signedDoc.documentName : null);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadSigned = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await fileToBase64(file);
      return uploadDocument(caseId, { documentName: "Court Payment Agreement (signed)", documentType: "payment_agreement", fileBase64: b64 });
    },
    onSuccess: () => { setUploaded("Court Payment Agreement (signed)"); toast.success("Signed agreement uploaded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = rows
    .map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) }))
    .filter((r) => r.dueDate && Number.isFinite(r.amount) && r.amount > 0);
  const total = valid.reduce((s, r) => s + r.amount, 0);

  const save = useMutation({
    mutationFn: () => createPaymentAgreement(caseId, {
      agreementDate, courtRef: courtRef.trim() || undefined, notes: notes.trim() || undefined,
      installments: valid,
    }),
    onSuccess: () => { toast.success("Payment agreement set up — case moved to Payment Plan"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRow = (i: number, k: "dueDate" | "amount", v: string) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const I = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mt-0.5 font-normal";

  return (
    <Sheet title="Set Up Payment Agreement" onClose={onClose}>
      {/* 1. Signed magistrate agreement */}
      <div>
        <p className="text-xs font-semibold">Signed magistrate agreement</p>
        {uploaded ? (
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm"><FileText className="w-4 h-4 text-violet-700 shrink-0" /> <span className="flex-1 truncate">{uploaded}</span> <Check className="w-4 h-4 text-green-600 shrink-0" /></div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadSigned.isPending} className="mt-1 w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold border border-border bg-background disabled:opacity-50">
            <Upload className="w-4 h-4" /> {uploadSigned.isPending ? "Uploading…" : "Upload Signed Agreement"}
          </button>
        )}
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSigned.mutate(f); e.target.value = ""; }} />
      </div>

      {/* 2. Agreement details */}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">Agreement date<input type="date" value={agreementDate} onChange={(e) => setAgreementDate(e.target.value)} className={I} /></label>
        <label className="text-xs font-semibold">Court ref (optional)<input value={courtRef} onChange={(e) => setCourtRef(e.target.value)} placeholder="Case / magistrate ref" className={I} /></label>
      </div>
      <label className="text-xs font-semibold block">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${I} resize-none`} /></label>

      {/* 3. Installment schedule */}
      <div>
        <p className="text-xs font-semibold mb-1">Payment schedule</p>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="date" value={r.dueDate} onChange={(e) => setRow(i, "dueDate", e.target.value)} className="flex-1 border border-border rounded-lg px-2 py-2 text-sm bg-background" />
              <input type="number" inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, "amount", e.target.value)} placeholder="$" className="w-24 border border-border rounded-lg px-2 py-2 text-sm bg-background" />
              <button type="button" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="p-1 text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((p) => [...p, { dueDate: "", amount: "" }])} className="mt-2 text-xs font-semibold text-violet-700">+ Add payment</button>
        <p className="text-sm mt-1">Total: <span className="font-bold">{money(total)}</span>{valid.length > 0 ? ` over ${valid.length} payments` : ""}</p>
      </div>

      <button type="button" onClick={() => save.mutate()} disabled={save.isPending || valid.length === 0}
        className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: PLAN_VIOLET }}>
        {save.isPending ? "Saving…" : "Save Payment Agreement"}
      </button>
    </Sheet>
  );
}

function MarkPaidSheet({ agreementId, inst, onClose, onDone }: { agreementId: number; inst: Installment; onClose: () => void; onDone: () => void }) {
  const [paidDate, setPaidDate] = useState(todayISO());
  const [amount, setAmount] = useState(String(inst.amount));
  const [notes, setNotes] = useState("");
  const mut = useMutation({
    mutationFn: () => markInstallmentPaid(agreementId, inst.id, { paidDate, amount: amount === "" ? undefined : Number(amount), notes: notes.trim() || undefined }),
    onSuccess: () => { toast.success("Installment marked paid"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const I = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mt-0.5 font-normal";
  return (
    <Sheet title="Mark Installment Paid" onClose={onClose}>
      <p className="text-sm text-muted-foreground">{money(inst.amount)} due {fmtDate(inst.dueDate)} — manual override for cash / off-ledger payments.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold">Paid date<input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={I} /></label>
        <label className="text-xs font-semibold">Amount ($)<input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={I} /></label>
      </div>
      <label className="text-xs font-semibold block">Note<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. paid in cash" className={I} /></label>
      <button type="button" onClick={() => mut.mutate()} disabled={mut.isPending} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: PLAN_VIOLET }}>{mut.isPending ? "Saving…" : "Mark Paid"}</button>
    </Sheet>
  );
}

function WriteOffSheet({ caseId, amount, onClose, onDone }: { caseId: number; amount: number; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState("Self-initiated eviction, tenant unable to pay");
  const mut = useMutation({
    mutationFn: () => writeOffBalance(caseId, { amount, notes }),
    onSuccess: () => { toast.success("Balance written off"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet title="Write Off Balance" onClose={onClose}>
      <p className="text-sm">Write off <span className="font-bold">{money(amount)}</span> as uncollectible?</p>
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 border border-border rounded-lg py-2.5 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={() => mut.mutate()} disabled={mut.isPending} className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{mut.isPending ? "…" : "Confirm Write Off"}</button>
      </div>
    </Sheet>
  );
}
