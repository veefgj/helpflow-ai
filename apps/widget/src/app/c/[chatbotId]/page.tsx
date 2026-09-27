import { ChatWidget } from "./chat-widget";

export default async function WidgetPage({ params }: { params: Promise<{ chatbotId: string }> }) {
  const { chatbotId } = await params;
  return <ChatWidget chatbotId={chatbotId} />;
}
