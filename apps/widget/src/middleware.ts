// Section 6 "Embedding policy": GET /c/:chatbotId serves the iframe HTML with
// Content-Security-Policy: frame-ancestors <allowedDomains>. An empty list means the widget cannot
// be embedded anywhere except the dashboard preview. This is browser-enforced, not an API boundary.
import { NextResponse, type NextRequest } from "next/server";

const CHATBOT_ROUTE = /^\/c\/([^/]+)/;

export async function middleware(request: NextRequest) {
  const match = CHATBOT_ROUTE.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();

  const chatbotId = match[1];
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  let allowedDomains: string[] = [];
  try {
    const res = await fetch(`${apiUrl}/api/widget/chatbots/${chatbotId}/embed-policy`);
    if (res.ok) {
      const data = (await res.json()) as { allowedDomains: string[] };
      allowedDomains = data.allowedDomains;
    }
  } catch {
    // API unreachable: fail closed — only the dashboard preview origin is allowed below.
  }

  const response = NextResponse.next();
  const sources = [appUrl, ...allowedDomains].join(" ");
  response.headers.set("Content-Security-Policy", `frame-ancestors ${sources}`);
  return response;
}

export const config = {
  matcher: "/c/:chatbotId*",
};
