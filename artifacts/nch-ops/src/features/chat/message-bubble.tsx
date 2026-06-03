import { useEffect, useRef, useState } from "react";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";
import {
  FileText,
  Image as ImageIcon,
  Play,
  Pause,
  Download,
  Cloud,
  CheckCheck,
  Reply as ReplyIcon,
} from "lucide-react";
import {
  ROLE_LABELS,
  OWN_BUBBLE_BG,
  OTHER_BUBBLE_BG,
  type ChatMessage,
  type LinkPreview,
  type Role,
} from "./types";
import { attachmentAbsoluteUrl, getLinkPreview } from "./api";

export function formatBubbleTime(d: Date): string {
  return format(d, "h:mm a");
}

export function formatDatePill(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  const diff = differenceInDays(new Date(), d);
  if (diff < 7) return format(d, "EEEE");
  return format(d, "MMM d");
}

export function Avatar({ role, size = 28 }: { role: Role; size?: number }) {
  const meta = ROLE_LABELS[role];
  return (
    <div
      className="rounded-full text-white font-bold flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: meta.bg, fontSize: size * 0.4 }}
    >
      {meta.initials}
    </div>
  );
}

interface ReplyQuoteProps {
  reply: NonNullable<ChatMessage["replyTo"]>;
  isOwn: boolean;
}
function ReplyQuote({ reply, isOwn }: ReplyQuoteProps) {
  const text =
    reply.content ||
    (reply.messageType === "image"
      ? "📷 Photo"
      : reply.messageType === "voice" || reply.messageType === "audio"
        ? "🎤 Voice message"
        : "📎 Attachment");
  return (
    <div
      className={`mb-1 pl-2 border-l-2 text-xs opacity-80 ${
        isOwn ? "border-white/70" : "border-gray-400"
      }`}
    >
      <div className="font-semibold truncate">{reply.author}</div>
      <div className="truncate">{text}</div>
    </div>
  );
}

