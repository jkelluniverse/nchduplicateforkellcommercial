import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetUnreadMessageCountQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import {
  listMessages,
  sendMessage as apiSendMessage,
  uploadAttachment,
  deleteMessage as apiDeleteMessage,
  reactToMessage as apiReact,
  saveAttachmentToDrive as apiSaveDrive,
  searchMessages as apiSearch,
  markRead,
  markAllRead,
  attachmentAbsoluteUrl,
} from "@/features/chat/api";
import { useChatSocket, ChatSocketProvider } from "@/features/chat/socket";
import { ChatHeader, SearchBar } from "@/features/chat/header";
import { ImageViewer } from "@/features/chat/message-bubble";
import { MessageList } from "@/features/chat/message-list";
import { InputBar, ReplyComposer } from "@/features/chat/input-bar";
import {
  MessageActions,
  AttachmentPicker,
  LinkPrompt,
} from "@/features/chat/message-actions";
import type { ChatMessage, Role } from "@/features/chat/types";

const URL_RE = /^https?:\/\/\S+$/i;

function MessagesInner() {
  const { user } = useAuth();
  const selfRole = user!.role as Role;
  const queryClient = useQueryClient();
  const { socket, presence, typing, emitTyping, refreshPresence } = useChatSocket();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    type: ChatMessage["messageType"];
  } | null>(null);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [activeMsg, setActiveMsg] = useState<ChatMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [imageView, setImageView] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<number[]>([]);
  const [activeHitIdx, setActiveHitIdx] = useState(0);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bubbleRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const invalidateUnread = () =>
    queryClient.invalidateQueries({ queryKey: getGetUnreadMessageCountQueryKey() });

  // Initial load
  useEffect(() => {
    let alive = true;
    listMessages()
      .then((res) => {
        if (!alive) return;
        setMessages(res.items);
        setHasMore(res.hasMore);
      })
      .catch((err) => toast.error("Couldn't load messages: " + err.message));
    return () => {
      alive = false;
    };
  }, []);

  // Mark all unread on open
  useEffect(() => {
    void markAllRead().then(() => invalidateUnread());
    return () => {
      void markAllRead().then(() => invalidateUnread());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push notification setup is handled globally in AuthProvider.

  // Refresh presence when window/tab becomes visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshPresence();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshPresence]);

  // Socket listeners — new messages, deletions, reactions, drive saves, read receipts
  useEffect(() => {
    if (!socket) return;
    const onNew = (m: ChatMessage) => {
      setMessages((prev) => {
        // dedupe by id
        if (prev.some((p) => p.id === m.id)) return prev;
        // if it's our own and we have a pending optimistic with same content+type, replace it
        if (m.authorRole === selfRole) {
          const idx = prev.findIndex(
            (p) =>
              p.pending &&
              p.authorRole === selfRole &&
              p.messageType === m.messageType &&
              (p.content ?? "") === (m.content ?? "") &&
              p.attachmentName === m.attachmentName,
          );
          if (idx !== -1) {
            const next = prev.slice();
            next[idx] = m;
            return next;
          }
        }
        return [...prev, m];
      });
      if (m.authorRole !== selfRole) {
        // bump unread badge briefly; we'll mark as read on visibility
        void invalidateUnread();
      }
    };
    const onDeleted = (p: { messageId: number }) => {
      setMessages((prev) => prev.filter((m) => m.id !== p.messageId));
    };
    const onReaction = (p: { messageId: number; emoji: string; role: Role; action: "added" | "removed" }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== p.messageId) return m;
          const reactions = m.reactions.map((r) => ({ ...r, userRoles: [...r.userRoles] }));
          let entry = reactions.find((r) => r.emoji === p.emoji);
          if (p.action === "added") {
            if (!entry) {
              entry = { emoji: p.emoji, userRoles: [] };
              reactions.push(entry);
            }
            if (!entry.userRoles.includes(p.role)) entry.userRoles.push(p.role);
          } else if (entry) {
            entry.userRoles = entry.userRoles.filter((r) => r !== p.role);
            if (entry.userRoles.length === 0) {
              const i = reactions.indexOf(entry);
              reactions.splice(i, 1);
            }
          }
          return { ...m, reactions };
        }),
      );
    };
    const onDrive = (p: { messageId: number; driveUrl: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === p.messageId ? { ...m, driveSaved: true, driveUrl: p.driveUrl } : m)),
      );
    };
    const onRead = (p: { messageId: number; role: Role }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === p.messageId && !m.readBy.includes(p.role)
            ? { ...m, readBy: [...m.readBy, p.role] }
            : m,
        ),
      );
    };
    socket.on("new_message", onNew);
    socket.on("message_deleted", onDeleted);
    socket.on("message_reaction", onReaction);
    socket.on("drive_saved", onDrive);
    socket.on("message_read", onRead);
    return () => {
      socket.off("new_message", onNew);
      socket.off("message_deleted", onDeleted);
      socket.off("message_reaction", onReaction);
      socket.off("drive_saved", onDrive);
      socket.off("message_read", onRead);
    };
  }, [socket, selfRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------- send --------

  const detectMessageType = (txt: string): ChatMessage["messageType"] => {
    const trimmed = txt.trim();
    if (URL_RE.test(trimmed) && trimmed.split(/\s+/).length === 1) return "link";
    return "text";
  };

  const handleSend = async () => {
    if (sending) return;
    const trimmed = text.trim();

    // Attachment send
    if (pendingFile) {
      const tempId = -Date.now();
      const optimistic: ChatMessage = {
        id: tempId,
        content: trimmed || null,
        author: user!.name,
        authorRole: selfRole,
        messageType: pendingFile.type,
        mentions: [],
        linkedJobId: null,
        linkedJobNumber: null,
        attachmentUrl: null,
        attachmentName: pendingFile.file.name,
        attachmentSize: pendingFile.file.size,
        attachmentMime: pendingFile.file.type,
        attachmentMeta: null,
        driveSaved: false,
        driveUrl: null,
        replyToId: reply?.id ?? null,
        replyTo: reply
          ? { id: reply.id, author: reply.author, content: reply.content, messageType: reply.messageType }
          : null,
        createdAt: new Date().toISOString(),
        reactions: [],
        readBy: [selfRole],
        pending: true,
      };
      setMessages((p) => [...p, optimistic]);
      const file = pendingFile.file;
      const type = pendingFile.type;
      const replyId = reply?.id;
      setText("");
      setPendingFile(null);
      setReply(null);
      setSending(true);
      try {
        const upload = await uploadAttachment(file);
        await apiSendMessage({
          content: trimmed || null,
          messageType: type,
          attachmentUrl: upload.url,
          attachmentName: upload.originalName,
          attachmentSize: upload.size,
          attachmentMime: upload.mime,
          replyToId: replyId,
        });
        // Server emits new_message which will replace the optimistic entry
      } catch (err: any) {
        toast.error("Send failed: " + err.message);
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
        );
      } finally {
        setSending(false);
      }
      return;
    }

    if (!trimmed) return;
    const type = detectMessageType(trimmed);
    const tempId = -Date.now();
    const optimistic: ChatMessage = {
      id: tempId,
      content: trimmed,
      author: user!.name,
      authorRole: selfRole,
      messageType: type,
      mentions: [],
      linkedJobId: null,
      linkedJobNumber: null,
      attachmentUrl: null,
      attachmentName: null,
      attachmentSize: null,
      attachmentMime: null,
      attachmentMeta: null,
      driveSaved: false,
      driveUrl: null,
      replyToId: reply?.id ?? null,
      replyTo: reply
        ? { id: reply.id, author: reply.author, content: reply.content, messageType: reply.messageType }
        : null,
      createdAt: new Date().toISOString(),
      reactions: [],
      readBy: [selfRole],
      pending: true,
    };
    setMessages((p) => [...p, optimistic]);
    const replyId = reply?.id;
    setText("");
    setReply(null);
    setSending(true);
    try {
      await apiSendMessage({ content: trimmed, messageType: type, replyToId: replyId });
    } catch (err: any) {
      toast.error("Send failed: " + err.message);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
      );
    } finally {
      setSending(false);
    }
  };

  // -------- audio recording --------

  const handleAudioRecorded = async (blob: Blob, _durationSec: number) => {
    const tempId = -Date.now();
    const filename = `voice-${Date.now()}.webm`;
    const optimistic: ChatMessage = {
      id: tempId,
      content: null,
      author: user!.name,
      authorRole: selfRole,
      messageType: "voice",
      mentions: [],
      linkedJobId: null,
      linkedJobNumber: null,
      attachmentUrl: null,
      attachmentName: filename,
      attachmentSize: blob.size,
      attachmentMime: blob.type || "audio/webm",
      attachmentMeta: null,
      driveSaved: false,
      driveUrl: null,
      replyToId: null,
      replyTo: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      readBy: [selfRole],
      pending: true,
    };
    setMessages((p) => [...p, optimistic]);
    setSending(true);
    try {
      const upload = await uploadAttachment(blob, filename);
      await apiSendMessage({
        messageType: "voice",
        attachmentUrl: upload.url,
        attachmentName: filename,
        attachmentSize: upload.size,
        attachmentMime: upload.mime,
      });
    } catch (err: any) {
      toast.error("Send failed: " + err.message);
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)),
      );
    } finally {
      setSending(false);
    }
  };

  // -------- attachments --------

  const onPickCamera = () => cameraInputRef.current?.click();
  const onPickImage = () => imageInputRef.current?.click();
  const onPickFile = () => fileInputRef.current?.click();
  const onPickLink = () => setLinkPromptOpen(true);

  const onFileChosen = (file: File | undefined, kind: "image" | "file") => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File too large (max 50MB)");
      return;
    }
    setPendingFile({ file, type: kind });
  };

  const onLinkSubmit = async (url: string) => {
    setSending(true);
    try {
      await apiSendMessage({ content: url, messageType: "link" });
    } catch (err: any) {
      toast.error("Send failed: " + err.message);
    } finally {
      setSending(false);
    }
  };

  // -------- reactions / actions --------

  const onReactionToggle = async (msg: ChatMessage, emoji: string) => {
    // optimistic
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msg.id) return m;
        const reactions = m.reactions.map((r) => ({ ...r, userRoles: [...r.userRoles] }));
        let entry = reactions.find((r) => r.emoji === emoji);
        const has = entry?.userRoles.includes(selfRole);
        if (has) {
          entry!.userRoles = entry!.userRoles.filter((r) => r !== selfRole);
          if (entry!.userRoles.length === 0) reactions.splice(reactions.indexOf(entry!), 1);
        } else {
          if (!entry) {
            entry = { emoji, userRoles: [] };
            reactions.push(entry);
          }
          entry.userRoles.push(selfRole);
        }
        return { ...m, reactions };
      }),
    );
    try {
      await apiReact(msg.id, emoji);
    } catch (err: any) {
      toast.error("React failed: " + err.message);
    }
  };

  const onCopy = async () => {
    if (!activeMsg?.content) return;
    try {
      await navigator.clipboard.writeText(activeMsg.content);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const onShare = async () => {
    if (!activeMsg) return;
    const shareData: ShareData = {
      text: activeMsg.content ?? "",
      url: activeMsg.attachmentUrl ? attachmentAbsoluteUrl(activeMsg.attachmentUrl) : undefined,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* user cancelled */
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareData.text || shareData.url || "");
        toast.success("Copied to clipboard");
      } catch {
        /* */
      }
    }
  };

  const onSaveToDrive = async () => {
    if (!activeMsg) return;
    try {
      toast.info("Saving to Drive...");
      const res = await apiSaveDrive(activeMsg.id);
      toast.success("Saved to Drive");
      setMessages((prev) =>
        prev.map((m) =>
          m.id === activeMsg.id ? { ...m, driveSaved: true, driveUrl: res.driveUrl } : m,
        ),
      );
    } catch (err: any) {
      toast.error("Save failed: " + err.message);
    }
  };

  const onDelete = async () => {
    if (!activeMsg) return;
    setMessages((prev) => prev.filter((m) => m.id !== activeMsg.id));
    try {
      await apiDeleteMessage(activeMsg.id);
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  };

  // -------- mark read on visible --------

  const onVisibleMarkRead = (msg: ChatMessage) => {
    if (msg.id < 0) return;
    void markRead(msg.id).then(() => invalidateUnread());
    // optimistic local update
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id && !m.readBy.includes(selfRole)
          ? { ...m, readBy: [...m.readBy, selfRole] }
          : m,
      ),
    );
  };

  // -------- pagination --------

  const onLoadOlder = async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0]!.id;
      const res = await listMessages(oldest);
      setMessages((prev) => [...res.items, ...prev]);
      setHasMore(res.hasMore);
    } catch (err: any) {
      toast.error("Load failed: " + err.message);
    } finally {
      setLoadingOlder(false);
    }
  };

  // -------- search --------

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSearchHits([]);
      setHighlightId(null);
      return;
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchHits([]);
      setHighlightId(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiSearch(searchQuery);
        const ids = res.items.map((m) => m.id);
        setSearchHits(ids);
        setActiveHitIdx(0);
        if (ids.length > 0) jumpToMessage(ids[0]!);
      } catch {
        setSearchHits([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToMessage = (id: number) => {
    setHighlightId(id);
    const node = bubbleRefs.current.get(id);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.setTimeout(() => setHighlightId(null), 1800);
  };

  const cycleHit = (dir: 1 | -1) => {
    if (searchHits.length === 0) return;
    const next = (activeHitIdx + dir + searchHits.length) % searchHits.length;
    setActiveHitIdx(next);
    jumpToMessage(searchHits[next]!);
  };

  const presenceForHeader = useMemo(() => presence, [presence]);

  return (
    <div
      className="flex flex-col bg-white overflow-hidden"
      style={{ height: "calc(100dvh - 4rem - env(safe-area-inset-bottom, 0px))" }}
    >
      <ChatHeader
        presence={presenceForHeader}
        selfRole={selfRole}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((v) => !v)}
      />
      {searchOpen && (
        <SearchBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          matches={searchHits}
          activeIdx={activeHitIdx}
          onPrev={() => cycleHit(-1)}
          onNext={() => cycleHit(1)}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <MessageList
        messages={messages}
        selfRole={selfRole}
        loadingOlder={loadingOlder}
        hasMore={hasMore}
        onLoadOlder={onLoadOlder}
        onLongPress={(m) => setActiveMsg(m)}
        onReactionToggle={onReactionToggle}
        onImageView={setImageView}
        onVisibleMarkRead={onVisibleMarkRead}
        searchQuery={searchOpen ? searchQuery : ""}
        highlightId={highlightId}
        bubbleRefs={bubbleRefs}
        typing={typing.filter((t) => t.role !== selfRole)}
      />
      {reply && <ReplyComposer reply={reply} onCancel={() => setReply(null)} />}
      <InputBar
        value={text}
        onChange={setText}
        onSend={handleSend}
        onAttachClick={() => setAttachOpen(true)}
        onAudioRecorded={handleAudioRecorded}
        onTypingChange={emitTyping}
        disabled={sending}
        pendingFile={pendingFile ? { name: pendingFile.file.name, size: pendingFile.file.size } : null}
        onClearPendingFile={() => setPendingFile(null)}
      />

      <AttachmentPicker
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onPickCamera={onPickCamera}
        onPickImage={onPickImage}
        onPickFile={onPickFile}
        onPickLink={onPickLink}
      />
      <LinkPrompt open={linkPromptOpen} onClose={() => setLinkPromptOpen(false)} onSubmit={onLinkSubmit} />
      <MessageActions
        message={activeMsg}
        selfRole={selfRole}
        onClose={() => setActiveMsg(null)}
        onReact={(emoji) => activeMsg && onReactionToggle(activeMsg, emoji)}
        onReply={() => activeMsg && setReply(activeMsg)}
        onCopy={onCopy}
        onShare={onShare}
        onSaveToDrive={onSaveToDrive}
        onDelete={onDelete}
      />
      <ImageViewer url={imageView} onClose={() => setImageView(null)} />

      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0], "image")}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0], "image")}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => onFileChosen(e.target.files?.[0], "file")}
      />
    </div>
  );
}

export default function Messages() {
  return (
    <ChatSocketProvider>
      <MessagesInner />
    </ChatSocketProvider>
  );
}
