// Real behavior lands in Phase 2 (Section 6): look up the chatbot's allowedDomains, set
// `Content-Security-Policy: frame-ancestors <allowedDomains>` via middleware.ts, bootstrap the
// visitor session (POST /api/widget/session) and render the chat UI.
export default async function WidgetPage({ params }: { params: Promise<{ chatbotId: string }> }) {
  const { chatbotId } = await params;
  return (
    <div style={{ fontFamily: "sans-serif", padding: 16 }}>
      <p>HelpFlow widget scaffold — chatbot {chatbotId}. Chat UI lands in Phase 2.</p>
    </div>
  );
}
