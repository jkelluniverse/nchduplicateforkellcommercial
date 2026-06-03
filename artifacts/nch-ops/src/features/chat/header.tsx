import { useState } from "react";
import { ChevronLeft, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { ROLE_LABELS, type PresenceUser, type Role } from "./types";
import { formatDistanceToNowStrict } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  return (
    <div className="flex -space-x-2">
      {users.map((u) => {
        const meta = ROLE_LABELS[u.role];
        return (
          <Popover key={u.role}>
            <PopoverTrigger asChild>
              <button
                className="relative w-8 h-8 rounded-full ring-2 ring-white text-white text-xs font-bold flex items-center justify-center"
                style={{ backgroundColor: meta.bg }}
                aria-label={u.name}
              >
                {meta.initials}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                    u.online ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 text-sm" sideOffset={8}>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {u.online
                  ? "Online now"
                  : u.lastSeen
                    ? `Last seen ${formatDistanceToNowStrict(new Date(u.lastSeen), { addSuffix: true })}`
                    : "Never seen"}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matches: number[];
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchBar({ query, onQueryChange, matches, activeIdx, onPrev, onNext, onClose }: SearchBarProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2">
      <Search className="w-4 h-4 text-gray-400" />
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search messages..."
        className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
      />
      {matches.length > 0 && (
        <>
          <span className="text-xs text-gray-500 tabular-nums">
            {activeIdx + 1}/{matches.length}
          </span>
          <button onClick={onPrev} className="p-1 text-gray-600 hover:text-gray-900" aria-label="Previous match">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button onClick={onNext} className="p-1 text-gray-600 hover:text-gray-900" aria-label="Next match">
            <ChevronDown className="w-4 h-4" />
          </button>
        </>
      )}
      {query.length > 1 && matches.length === 0 && (
        <span className="text-xs text-gray-400">No results</span>
      )}
      <button onClick={onClose} className="p-1 text-gray-600 hover:text-gray-900" aria-label="Close search">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface ChatHeaderProps {
  presence: PresenceUser[];
  selfRole: Role;
  searchOpen: boolean;
  onToggleSearch: () => void;
}

export function ChatHeader({ presence, selfRole, searchOpen, onToggleSearch }: ChatHeaderProps) {
  // Show others first, then self last
  const others = presence.filter((p) => p.role !== selfRole);
  const onlineCount = presence.filter((p) => p.online && p.role !== selfRole).length;

  return (
    <div className="bg-white border-b border-gray-200 flex items-center justify-between px-3 py-2 z-10">
      <Link href="/" className="p-1 -ml-1 text-gray-700 hover:text-gray-900" aria-label="Back">
        <ChevronLeft className="w-6 h-6" />
      </Link>
      <div className="flex-1 flex flex-col items-center -ml-6">
        <div className="font-semibold text-base">NCH Team</div>
        <div className="text-[11px] text-gray-500">
          {onlineCount > 0 ? `${onlineCount} online` : "All offline"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <PresenceAvatars users={others} />
        <button
          onClick={onToggleSearch}
          className={`p-1 ${searchOpen ? "text-[#8B0000]" : "text-gray-700"} hover:text-gray-900`}
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
