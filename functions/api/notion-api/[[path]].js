/**
 * Cloudflare Pages Function — Notion API proxy.
 * Routes: /api/notion-api/v1/*  →  https://api.notion.com/v1/*
 * Adds CORS headers so the browser app can call it directly.
 */
export async function onRequest(context) {
  const { request, params } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const segs = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const url = new URL(request.url);
  const target = "https://api.notion.com/" + segs.join("/") + url.search;

  const outHeaders = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) outHeaders.set("authorization", auth);
  outHeaders.set("content-type", request.headers.get("content-type") || "application/json");
  outHeaders.set(
    "notion-version",
    request.headers.get("notion-version") || "2022-06-28"
  );

  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target, { method: request.method, headers: outHeaders, body });
  } catch (e) {
    return json({ error: "upstream_fetch_failed", message: String(e) }, 502);
  }

  const respHeaders = new Headers(corsHeaders());
  respHeaders.set(
    "content-type",
    upstream.headers.get("content-type") || "application/json"
  );
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,notion-version,x-requested-with",
    "access-control-max-age": "86400",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json" },
  });
}
