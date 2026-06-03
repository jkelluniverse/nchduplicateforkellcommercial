export type Role = "mike" | "jack" | "jacob";
export type MessageType = "text" | "image" | "file" | "link" | "voice" | "audio";

export interface ChatMessage {
  id: number;
  content: string | null;
  author: string;
  authorRole: Role;
  messageType: MessageType;
  mentions: string[];
  linkedJobId: number | null;
  linkedJobNumber: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  attachmentMime: string | null;
  attachmentMeta: unknown;
  driveSaved: boolean;
  driveUrl: string | null;
  replyToId: number | null;
  replyTo: { id: number; author: string; content: string | null; messageType: string } | null;
  createdAt: string; // ISO from server
  reactions: Array<{ emoji: string; userRoles: Role[] }>;
  readBy: Role[];
  /** Client-only: pending = optimistic send */
  pending?: boolean;
  /** Client-only: failed send */
  failed?: boolean;
}

export interface UploadResult {
  url: string;
  filename: string;
  originalName: string;
  size: number;
  mime: string;
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

export interface PresenceUser {
  role: Role;
  name: string;
  online: boolean;
  lastSeen: string | null;
}

export const ROLE_LABELS: Record<Role, { initials: string; bg: string; name: string }> = {
  mike:  { initials: "MK", bg: "#1e3a8a", name: "Mike" },
  jack:  { initials: "JK", bg: "#8b0000", name: "Jack" },
  jacob: { initials: "JN", bg: "#14532d", name: "Jacob" },
};

export const OWN_BUBBLE_BG = "#8B0000";
export const OTHER_BUBBLE_BG = "#F0F0F0";
