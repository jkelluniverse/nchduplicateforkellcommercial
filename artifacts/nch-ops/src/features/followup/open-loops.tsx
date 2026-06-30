import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Plus, Mic, Clock, Check, BellOff, RefreshCw } from "lucide-react";
import {
  listFollowups,
  quickTask,
  snoozeTask,
  completeTask,
  setFollowup,
  followupKeys,
  type FollowupTask,
} from "./api";

// Minimal Web Speech API typing (voice quick-capture; optional/feature-detected).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function OpenLoops() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isJacob = user?.role === "jacob";

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const { data: loops = [] } = useQuery<FollowupTask[]>({
    queryKey: followupKeys.list,
    queryFn: listFollowups,
    enabled: isJacob,
    refetchInterval: 2 * 60 * 1000,
  });

  // iOS Share Sheet → /tasks?text=…&title=… (PWA share_target): prefill the
  // quick-capture box with the shared text.
  useEffect(() => {
    if (!isJacob) return;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("text") || params.get("title");
    if (shared) {
      setTitle(shared.slice(0, 200));
      setAdding(true);
      const url = window.location.pathname;
      window.history.replaceState(null, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: followupKeys.list });
    // Refresh the main tasks board too (best-effort, key may differ).
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const addMutation = useMutation({
    mutationFn: (t: string) => quickTask(t),
    onSuccess: () => {
      setTitle("");
      setAdding(false);
      invalidate();
      toast.success("Captured to your board");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const snoozeMutation = useMutation({ mutationFn: (id: number) => snoozeTask(id), onSuccess: invalidate });
  const doneMutation = useMutation({ mutationFn: (id: number) => completeTask(id), onSuccess: invalidate });
  const stopMutation = useMutation({ mutationFn: (id: number) => setFollowup(id, false), onSuccess: invalidate });

  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      toast.error("Voice input isn't supported on this device");
      return;
    }
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) setTitle((prev) => (prev ? `${prev} ${text}` : text));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  if (!isJacob) return null;

  return (
    <div className="border border-border rounded-xl p-3 mb-4 bg-card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4 text-primary" />
          Open Loops
          {loops.length > 0 && (
            <span className="text-[10px] font-bold text-white bg-primary rounded-full px-1.5 py-0.5">
              {loops.length}
            </span>
          )}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-primary flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Quick Task
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 mb-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) addMutation.mutate(title.trim());
              if (e.key === "Escape") { setAdding(false); setTitle(""); }
            }}
            placeholder="Capture an ask…"
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
          />
          <button
            type="button"
            onClick={toggleVoice}
            title="Dictate"
            className={`p-2 rounded-lg border ${listening ? "bg-red-500 text-white border-red-500 animate-pulse" : "border-border text-muted-foreground"}`}
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => title.trim() && addMutation.mutate(title.trim())}
            disabled={!title.trim() || addMutation.isPending}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "#B23A2E" }}
          >
            {addMutation.isPending ? "…" : "Add"}
          </button>
        </div>
      )}

      {loops.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">No open loops — you're all caught up.</p>
      ) : (
        <div className="divide-y divide-border">
          {loops.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  opened {t.ageDays} day{t.ageDays === 1 ? "" : "s"} ago
                  {t.snoozedUntil ? " · snoozed" : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => doneMutation.mutate(t.id)}
                title="Mark done"
                className="p-1.5 rounded-full text-green-600 hover:bg-green-50"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => snoozeMutation.mutate(t.id)}
                title="Remind tomorrow"
                className="p-1.5 rounded-full text-muted-foreground hover:bg-muted"
              >
                <Clock className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => stopMutation.mutate(t.id)}
                title="Stop following up"
                className="p-1.5 rounded-full text-muted-foreground hover:bg-muted"
              >
                <BellOff className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
