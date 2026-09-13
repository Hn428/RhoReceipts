import { redirect } from "next/navigation";

/** Enrollment replaced the one-step connect flow. */
export default function ConnectRedirect() {
  redirect("/enroll");
}
