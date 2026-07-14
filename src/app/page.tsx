import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Studio } from "@/components/studio";
import {
  STUDIO_SESSION_COOKIE,
  isStudioSessionAuthorized
} from "@/lib/self-host-auth";

export const dynamic = "force-dynamic";

export default function Page() {
  const token = cookies().get(STUDIO_SESSION_COOKIE)?.value;
  if (!isStudioSessionAuthorized(token)) redirect("/login");
  return <Studio />;
}
