import { useEffect, useRef, useState } from "react";
import { Plus, Mic, Send, X, Loader2 } from "lucide-react";
import type { ChatMessage } from "./types";

interface ReplyComposerProps {
  reply: ChatMessage;
  onCancel: () => void;
}

export function ReplyComposer({ reply, onCancel }: ReplyComposerProps) {
  const preview =
    reply.content ||
    (reply.messageType === "image"
      ? "📷 Photo"
      : reply.messageType === "voice" || reply.messageType === "audio"
        ? "🎤 Voice message"
        : "📎 Attachment");
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 flex items-center gap-2">
      <div className="w-1 h-8 rounded-full bg-[#8B0000]" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-[#8B0000]">Replying to {reply.author}</div>
        <div className="text-xs text-gray-600 truncate">{preview}</div>
      </div>
      <button onClick={onCancel} className="p-1 text-gray-500 hover:text-gray-800" aria-label="Cancel reply">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---- Voice (speech-to-text) ----

interface SpeechRecognitionLike extends EventTarget {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): { new (): SpeechRecognitionLike } | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAttachClick: () => void;
  /** Called when user wants to send an audio recording */
  onAudioRecorded: (blob: Blob, durationSec: number) => void;
  onTypingChange: (typing: boolean) => void;
  disabled?: boolean;
  pendingFile?: { name: string; size: number } | null;
  onClearPendingFile?: () => void;
}

export function InputBar({
  value,
  onChange,
  onSend,
  onAttachClick,
  onAudioRecorded,
  onTypingChange,
  disabled,
  pendingFile,
  onClearPendingFile,
}: InputBarProps) {
  const [recordingVoice, setRecordingVoice] = useState(false); // speech-to-text
  const [recordingAudio, setRecordingAudio] = useState(false); // MediaRecorder audio
  const [audioElapsed, setAudioElapsed] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const holdTimerRef = useRef<number | null>(null);
  const holdActivated = useRef<boolean>(false);
  const elapsedTimerRef = useRef<number | null>(null);

  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Cleanup all timers, recognition, and active media streams on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (elapsedTimerRef.current) window.clearInterval(elapsedTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* */
        }
        recognitionRef.current = null;
      }
      if (mediaRecRef.current) {
        try {
          mediaRecRef.current.ondataavailable = null;
          mediaRecRef.current.onstop = null;
          if (mediaRecRef.current.state === "recording") mediaRecRef.current.stop();
          mediaRecRef.current.stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* */
        }
        mediaRecRef.current = null;
      }
    };
  }, []);

  // Auto-grow textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [value]);

  const stopVoice = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* */
      }
      recognitionRef.current = null;
    }
    setRecordingVoice(false);
  };

  const startVoice = () => {
    const Cls = getSpeechRecognition();
    if (!Cls) {
      alert("Voice recognition is not supported on this browser.");
      return;
    }
    const rec = new Cls();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let baseline = value;
    rec.onresult = (ev: any) => {
      let finalText = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const transcript = ev.results[i][0].transcript as string;
        if (ev.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      if (finalText) {
        baseline = (baseline ? baseline + " " : "") + finalText.trim();
        onChange(baseline);
      } else if (interim) {
        onChange((baseline ? baseline + " " : "") + interim);
      }
    };
    rec.onerror = () => stopVoice();
    rec.onend = () => setRecordingVoice(false);
    recognitionRef.current = rec;
    setRecordingVoice(true);
    try {
      rec.start();
    } catch {
      stopVoice();
    }
  };

  // Audio recording (hold to record)
  const beginAudioRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const dur = (Date.now() - recordStartRef.current) / 1000;
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size > 0 && dur > 0.3) onAudioRecorded(blob, dur);
        setRecordingAudio(false);
        setAudioElapsed(0);
        if (elapsedTimerRef.current) {
          window.clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = null;
        }
      };
      mediaRecRef.current = mr;
      recordStartRef.current = Date.now();
      mr.start();
      setRecordingAudio(true);
      elapsedTimerRef.current = window.setInterval(() => {
        setAudioElapsed((Date.now() - recordStartRef.current) / 1000);
      }, 250);
    } catch (err) {
      console.error("getUserMedia failed", err);
      alert("Microphone access denied.");
      holdActivated.current = false;
    }
  };

  const endAudioRecord = (cancel = false) => {
    if (mediaRecRef.current && mediaRecRef.current.state === "recording") {
      if (cancel) {
        mediaRecRef.current.ondataavailable = null;
        mediaRecRef.current.onstop = null;
        try {
          mediaRecRef.current.stop();
        } catch {
          /* */
        }
        mediaRecRef.current.stream.getTracks().forEach((t) => t.stop());
        setRecordingAudio(false);
        setAudioElapsed(0);
        if (elapsedTimerRef.current) {
          window.clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = null;
        }
      } else {
        mediaRecRef.current.stop();
      }
    }
    mediaRecRef.current = null;
  };

  // Mic button handlers
  const onMicMouseDown = () => {
    holdActivated.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdActivated.current = true;
      void beginAudioRecord();
    }, 600);
  };
  const onMicMouseUp = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdActivated.current) {
      // long-press release → stop and send
      endAudioRecord(false);
      holdActivated.current = false;
    } else {
      // tap → toggle voice-to-text
      if (recordingVoice) stopVoice();
      else startVoice();
    }
  };
  const onMicMouseLeave = () => {
    if (holdActivated.current) {
      endAudioRecord(true);
      holdActivated.current = false;
    } else if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handleSendKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((value.trim() || pendingFile) && !disabled) onSend();
    }
  };

  const canSend = (!!value.trim() || !!pendingFile) && !disabled;

  if (recordingAudio) {
    return (
      <div className="border-t border-gray-200 bg-white px-3 py-3 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm text-gray-700 tabular-nums">
            Recording {audioElapsed.toFixed(1)}s
          </span>
        </div>
        <button
          onMouseUp={onMicMouseUp}
          onTouchEnd={onMicMouseUp}
          onMouseLeave={onMicMouseLeave}
          onTouchCancel={onMicMouseLeave}
          className="px-4 py-2 rounded-full bg-[#8B0000] text-white text-sm font-medium"
        >
          Release to send
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 bg-white">
      {pendingFile && (
        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-xs">
          <span className="flex-1 truncate text-gray-700">📎 {pendingFile.name}</span>
          <button onClick={onClearPendingFile} className="text-gray-500 hover:text-gray-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-2 py-2">
        <button
          onClick={onAttachClick}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 flex-shrink-0"
          aria-label="Attach"
        >
          <Plus className="w-5 h-5" />
        </button>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onTypingChange(e.target.value.length > 0);
          }}
          onBlur={() => onTypingChange(false)}
          onKeyDown={handleSendKey}
          rows={1}
          placeholder="iMessage"
          className="flex-1 resize-none bg-gray-100 rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#8B0000]/30 max-h-[120px]"
        />
        {value.trim().length === 0 && !pendingFile ? (
          <button
            onMouseDown={onMicMouseDown}
            onMouseUp={onMicMouseUp}
            onMouseLeave={onMicMouseLeave}
            onTouchStart={onMicMouseDown}
            onTouchEnd={onMicMouseUp}
            onTouchCancel={onMicMouseLeave}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              recordingVoice
                ? "bg-red-500 text-white animate-pulse"
                : "text-gray-500 hover:bg-gray-100"
            }`}
            aria-label={recordingVoice ? "Stop voice" : "Voice"}
          >
            <Mic className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSend}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
              canSend ? "bg-[#8B0000] text-white" : "bg-gray-200 text-gray-400"
            }`}
            aria-label="Send"
          >
            {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
