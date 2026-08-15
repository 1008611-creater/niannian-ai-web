import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authCookie, sessionFromToken } from "@/lib/auth";

export default async function TeamPage() {
  const store = await cookies();
  const user = await sessionFromToken(store.get(authCookie)?.value).catch(() => null);
  redirect(user ? "/home" : "/login?next=/team");
}