function ReactionsRow({
  reactions,
  selfRole,
  onToggle,
}: {
  reactions: ChatMessage["reactions"];
  selfRole: Role;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {reactions.map((r) => {
        const reactedBySelf = r.userRoles.includes(selfRole);
        return (
          <button
            key={r.emoji}
            onClick={() => onToggle(r.emoji)}
            className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 border ${
              reactedBySelf
                ? "bg-[#8B0000]/10 border-[#8B0000]/30 text-[#8B0000]"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            <span>{r.emoji}</span>
            <span className="font-medium tabular-nums">{r.userRoles.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function ImageBubble({ msg, onView }: { msg: ChatMessage; onView: (url: string) => void }) {
  const url = attachmentAbsoluteUrl(msg.attachmentUrl);
  return (
    <button
      onClick={() => onView(url)}
      className="block max-w-[240px] rounded-2xl overflow-hidden bg-gray-100"
    >
      <img src={url} alt={msg.attachmentName ?? "image"} className="w-full h-auto block" loading="lazy" />
    </button>
  );
}

function FileBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const url = attachmentAbsoluteUrl(msg.attachmentUrl);
  const sizeKb = msg.attachmentSize ? `${(msg.attachmentSize / 1024).toFixed(0)} KB` : "";
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-3 px-3 py-2 rounded-2xl max-w-[260px] ${
        isOwn ? "text-white" : "text-gray-900"
      }`}
      style={{ backgroundColor: isOwn ? OWN_BUBBLE_BG : OTHER_BUBBLE_BG }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
        isOwn ? "bg-white/20" : "bg-white"
      }`}>
        <FileText className={`w-5 h-5 ${isOwn ? "text-white" : "text-[#8B0000]"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{msg.attachmentName ?? "file"}</div>
        <div className={`text-xs ${isOwn ? "text-white/70" : "text-gray-500"}`}>
          {sizeKb}
          {msg.driveSaved ? " • Saved" : ""}
        </div>
      </div>
      <Download className={`w-4 h-4 flex-shrink-0 ${isOwn ? "text-white/80" : "text-gray-500"}`} />
    </a>
  );
}

function VoiceBubble({ msg, isOwn }: { msg: ChatMessage; isOwn: boolean }) {
  const url = attachmentAbsoluteUrl(msg.attachmentUrl);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener("loadedmetadata", () => setDuration(a.duration));
    a.addEventListener("ended", () => setPlaying(false));
    return () => {
      a.pause();
      audioRef.current = null;
    };
  }, [url]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  };

  const fmtDur = (s: number | null) => {
    if (!s) return "";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-2xl ${isOwn ? "text-white" : "text-gray-900"}`}
      style={{ backgroundColor: isOwn ? OWN_BUBBLE_BG : OTHER_BUBBLE_BG, minWidth: 160 }}
    >
      <button
        onClick={toggle}
        className={`w-8 h-8 rounded-full flex items-center justify-center ${
          isOwn ? "bg-white/25" : "bg-white"
        }`}
      >
        {playing ? (
          <Pause className={`w-4 h-4 ${isOwn ? "text-white" : "text-[#8B0000]"}`} />
        ) : (
          <Play className={`w-4 h-4 ${isOwn ? "text-white" : "text-[#8B0000]"}`} />
        )}
      </button>
      {/* Static waveform shimmer (8 bars) */}
      <div className="flex items-center gap-0.5 flex-1">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className={`w-0.5 rounded-full ${isOwn ? "bg-white/70" : "bg-gray-500"}`}
            style={{ height: 4 + ((i * 7) % 16) }}
          />
        ))}
      </div>
      <span className={`text-[11px] tabular-nums ${isOwn ? "text-white/80" : "text-gray-500"}`}>
        {fmtDur(duration)}
      </span>
    </div>
  );
}

function LinkPreviewCard({ url, isOwn }: { url: string; isOwn: boolean }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    getLinkPreview(url)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (error || !preview) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`block underline ${isOwn ? "text-white" : "text-blue-700"} break-all`}
      >
        {url}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`mt-1 block rounded-xl overflow-hidden border ${
        isOwn ? "border-white/30 bg-white/10" : "border-gray-200 bg-white"
      } max-w-[260px]`}
    >
      {preview.image && (
        <img src={preview.image} alt="" className="w-full h-32 object-cover" loading="lazy" />
      )}
      <div className="p-2 text-xs">
        {preview.siteName && (
          <div className={`uppercase tracking-wide ${isOwn ? "text-white/70" : "text-gray-500"}`}>
            {preview.siteName}
          </div>
        )}
        {preview.title && (
          <div className={`font-semibold mt-0.5 line-clamp-2 ${isOwn ? "text-white" : "text-gray-900"}`}>
            {preview.title}
          </div>
        )}
        {preview.description && (
          <div className={`mt-0.5 line-clamp-2 ${isOwn ? "text-white/80" : "text-gray-600"}`}>
            {preview.description}
          </div>
        )}
      </div>
    </a>
  );
}

function highlightText(text: string, q: string): React.ReactNode {
  if (!q || q.length < 2) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let idx = 0;
  while (idx < text.length) {
    const found = lower.indexOf(ql, idx);
    if (found === -1) {
      parts.push(text.slice(idx));
      break;
    }
    if (found > idx) parts.push(text.slice(idx, found));
    parts.push(
      <mark key={found} className="bg-yellow-200 text-inherit rounded px-0.5">
        {text.slice(found, found + q.length)}
      </mark>,
    );
    idx = found + q.length;
  }
  return parts;
}

export interface MessageBubbleProps {
  msg: ChatMessage;
  isOwn: boolean;
  showAuthor: boolean;
  showTime: boolean;
  selfRole: Role;
  searchQuery?: string;
  highlight?: boolean;
  onLongPress: (msg: ChatMessage, target: HTMLElement) => void;
  onReactionToggle: (msg: ChatMessage, emoji: string) => void;
  onImageView: (url: string) => void;
  onJumpToReply?: (msgId: number) => void;
  bubbleRef?: (el: HTMLDivElement | null) => void;
}

