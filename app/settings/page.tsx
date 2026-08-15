import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";

export default async function SettingsPage() {
  const store = await cookies();
  const user = await sessionFromToken(store.get(authCookie)?.value).catch(() => null);
  if (!user) redirect("/login?next=/settings");
  redirect(isAdminEmail(user.email) ? "/admin" : "/home");
}
