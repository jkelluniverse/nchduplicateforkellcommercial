import { parse } from "node-html-parser";
import dns from "node:dns/promises";
import net from "node:net";
import { logger } from "./logger";

// SSRF guards: block private/loopback/link-local/multicast and IPv6 equivalents.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIPv4(lower.slice(7));
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname) === 4) {
    if (isPrivateIPv4(hostname)) throw new Error("Private/internal address blocked");
    return;
  }
  if (net.isIP(hostname) === 6) {
    if (isPrivateIPv6(hostname)) throw new Error("Private/internal address blocked");
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Private/internal hostname blocked");
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("DNS resolution failed");
  }
  for (const a of addrs) {
    if (a.family === 4 && isPrivateIPv4(a.address)) throw new Error("Private/internal address blocked");
    if (a.family === 6 && isPrivateIPv6(a.address)) throw new Error("Private/internal address blocked");
  }
}

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

const cache = new Map<string, { ts: number; data: LinkPreview }>();
const TTL = 60 * 60 * 1000;

function abs(base: URL, src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

function parseHtml(u: URL, html: string): LinkPreview {
  const root = parse(html);
  const meta = (prop: string, attr: "property" | "name" = "property"): string | null => {
    const el = root.querySelector(`meta[${attr}="${prop}"]`);
    return el?.getAttribute("content") ?? null;
  };
  const title =
    meta("og:title") ||
    meta("twitter:title", "name") ||
    root.querySelector("title")?.text ||
    null;
  const description =
    meta("og:description") ||
    meta("twitter:description", "name") ||
    meta("description", "name");
  const image = meta("og:image") || meta("twitter:image", "name");
  const siteName = meta("og:site_name") || u.hostname;

  let favicon: string | null = null;
  const link = root.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  if (link) favicon = abs(u, link.getAttribute("href"));
  if (!favicon) favicon = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;

  return {
    url: u.toString(),
    title: title?.trim() || u.hostname,
    description: description?.trim() || null,
    image: abs(u, image),
    siteName: siteName?.trim() || u.hostname,
    favicon,
  };
}

async function fetchHtml(target: URL, redirectsLeft: number): Promise<string> {
  await assertPublicHost(target.hostname);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NCHOpsBot/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
      redirect: "manual",
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc || redirectsLeft <= 0) throw new Error("Redirect blocked");
      const next = new URL(loc, target);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new Error("Redirect to non-http(s) blocked");
      }
      return fetchHtml(next, redirectsLeft - 1);
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("html")) throw new Error("Not HTML");
    const buf = await resp.arrayBuffer();
    return new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 256 * 1024));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs supported");
  }
  const cached = cache.get(u.toString());
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  try {
    const html = await fetchHtml(u, 3);
    const data = parseHtml(u, html);
    cache.set(u.toString(), { ts: Date.now(), data });
    return data;
  } catch (err) {
    logger.warn({ err, url: rawUrl }, "Link preview fetch failed");
    const fallback: LinkPreview = {
      url: u.toString(),
      title: u.hostname,
      description: null,
      image: null,
      siteName: u.hostname,
      favicon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`,
    };
    cache.set(u.toString(), { ts: Date.now(), data: fallback });
    return fallback;
  }
}
