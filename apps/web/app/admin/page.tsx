import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminPageClient from "./admin-page-client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

async function requireAdmin() {
  const cookieStore = cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  if (!cookieHeader) {
    redirect("/");
  }

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { cookie: cookieHeader },
    cache: "no-store"
  });

  if (!res.ok) {
    redirect("/");
  }

  const data = await res.json();
  if (!data || data.role !== "ADMIN") {
    redirect("/");
  }
}

export default async function AdminPage() {
  await requireAdmin();
  return <AdminPageClient />;
}
