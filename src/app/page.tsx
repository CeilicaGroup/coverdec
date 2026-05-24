import { redirect } from "next/navigation";
import { redirectIfAuthenticated } from "@/lib/auth-server";

export default async function HomePage() {
  await redirectIfAuthenticated();
  redirect("/login");
}
