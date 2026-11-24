import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/constants";

/**
 * OPTIMISTISK förkontroll: skickar anrop utan sessionscookie till inloggningen.
 * Detta är INTE säkerhet. Varje layout, Server Action och Route Handler verifierar
 * sessionen och rollen mot databasen via src/server/auth/current-user.ts.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/golfshop/:path*", "/bollplockare/:path*", "/anstalld/:path*"],
};