export function MessageBubble({
  msg,
  isOwn,
  showAuthor,
  showTime,
  selfRole,
  searchQuery,
  highlight,
  onLongPress,
  onReactionToggle,
  onImageView,
  onJumpToReply,
  bubbleRef,
}: MessageBubbleProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lpTimer = useRef<number | null>(null);
  const lpFired = useRef(false);

  const startLP = () => {
    lpFired.current = false;
    if (lpTimer.current) window.clearTimeout(lpTimer.current);
    lpTimer.current = window.setTimeout(() => {
      lpFired.current = true;
      if (wrapperRef.current) onLongPress(msg, wrapperRef.current);
    }, 450);
  };
  const cancelLP = () => {
    if (lpTimer.current) {
      window.clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (wrapperRef.current) onLongPress(msg, wrapperRef.current);
  };

  const renderInner = () => {
    if (msg.messageType === "image" && msg.attachmentUrl) {
      return <ImageBubble msg={msg} onView={onImageView} />;
    }
    if (msg.messageType === "file" && msg.attachmentUrl) {
      return <FileBubble msg={msg} isOwn={isOwn} />;
    }
    if ((msg.messageType === "voice" || msg.messageType === "audio") && msg.attachmentUrl) {
      return <VoiceBubble msg={msg} isOwn={isOwn} />;
    }
    if (msg.messageType === "link") {
      const url = msg.content ?? "";
      return (
        <div
          className="px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words"
          style={{
            backgroundColor: isOwn ? OWN_BUBBLE_BG : OTHER_BUBBLE_BG,
            color: isOwn ? "white" : "#1f2937",
            maxWidth: "min(80vw, 360px)",
          }}
        >
          {msg.replyTo && <ReplyQuote reply={msg.replyTo} isOwn={isOwn} />}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={`underline break-all ${isOwn ? "text-white" : "text-blue-700"}`}
          >
            {url}
          </a>
          <LinkPreviewCard url={url} isOwn={isOwn} />
        </div>
      );
    }
    // text
    const content = msg.content ?? "";
    return (
      <div
        className="px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words"
        style={{
          backgroundColor: isOwn ? OWN_BUBBLE_BG : OTHER_BUBBLE_BG,
          color: isOwn ? "white" : "#1f2937",
          maxWidth: "min(80vw, 360px)",
        }}
      >
        {msg.replyTo && <ReplyQuote reply={msg.replyTo} isOwn={isOwn} />}
        <span>{searchQuery ? highlightText(content, searchQuery) : content}</span>
      </div>
    );
  };

  const tailRadiusClass = isOwn
    ? "[&>*:last-child]:rounded-br-[6px]"
    : "[&>*:last-child]:rounded-bl-[6px]";

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el;
        bubbleRef?.(el);
      }}
      className={`flex flex-col ${isOwn ? "items-end" : "items-start"} ${
        highlight ? "bg-yellow-50/70 -mx-2 px-2 py-1 rounded-lg transition-colors" : ""
      }`}
    >
      {showAuthor && !isOwn && (
        <span className="text-[11px] text-gray-500 font-medium mb-0.5 ml-1">{msg.author}</span>
      )}
      <div className={`group max-w-[85%] ${tailRadiusClass}`}>
        <div
          onTouchStart={startLP}
          onTouchEnd={cancelLP}
          onTouchMove={cancelLP}
          onTouchCancel={cancelLP}
          onMouseDown={startLP}
          onMouseUp={cancelLP}
          onMouseLeave={cancelLP}
          onContextMenu={onContextMenu}
          className={`relative ${msg.pending ? "opacity-70" : ""} ${msg.failed ? "ring-1 ring-red-500 rounded-2xl" : ""}`}
        >
          {renderInner()}
        </div>
        <ReactionsRow
          reactions={msg.reactions}
          selfRole={selfRole}
          onToggle={(emoji) => onReactionToggle(msg, emoji)}
        />
      </div>
      <div className={`flex items-center gap-1 mt-0.5 px-1 ${isOwn ? "flex-row-reverse" : ""}`}>
        {showTime && (
          <span className="text-[10px] text-gray-400 tabular-nums">
            {formatBubbleTime(new Date(msg.createdAt))}
          </span>
        )}
        {isOwn && msg.readBy.filter((r) => r !== selfRole).length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
            <CheckCheck className="w-3 h-3 text-[#8B0000]" />
          </span>
        )}
        {msg.driveSaved && (
          <span className="flex items-center gap-0.5 text-[10px] text-green-600" title="Saved to Drive">
            <Cloud className="w-3 h-3" />
          </span>
        )}
        {msg.replyToId && onJumpToReply && (
          <button
            onClick={() => onJumpToReply(msg.replyToId!)}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Jump to replied message"
          >
            <ReplyIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function DatePill({ date }: { date: Date }) {
  return (
    <div className="flex justify-center my-3">
      <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
        {formatDatePill(date)}
      </span>
    </div>
  );
}

export function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4"
      role="dialog"
    >
      <button
        className="absolute top-4 right-4 text-white text-2xl"
        onClick={onClose}
        aria-label="Close"
      >
        ✕
      </button>
      <img
        src={url}
        alt=""
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// suppress unused import warnings
void ImageIcon;
