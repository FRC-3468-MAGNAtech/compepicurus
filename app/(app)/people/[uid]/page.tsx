"use client";

import { useParams } from "next/navigation";
import { ProfileView } from "@/components/profile/profile-view";

export default function PersonProfilePage() {
  const params = useParams<{ uid: string }>();
  return <ProfileView uid={decodeURIComponent(params.uid)} />;
}
