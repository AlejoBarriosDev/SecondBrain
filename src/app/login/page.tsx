import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { isAllowedEmail } from "@/lib/auth/allowed-email";
import { LoginClient } from "@/components/auth/LoginClient";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });

  if (session?.user && isAllowedEmail(session.user.email)) {
    redirect("/");
  }

  const params = await searchParams;
  return <LoginClient initialError={params.error ?? null} />;
}
