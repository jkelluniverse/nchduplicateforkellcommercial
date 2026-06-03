import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListTasks,
  getListTasksQueryKey,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  listTaskComments,
  createTaskComment,
} from "@workspace/api-client-react";
import type {
  Task,
  CreateTaskBody,
  CreateTaskBodyAssignedTo,
  CreateTaskBodyPriority,
  TaskComment,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { PropertyPicker } from "@/components/property-picker";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronDown, ChevronUp, Check, Trash2, X, MessageCircle } from "lucide-react";
import { toast } from "sonner";

type Role = "jack" | "jacob" | "mike";
type Priority = "urgent" | "normal" | "low";
type Status = "pending" | "in_progress" | "done";

const ROLES: { value: Role; label: string }[] = [
  { value: "jack", label: "Jack" },
  { value: "jacob", label: "Jacob" },
  { value: "mike", label: "Mike" },
];

const ROLE_NAME: Record<Role, string> = { jack: "Jack", jacob: "Jacob", mike: "Mike" };

const PRIORITY_META: Record<Priority, { label: string; dot: string; ring: string }> = {
  urgent: { label: "Urgent", dot: "bg-red-500", ring: "ring-red-500" },
  normal: { label: "Normal", dot: "bg-amber-500", ring: "ring-amber-500" },
  low: { label: "Low", dot: "bg-blue-500", ring: "ring-blue-500" },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtRelTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Tasks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const selfRole = (user?.role ?? "jacob") as Role;
  const [activeRole, setActiveRole] = useState<Role>(selfRole);
  const [showCompleted, setShowCompleted] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);

  const { data: tasks, isLoading } = useListTasks(undefined, {
    query: {
      queryKey: getListTasksQueryKey(),
      refetchOnWindowFocus: true,
    },
  });

  const tasksForRole = useMemo(() => {
    return (tasks ?? []).filter((t) => t.assignedTo === activeRole);
  }, [tasks, activeRole]);

  const todo = tasksForRole.filter((t) => t.status === "pending");
  const inProgress = tasksForRole.filter((t) => t.status === "in_progress");
  const completed = tasksForRole
    .filter((t) => t.status === "done")
    .sort((a, b) => {
      const at = a.completedAt ?? a.createdAt;
      const bt = b.completedAt ?? b.createdAt;
      return bt.localeCompare(at);
    })
    .slice(0, 10);

  const detailTask = detailTaskId
    ? (tasks ?? []).find((t) => t.id === detailTaskId) ?? null
    : null;

  return (
    <div className="pb-24 min-h-[calc(100dvh-5rem)] bg-background">
      {/* Header */}
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex justify-between items-center shadow-md">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <Button
          size="icon"
          variant="secondary"
          className="h-10 w-10 rounded-full"
          onClick={() => setAddOpen(true)}
          aria-label="Add task"
        >
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {/* Three-person tabs */}
      <div className="bg-background border-b border-border px-2 pt-2 sticky top-[68px] z-[5]">
        <div className="grid grid-cols-3 gap-1">
          {ROLES.map((r) => {
            const count = (tasks ?? []).filter(
              (t) => t.assignedTo === r.value && t.status !== "done",
            ).length;
            const active = activeRole === r.value;
            return (
              <button
                key={r.value}
                onClick={() => setActiveRole(r.value)}
                className={`relative py-3 text-sm font-semibold border-b-2 transition-colors ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
                {count > 0 && (
                  <span
                    className={`ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {isLoading ? (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : (
          <>
            {/* To Do section */}
            <section>
              <div className="flex items-center justify-between mb-2 px-1">
                <h2 className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
                  To Do
                </h2>
                <span className="text-xs text-muted-foreground">{todo.length}</span>
              </div>
              {todo.length === 0 ? (
                <EmptyTodo
                  name={ROLE_NAME[activeRole]}
                  hasCompleted={completed.length > 0}
                  hasInProgress={inProgress.length > 0}
                />
              ) : (
                <div className="space-y-2">
                  {todo.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onOpen={() => setDetailTaskId(t.id)}
                      onComplete={async () => {
                        try {
                          await completeTask(t.id);
                          await qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
                        } catch (e: any) {
                          toast.error("Couldn't complete: " + (e?.message ?? "error"));
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* In Progress section — hidden when empty */}
            {inProgress.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="text-xs font-bold tracking-wider uppercase flex items-center gap-1.5" style={{ color: "#1a56db" }}>
                    <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                    In Progress
                  </h2>
                  <span className="text-xs text-muted-foreground">{inProgress.length}</span>
                </div>
                <div className="space-y-2">
                  {inProgress.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      inProgress
                      onOpen={() => setDetailTaskId(t.id)}
                      onComplete={async () => {
                        try {
                          await completeTask(t.id);
                          await qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
                        } catch (e: any) {
                          toast.error("Couldn't complete: " + (e?.message ?? "error"));
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Completed section */}
            <section>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="w-full flex items-center justify-between px-1 py-2 text-xs font-bold text-muted-foreground tracking-wider uppercase hover:text-foreground"
              >
                <span>Completed</span>
                <span className="flex items-center gap-1">
                  <span>{completed.length}</span>
                  {showCompleted ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </span>
              </button>
              {showCompleted && (
                <div className="space-y-2 mt-2">
                  {completed.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No completed tasks yet.
                    </p>
                  ) : (
                    completed.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        completed
                        onOpen={() => setDetailTaskId(t.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <AddTaskSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultAssignee={activeRole}
        onCreated={async () => {
          setAddOpen(false);
          await qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        }}
      />

      <TaskDetailSheet
        task={detailTask}
        selfRole={selfRole}
        onClose={() => setDetailTaskId(null)}
        onChanged={async () => {
          await qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        }}
        onDeleted={async () => {
          setDetailTaskId(null);
          await qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        }}
      />
    </div>
  );
}

// ---------- TaskCard ----------

function TaskCard({
  task,
  onOpen,
  onComplete,
  completed = false,
  inProgress = false,
}: {
  task: Task;
  onOpen: () => void;
  onComplete?: () => void;
  completed?: boolean;
  inProgress?: boolean;
}) {
  const pri = PRIORITY_META[task.priority as Priority];
  const overdue = task.isOverdue;
  return (
    <div
      onClick={onOpen}
      className={`bg-card border border-border rounded-lg p-3 shadow-sm active:bg-muted/50 cursor-pointer transition-all ${
        completed ? "opacity-70" : ""
      } ${inProgress ? "border-l-4 border-l-blue-500" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${pri?.dot ?? "bg-gray-400"}`}
          aria-label={`${pri?.label ?? task.priority} priority`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={`font-semibold text-sm leading-snug ${
                completed ? "line-through text-muted-foreground" : "text-foreground"
              }`}
            >
              {task.title}
            </h3>
            {inProgress && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider bg-blue-100 text-blue-700 shrink-0">
                IN PROGRESS
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
            {task.assignedBy && <span>From: {ROLE_NAME[task.assignedBy as Role]}</span>}
            {task.dueDate && (
              <span className={overdue ? "text-red-600 font-semibold" : ""}>
                Due: {fmtDate(task.dueDate)}
                {overdue && " · overdue"}
              </span>
            )}
            {task.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageCircle className="w-3 h-3" />
                {task.commentCount}
              </span>
            )}
          </div>
          {task.propertyAddress && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {task.propertyAddress}
            </p>
          )}
        </div>
        {!completed && onComplete && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onComplete();
            }}
          >
            <Check className="w-4 h-4 mr-1" />
            Done
          </Button>
        )}
        {completed && <Check className="w-5 h-5 text-green-600 shrink-0" />}
      </div>
    </div>
  );
}

// ---------- Empty states ----------

function EmptyTodo({ name, hasCompleted, hasInProgress }: { name: string; hasCompleted: boolean; hasInProgress: boolean }) {
  if (hasCompleted || hasInProgress) {
    return (
      <div className="text-center py-8">
        <p className="text-2xl mb-1">🎉</p>
        <p className="text-sm font-semibold text-green-600">All caught up!</p>
      </div>
    );
  }
  return (
    <div className="text-center py-10">
      <Check className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">No tasks for {name} right now</p>
    </div>
  );
}

// ---------- Add Task Sheet ----------

function AddTaskSheet({
  open,
  onClose,
  defaultAssignee,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  defaultAssignee: Role;
  onCreated: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState<Role>(defaultAssignee);
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setAssignedTo(defaultAssignee);
      setPriority("normal");
      setDueDate("");
      setPropertyAddress("");
    }
  }, [open, defaultAssignee]);

  const submit = async () => {
    console.log("[TASK SUBMIT] started", {
      title,
      assignedTo,
      priority,
      titleEmpty: !title.trim(),
    });
    if (!title.trim()) {
      console.warn("[TASK SUBMIT] blocked: title is empty");
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const body: CreateTaskBody = {
        title: title.trim(),
        assignedTo: assignedTo as CreateTaskBodyAssignedTo,
        priority: priority as CreateTaskBodyPriority,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
        ...(propertyAddress.trim() ? { propertyAddress: propertyAddress.trim() } : {}),
      };
      console.log("[TASK SUBMIT] calling POST /api/tasks", body);
      const created = await createTask(body);
      console.log("[TASK SUBMIT] success", created);
      onClose();
      toast.success(`Task assigned to ${ROLE_NAME[assignedTo]}`);
      void Promise.resolve(onCreated()).catch((err: unknown) =>
        console.error("task list refresh failed", err),
      );
    } catch (e: unknown) {
      // ApiError from customFetch carries .status, .data, .url for full context
      const apiInfo =
        e && typeof e === "object" && "status" in e
          ? {
              status: (e as { status?: number }).status,
              url: (e as { url?: string }).url,
              data: (e as { data?: unknown }).data,
            }
          : undefined;
      console.error("[TASK SUBMIT] failed", { error: e, apiInfo });
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : (() => {
                try {
                  return JSON.stringify(e);
                } catch {
                  return "unknown error";
                }
              })();
      toast.error("Couldn't create task: " + msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New Task</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Assign To
            </label>
            <Select value={assignedTo} onValueChange={(v) => setAssignedTo(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Title <span className="text-red-500">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Priority
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
                const meta = PRIORITY_META[p];
                const active = priority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                      active
                        ? `border-current ${
                            p === "urgent"
                              ? "text-red-600 bg-red-50"
                              : p === "normal"
                                ? "text-amber-600 bg-amber-50"
                                : "text-blue-600 bg-blue-50"
                          }`
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Due Date
            </label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Property
            </label>
            <PropertyPicker
              value={propertyAddress}
              onChange={setPropertyAddress}
              placeholder="Select property (optional)"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details..."
              rows={3}
            />
          </div>

          <SheetButtonRow>
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                console.log("[TASK SUBMIT] Assign button clicked", {
                  submitting,
                  titleEmpty: !title.trim(),
                });
                void submit();
              }}
              disabled={submitting || !title.trim()}
            >
              {submitting ? "Assigning..." : "Assign Task"}
            </Button>
          </SheetButtonRow>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------- Detail Sheet ----------

function TaskDetailSheet({
  task,
  selfRole,
  onClose,
  onChanged,
  onDeleted,
}: {
  task: Task | null;
  selfRole: Role;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const taskId = task?.id;

  const commentsQ = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: () => listTaskComments(taskId!),
    enabled: !!taskId,
  });

  useEffect(() => {
    if (!task) setNewComment("");
  }, [task]);

  if (!task) {
    return (
      <Sheet open={false} onOpenChange={() => onClose()}>
        <SheetContent side="bottom" />
      </Sheet>
    );
  }

  const pri = PRIORITY_META[task.priority as Priority];
  const status = task.status as Status;

  const setStatus = async (s: Status) => {
    try {
      if (s === "done") {
        await completeTask(task.id);
      } else {
        await updateTask(task.id, { status: s });
      }
      await onChanged();
      if (s === "done") onClose();
    } catch (e: any) {
      toast.error("Update failed: " + (e?.message ?? "error"));
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this task?")) return;
    try {
      await deleteTask(task.id);
      await onDeleted();
    } catch (e: any) {
      toast.error("Delete failed: " + (e?.message ?? "error"));
    }
  };

  const submitComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    setPosting(true);
    try {
      await createTaskComment(task.id, { comment: text });
      setNewComment("");
      await commentsQ.refetch();
      await onChanged();
    } catch (e: any) {
      toast.error("Couldn't post: " + (e?.message ?? "error"));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Sheet open={!!task} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left text-lg pr-8">
            <span className="inline-flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${pri?.dot ?? "bg-gray-400"}`} />
              {task.title}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] uppercase font-bold text-muted-foreground">Assigned to</p>
              <p className="font-medium">{ROLE_NAME[task.assignedTo as Role]}</p>
            </div>
            {task.assignedBy && (
              <div>
                <p className="text-[11px] uppercase font-bold text-muted-foreground">From</p>
                <p className="font-medium">{ROLE_NAME[task.assignedBy as Role]}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] uppercase font-bold text-muted-foreground">Priority</p>
              <p className="font-medium">{pri?.label}</p>
            </div>
            {task.dueDate && (
              <div>
                <p className="text-[11px] uppercase font-bold text-muted-foreground">Due</p>
                <p
                  className={`font-medium ${
                    task.isOverdue ? "text-red-600" : ""
                  }`}
                >
                  {fmtDate(task.dueDate)}
                </p>
              </div>
            )}
          </div>

          {task.propertyAddress && (
            <div>
              <p className="text-[11px] uppercase font-bold text-muted-foreground">Property</p>
              <p className="text-sm">{task.propertyAddress}</p>
            </div>
          )}

          {task.description && (
            <div>
              <p className="text-[11px] uppercase font-bold text-muted-foreground">Description</p>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Comments */}
          <div>
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-2">
              Comments ({commentsQ.data?.length ?? 0})
            </p>
            <div className="space-y-2">
              {commentsQ.isLoading && <Skeleton className="h-12 w-full" />}
              {(commentsQ.data ?? []).map((c: TaskComment) => (
                <div key={c.id} className="bg-muted rounded-lg p-2.5">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-semibold">{c.authorName}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtRelTime(c.createdAt)}</p>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitComment();
                  }
                }}
              />
              <Button onClick={submitComment} disabled={posting || !newComment.trim()}>
                Post
              </Button>
            </div>
          </div>

          {/* Bottom actions */}
          <SheetButtonRow border>
            {status !== "done" && (
              <>
                {status !== "in_progress" ? (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStatus("in_progress")}
                  >
                    Mark In Progress
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStatus("pending")}
                  >
                    Move Back to To Do
                  </Button>
                )}
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => setStatus("done")}
                >
                  <Check className="w-4 h-4 mr-1" /> Mark Done
                </Button>
              </>
            )}
            {status === "done" && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStatus("pending")}
              >
                Reopen
              </Button>
            )}
          </SheetButtonRow>
          {selfRole === "jacob" && (
            <Button
              variant="ghost"
              className="w-full text-red-600 hover:bg-red-50"
              onClick={handleDelete}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Task
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
