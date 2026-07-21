import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// ------------------------------------------------------------------
// 노션 API 프록시 — /api/notion-api/* 요청을 https://api.notion.com/* 로 전달.
// TanStack Start / Nitro 라우팅(server/routes 등)이 실제 배포 환경에서 이
// 경로를 스캔하지 않는 경우에도 항상 동작하도록, 진짜 Worker 진입점인
// 이 파일의 fetch() 맨 앞에서 직접 가로채서 처리합니다.
// ------------------------------------------------------------------
const NOTION_API_ROOT = "https://api.notion.com";
const NOTION_PROXY_PREFIX = "/api/notion-api";

function notionCorsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,notion-version,x-requested-with",
    "access-control-max-age": "86400",
  };
}

async function handleNotionApiProxy(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: notionCorsHeaders() });
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.slice(NOTION_PROXY_PREFIX.length) || "/";
  const target = `${NOTION_API_ROOT}${upstreamPath}${url.search}`;

  const outHeaders: Record<string, string> = {
    "content-type": request.headers.get("content-type") || "application/json",
    "notion-version": request.headers.get("notion-version") || "2022-06-28",
  };
  const auth = request.headers.get("authorization");
  if (auth) outHeaders["authorization"] = auth;

  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: request.method, headers: outHeaders, body });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "upstream_fetch_failed", message: String(error) }),
      { status: 502, headers: { ...notionCorsHeaders(), "content-type": "application/json" } },
    );
  }

  const respHeaders = new Headers(notionCorsHeaders());
  respHeaders.set("content-type", upstream.headers.get("content-type") || "application/json");
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(NOTION_PROXY_PREFIX)) {
      return handleNotionApiProxy(request);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
