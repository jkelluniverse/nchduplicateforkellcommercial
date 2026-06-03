import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { MessageBubble, DatePill } from "./message-bubble";
import type { ChatMessage, Role } from "./types";

const SAME_GROUP_GAP_MS = 5 * 60 * 1000; // 5 min

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface TypingState {
  role: Role;
  userName: string;
}

interface MessageListProps {
  messages: ChatMessage[];
  selfRole: Role;
  loadingOlder: boolean;
  hasMore: boolean;
  onLoadOlder: () => void;
  onLongPress: (m: ChatMessage, target: HTMLElement) => void;
  onReactionToggle: (m: ChatMessage, emoji: string) => void;
  onImageView: (url: string) => void;
  onVisibleMarkRead: (m: ChatMessage) => void;
  searchQuery?: string;
  highlightId?: number | null;
  bubbleRefs?: React.MutableRefObject<Map<number, HTMLDivElement>>;
  typing: TypingState[];
}

export function MessageList({
  messages,
  selfRole,
  loadingOlder,
  hasMore,
  onLoadOlder,
  onLongPress,
  onReactionToggle,
  onImageView,
  onVisibleMarkRead,
  searchQuery,
  highlightId,
  bubbleRefs,
  typing,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastLengthRef = useRef(messages.length);
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);

  const grouped = useMemo(() => {
    const items: Array<
      | { kind: "date"; date: Date; key: string }
      | { kind: "msg"; msg: ChatMessage; showAuthor: boolean; showTime: boolean; key: string }
    > = [];
    let prev: ChatMessage | null = null;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      const d = new Date(m.createdAt);
      if (!prev || !isSameDay(new Date(prev.createdAt), d)) {
        items.push({ kind: "date", date: d, key: `d-${m.id}` });
      }
      const next = messages[i + 1] ?? null;
      const sameAsPrev =
        prev &&
        prev.authorRole === m.authorRole &&
        new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < SAME_GROUP_GAP_MS &&
        isSameDay(new Date(prev.createdAt), d);
      const sameAsNext =
        next &&
        next.authorRole === m.authorRole &&
        new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < SAME_GROUP_GAP_MS &&
        isSameDay(new Date(next.createdAt), d);
      items.push({
        kind: "msg",
        msg: m,
        showAuthor: !sameAsPrev,
        showTime: !sameAsNext,
        key: `m-${m.id}`,
      });
      prev = m;
    }
    return items;
  }, [messages]);

  // Track scroll position for stick-to-bottom + jump-to-latest pill
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < 80;
      setShowJump(dist > 200);
      if (stickToBottomRef.current) setUnseenCount(0);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // After new messages appended, auto-scroll if user is at bottom; else bump unseen counter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const grew = messages.length > lastLengthRef.current;
    const newCount = messages.length - lastLengthRef.current;
    lastLengthRef.current = messages.length;
    if (!grew) return;
    if (stickToBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    } else {
      // count messages from others as unseen
      const newOnes = messages.slice(messages.length - newCount);
      const fromOthers = newOnes.filter((m) => m.authorRole !== selfRole).length;
      if (fromOthers > 0) setUnseenCount((c) => c + fromOthers);
    }
  }, [messages.length, messages, selfRole]);

  // Initial scroll to bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Mark visible bubbles as read (intersection observer)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !bubbleRefs?.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = Number((entry.target as HTMLElement).dataset.msgId);
          const msg = messages.find((m) => m.id === id);
          if (msg && msg.authorRole !== selfRole && !msg.readBy.includes(selfRole)) {
            onVisibleMarkRead(msg);
          }
        }
      },
      { root: el, threshold: 0.6 },
    );
    bubbleRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [messages, selfRole, onVisibleMarkRead, bubbleRefs]);

  const jumpToBottom = () => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseenCount(0);
  };

  return (
    <div className="flex-1 relative overflow-hidden">
      <div ref={containerRef} className="h-full overflow-y-auto px-3 py-2" data-chat-scroll>
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="text-xs text-gray-500 px-3 py-1 rounded-full bg-gray-100 flex items-center gap-1.5"
            >
              {loadingOlder && <Loader2 className="w-3 h-3 animate-spin" />}
              {loadingOlder ? "Loading..." : "Load older"}
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1">
          {grouped.map((it) =>
            it.kind === "date" ? (
              <DatePill key={it.key} date={it.date} />
            ) : (
              <div
                key={it.key}
                data-msg-id={it.msg.id}
                ref={(el) => {
                  if (!bubbleRefs) return;
                  if (el) bubbleRefs.current.set(it.msg.id, el);
                  else bubbleRefs.current.delete(it.msg.id);
                }}
              >
                <MessageBubble
                  msg={it.msg}
                  isOwn={it.msg.authorRole === selfRole}
                  showAuthor={it.showAuthor}
                  showTime={it.showTime}
                  selfRole={selfRole}
                  searchQuery={searchQuery}
                  highlight={highlightId === it.msg.id}
                  onLongPress={onLongPress}
                  onReactionToggle={onReactionToggle}
                  onImageView={onImageView}
                />
              </div>
            ),
          )}
          {typing.length > 0 && <TypingIndicator typing={typing} />}
        </div>
      </div>
      {(showJump || unseenCount > 0) && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-3 right-3 bg-white border border-gray-200 shadow-md rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 text-gray-700"
        >
          {unseenCount > 0 && (
            <span className="bg-[#8B0000] text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">
              {unseenCount}
            </span>
          )}
          <ArrowDown className="w-4 h-4" /> {unseenCount > 0 ? "New" : ""}
        </button>
      )}
    </div>
  );
}

function TypingIndicator({ typing }: { typing: TypingState[] }) {
  const names = typing.map((t) => t.userName).join(", ");
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="bg-gray-100 rounded-2xl px-3 py-2 flex items-center gap-1">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
      <span className="text-[11px] text-gray-500">{names} typing...</span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce"
      style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
    />
  );
}
