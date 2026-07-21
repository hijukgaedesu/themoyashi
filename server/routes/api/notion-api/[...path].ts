// @ts-nocheck
// Nitro가 빌드 시 자동으로 전역 타입을 주입하므로, 별도 빌드 없이 타입 검사만 할 때
// defineEventHandler 등의 이름을 못 찾을 수 있어 방어적으로 타입 체크를 꺼둡니다.
/**
 * Nitro 서버 라우트 — 노션 API 프록시.
 * 경로: /api/notion-api/v1/*  →  https://api.notion.com/v1/*
 * 브라우저에서 바로 호출할 수 있도록 CORS 헤더를 붙여서 응답합니다.
 *
 * defineEventHandler / getMethod / getHeader / getRequestURL / toWebRequest /
 * setResponseHeaders / setResponseStatus 는 Nitro가 자동으로 주입해주는
 * h3 유틸리티라 별도 import가 필요 없습니다.
 */
export default defineEventHandler(async (event: any) => {
  const method = getMethod(event);

  if (method === "OPTIONS") {
    setResponseHeaders(event, corsHeaders());
    setResponseStatus(event, 204);
    return null;
  }

  // [...path].ts 캐치올 파라미터: Nitro 버전에 따라 문자열 또는 배열로 들어올 수 있어 둘 다 대응
  const rawParam = event.context.params?.path;
  const pathSegment = Array.isArray(rawParam) ? rawParam.join("/") : rawParam || "";

  const url = getRequestURL(event);
  const target = `https://api.notion.com/${pathSegment}${url.search}`;

  const auth = getHeader(event, "authorization");
  const notionVersion = getHeader(event, "notion-version") || "2022-06-28";

  const outHeaders: Record<string, string> = {
    "content-type": getHeader(event, "content-type") || "application/json",
    "notion-version": notionVersion,
  };
  if (auth) outHeaders["authorization"] = auth;

  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(method)) {
    // Cloudflare Workers 런타임에는 Node의 Buffer가 없으므로,
    // h3의 표준 Web Request 변환 유틸(toWebRequest)로 바디를 읽습니다.
    const webReq = toWebRequest(event);
    body = await webReq.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers: outHeaders, body });
  } catch (e) {
    setResponseHeaders(event, { ...corsHeaders(), "content-type": "application/json" });
    setResponseStatus(event, 502);
    return { error: "upstream_fetch_failed", message: String(e) };
  }

  setResponseHeaders(event, {
    ...corsHeaders(),
    "content-type": upstream.headers.get("content-type") || "application/json",
  });
  setResponseStatus(event, upstream.status);

  const buf = await upstream.arrayBuffer();
  return new Uint8Array(buf);
});

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,notion-version,x-requested-with",
    "access-control-max-age": "86400",
  };
}
