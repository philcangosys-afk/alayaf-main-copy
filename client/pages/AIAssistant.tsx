import PlaceholderModule from "@/components/PlaceholderModule";
import { Bot } from "lucide-react";

export default function AIAssistant() {
  const features = [{ label: "المساعد الذكي", href: "/ai/assistant" }];

  return (
    <PlaceholderModule
      title="الذكاء الاصطناعي"
      description="أدوات ذكية لمساعدتك في التحليل والتقارير وأتمتة المهام"
      icon={Bot}
      features={features}
    />
  );
}
