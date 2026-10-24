import { Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function PlatformBadge({ platform }: { platform: "pc" | "mobile" }) {
  const Icon = platform === "pc" ? Monitor : Smartphone;
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Icon className="h-3 w-3" /> {platform === "pc" ? "PC" : "Mobile"}
    </Badge>
  );
}
