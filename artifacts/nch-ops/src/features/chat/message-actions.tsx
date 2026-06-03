import { useState } from "react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  Reply as ReplyIcon,
  Copy,
  Share2,
  Cloud,
  Trash2,
  Camera,
  ImagePlus,
  FileText,
  LinkIcon,
  X,
} from "lucide-react";
import type { ChatMessage, Role } from "./types";

const QUICK_EMOJIS = ["❤️", "👍", "👎", "😂", "😮", "🔥"];

interface MessageActionsProps {
  message: ChatMessage | null;
  selfRole: Role;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onShare: () => void;
  onSaveToDrive: () => void;
  onDelete: () => void;
}

export function MessageActions({
  message,
  selfRole,
  onClose,
  onReact,
  onReply,
  onCopy,
  onShare,
  onSaveToDrive,
  onDelete,
}: MessageActionsProps) {
  if (!message) return null;
  const isOwn = message.authorRole === selfRole;
  const hasAttachment = !!message.attachmentUrl;

  return (
    <Drawer open={!!message} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="px-4 pb-6">
        <DrawerTitle className="sr-only">Message actions</DrawerTitle>
        <div className="flex justify-center gap-2 py-3">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                onReact(e);
                onClose();
              }}
              className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-2xl active:scale-95 transition-transform"
            >
              {e}
            </button>
          ))}
        </div>
        <div className="bg-gray-50 rounded-xl divide-y divide-gray-200 mt-2">
          <button
            onClick={() => {
              onReply();
              onClose();
            }}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm"
          >
            <ReplyIcon className="w-5 h-5 text-gray-500" /> Reply
          </button>
          {(message.messageType === "text" || message.messageType === "link") && message.content && (
            <button
              onClick={() => {
                onCopy();
                onClose();
              }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm"
            >
              <Copy className="w-5 h-5 text-gray-500" /> Copy
            </button>
          )}
          <button
            onClick={() => {
              onShare();
              onClose();
            }}
            className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm"
          >
            <Share2 className="w-5 h-5 text-gray-500" /> Share
          </button>
          {hasAttachment && (
            <button
              onClick={() => {
                onSaveToDrive();
                onClose();
              }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm"
            >
              <Cloud className="w-5 h-5 text-gray-500" />
              {message.driveSaved ? "Saved to Drive ✓" : "Save to Drive"}
            </button>
          )}
          {isOwn && (
            <button
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="w-full px-4 py-3 flex items-center gap-3 text-left text-sm text-red-600"
            >
              <Trash2 className="w-5 h-5" /> Delete message
            </button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

interface AttachmentPickerProps {
  open: boolean;
  onClose: () => void;
  onPickCamera: () => void;
  onPickImage: () => void;
  onPickFile: () => void;
  onPickLink: () => void;
}

export function AttachmentPicker({
  open,
  onClose,
  onPickCamera,
  onPickImage,
  onPickFile,
  onPickLink,
}: AttachmentPickerProps) {
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="px-4 pb-6">
        <DrawerTitle className="sr-only">Attach</DrawerTitle>
        <div className="grid grid-cols-2 gap-3 pt-3">
          <PickerTile icon={Camera} label="Camera" color="#8B0000" onClick={() => { onPickCamera(); onClose(); }} />
          <PickerTile icon={ImagePlus} label="Photo" color="#1e3a8a" onClick={() => { onPickImage(); onClose(); }} />
          <PickerTile icon={FileText} label="File" color="#14532d" onClick={() => { onPickFile(); onClose(); }} />
          <PickerTile icon={LinkIcon} label="Link" color="#92400e" onClick={() => { onPickLink(); onClose(); }} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function PickerTile({
  icon: Icon,
  label,
  color,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-2 text-white font-medium active:scale-[0.98] transition-transform"
      style={{ backgroundColor: color }}
    >
      <Icon className="w-8 h-8" />
      <span className="text-sm">{label}</span>
    </button>
  );
}

interface LinkPromptProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string) => void;
}
export function LinkPrompt({ open, onClose, onSubmit }: LinkPromptProps) {
  const [url, setUrl] = useState("");
  if (!open) return null;
  return (
    <Drawer open={open} onOpenChange={(o) => !o && (setUrl(""), onClose())}>
      <DrawerContent className="px-4 pb-6">
        <DrawerTitle className="sr-only">Share a link</DrawerTitle>
        <div className="py-3">
          <div className="text-sm font-semibold mb-2">Share a link</div>
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            className="w-full bg-gray-100 rounded-xl px-3 py-2 text-sm outline-none"
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => { setUrl(""); onClose(); }}
              className="flex-1 py-2 rounded-xl bg-gray-100 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const trimmed = url.trim();
                if (!trimmed) return;
                const finalUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
                onSubmit(finalUrl);
                setUrl("");
                onClose();
              }}
              className="flex-1 py-2 rounded-xl bg-[#8B0000] text-white text-sm font-medium"
            >
              Send
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// suppress unused warning
void X;
