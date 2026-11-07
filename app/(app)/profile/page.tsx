"use client";

import { ProfileView } from "@/components/profile/profile-view";
import { useAuth } from "@/lib/auth";

/** Your own profile: the same page teammates see, plus Edit and "View as others see it". */
export default function OwnProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return <ProfileView uid={user.uid} />;
}
