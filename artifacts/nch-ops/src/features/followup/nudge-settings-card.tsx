import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { getNudgeSettings, setNudgeSettings, followupKeys, type NudgeSettings } from "./api";

export function NudgeSettingsCard() {
  const qc = useQueryClient();
  const { data } = useQuery<NudgeSettings>({
    queryKey: followupKeys.settings,
    queryFn: getNudgeSettings,
  });

  const save = useMutation({
    mutationFn: (body: Partial<NudgeSettings>) => setNudgeSettings(body),
    onSuccess: (next) => {
      qc.setQueryData(followupKeys.settings, next);
      toast.success("Nudge settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const time = data?.time ?? "08:00";
  const digest = data?.digest ?? true;

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-primary" /> Daily Follow-up Nudge
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          One push a day for open loops until they're done.
        </p>

        <div className="flex items-center justify-between py-2">
          <label className="text-sm font-medium">Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => save.mutate({ time: e.target.value })}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-background"
          />
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-medium">Group into one digest</p>
            <p className="text-xs text-muted-foreground">
              {digest ? "One grouped push" : "A separate push per task"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => save.mutate({ digest: !digest })}
            className={`relative w-11 h-6 rounded-full transition-colors ${digest ? "bg-primary" : "bg-muted"}`}
            aria-pressed={digest}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${digest ? "translate-x-5" : ""}`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
