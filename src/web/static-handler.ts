import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves static assets from distDir with SPA fallback support.
 *
 * @param req - Incoming HTTP request
 * @param res - Outgoing HTTP response
 * @param distDir - Absolute path to the dist directory containing compiled static files
 * @returns boolean - true if a file was successfully served, false if index.html is missing or request could not be served
 */
export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (!distDir || !fs.existsSync(distDir)) {
    return false;
  }

  let pathname = "/";
  try {
    const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = req.url || "/";
  }

  // Strip leading slashes to prevent absolute path resolution issues
  const relativePath = pathname.replace(/^\/+/, "");

  // Prevent directory traversal
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }

  let targetFilePath = path.join(distDir, normalized);

  // If path is a directory (e.g., "/" or a subfolder), try index.html inside it
  if (fs.existsSync(targetFilePath)) {
    try {
      const stat = fs.statSync(targetFilePath);
      if (stat.isDirectory()) {
        targetFilePath = path.join(targetFilePath, "index.html");
      }
    } catch {
      // ignore stat errors
    }
  }

  // If file doesn't exist or isn't a file, trigger SPA fallback to root index.html
  let isSpaFallback = false;
  if (!fs.existsSync(targetFilePath)) {
    isSpaFallback = true;
  } else {
    try {
      if (!fs.statSync(targetFilePath).isFile()) {
        isSpaFallback = true;
      }
    } catch {
      isSpaFallback = true;
    }
  }

  if (isSpaFallback) {
    targetFilePath = path.join(distDir, "index.html");
    if (!fs.existsSync(targetFilePath)) {
      return false;
    }
  }

  try {
    const ext = path.extname(targetFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const fileContent = fs.readFileSync(targetFilePath);

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", Buffer.byteLength(fileContent));

    if (req.method === "HEAD") {
      res.end();
    } else {
      res.end(fileContent);
    }
    return true;
  } catch {
    return false;
  }
}
