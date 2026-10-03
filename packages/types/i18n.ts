// Section 5 "Language": every server-authored text the customer sees (fallback, SYSTEM transition
// messages) and the widget's own UI strings are rendered in the conversation's session language.
// One table so the API, the worker and the widget can't drift apart.

export type Language = "vi" | "en";

export const LANGUAGES: readonly Language[] = ["vi", "en"];

const STRINGS = {
  insufficientKnowledgeFallback: {
    vi: "Xin lỗi, hiện mình chưa có đủ thông tin để trả lời câu này. Bạn có muốn kết nối với nhân viên hỗ trợ không?",
    en: "Sorry, I don't have enough information to answer that yet. Would you like me to connect you with a support agent?",
  },
  // SYSTEM transition messages (Section 7)
  handoffRequested: {
    vi: "Khách hàng muốn trao đổi với nhân viên. Đang chờ nhân viên hỗ trợ tiếp nhận.",
    en: "The customer asked to speak with a human. Waiting for an agent.",
  },
  agentJoined: { vi: "Nhân viên hỗ trợ đã tham gia cuộc trò chuyện.", en: "An agent has joined the conversation." },
  agentTookOver: { vi: "Một nhân viên hỗ trợ đã tiếp quản cuộc trò chuyện.", en: "An agent has taken over the conversation." },
  reassigned: { vi: "Cuộc trò chuyện đã được chuyển cho nhân viên khác.", en: "The conversation was reassigned to another agent." },
  released: {
    vi: "Nhân viên đã rời cuộc trò chuyện; đang chờ nhân viên khác.",
    en: "The agent released the conversation; waiting for another agent.",
  },
  closedByAgent: { vi: "Nhân viên đã kết thúc cuộc trò chuyện.", en: "The agent closed the conversation." },
  closedByCustomer: { vi: "Khách hàng đã kết thúc cuộc trò chuyện.", en: "The customer ended the conversation." },
  timeoutResumeAi: {
    vi: "Hiện chưa có nhân viên nào rảnh. Trợ lý AI sẽ tiếp tục hỗ trợ bạn.",
    en: "No agent was available in time. The AI assistant will continue helping you.",
  },
  timeoutCollectEmail: {
    vi: "Hiện chưa có nhân viên nào rảnh. Vui lòng để lại email, chúng tôi sẽ liên hệ lại.",
    en: "No agent was available. Please leave your email and we'll follow up.",
  },
  agentDisconnected: { vi: "Nhân viên đã mất kết nối. Đang chờ nhân viên khác.", en: "The agent disconnected. Waiting for another agent." },
  inactivityClosed: {
    vi: "Cuộc trò chuyện đã tự đóng sau 24 giờ không hoạt động.",
    en: "This conversation was closed after 24 hours of inactivity.",
  },
  // Widget UI
  talkToHuman: { vi: "Gặp nhân viên", en: "Talk to a human" },
  connecting: { vi: "Đang kết nối…", en: "Connecting…" },
  yesTalkToHuman: { vi: "Có, kết nối với nhân viên", en: "Yes, talk to a human" },
  waitingForAgentShort: { vi: "Đang chờ nhân viên…", en: "Waiting for an agent…" },
  waitingForAgent: { vi: "Đang chờ nhân viên hỗ trợ tham gia…", en: "Waiting for a support agent to join…" },
  chattingWithAgent: { vi: "Bạn đang trò chuyện với nhân viên hỗ trợ.", en: "You're now chatting with a support agent." },
  conversationEnded: {
    vi: "Cuộc trò chuyện đã kết thúc. Gửi tin nhắn để bắt đầu cuộc mới.",
    en: "This conversation has ended. Send a message to start a new one.",
  },
  supportAgent: { vi: "Nhân viên hỗ trợ", en: "Support agent" },
  leaveEmail: {
    vi: "Hiện chưa có nhân viên nào rảnh. Để lại email, chúng tôi sẽ phản hồi bạn.",
    en: "No agent is available right now. Leave your email and we'll get back to you.",
  },
  emailThanks: { vi: "Cảm ơn bạn! Chúng tôi sẽ liên hệ qua email.", en: "Thanks! We'll contact you by email." },
  send: { vi: "Gửi", en: "Send" },
  askPlaceholder: { vi: "Nhập câu hỏi…", en: "Ask a question…" },
  connectFailed: { vi: "Không thể kết nối. Vui lòng thử lại.", en: "Could not connect. Please retry." },
  answerFailed: { vi: "Trợ lý chưa trả lời được. Vui lòng thử lại.", en: "The assistant could not answer that. Please try again." },
  handoffFailed: {
    vi: "Chưa thể kết nối với nhân viên lúc này. Vui lòng thử lại.",
    en: "Could not reach a human right now. Please try again.",
  },
  emailFailed: { vi: "Không lưu được email. Vui lòng thử lại.", en: "Could not save your email. Please try again." },
  page: { vi: "tr.", en: "p." },
  aiAssistant: { vi: "Trợ lý AI", en: "AI assistant" },
  openChat: { vi: "Mở khung chat", en: "Open chat" },
  chatWith: { vi: "Chat với {name}", en: "Chat with {name}" },
  launcherHint: { vi: "Trợ lý AI · Nhấn để bắt đầu trò chuyện", en: "AI assistant · Click to start chatting" },
  closeChat: { vi: "Đóng khung chat", en: "Close chat" },
  retry: { vi: "Thử lại", en: "Retry" },
  moreOptions: { vi: "Tuỳ chọn khác", en: "More options" },
  minimize: { vi: "Thu nhỏ", en: "Minimize" },
  endChat: { vi: "Kết thúc trò chuyện", en: "End conversation" },
  endChatConfirmTitle: { vi: "Kết thúc cuộc trò chuyện?", en: "End this conversation?" },
  endChatConfirmBody: {
    vi: "Cuộc trò chuyện sẽ được đóng lại. Bạn vẫn có thể bắt đầu cuộc mới bất cứ lúc nào.",
    en: "The conversation will be closed. You can start a new one any time.",
  },
  cancel: { vi: "Huỷ", en: "Cancel" },
  endChatConfirm: { vi: "Kết thúc", en: "End" },
  endChatFailed: { vi: "Chưa kết thúc được cuộc trò chuyện. Vui lòng thử lại.", en: "Couldn't end the conversation. Please try again." },
  conversationEndedByYou: { vi: "Bạn đã kết thúc cuộc trò chuyện.", en: "You ended the conversation." },
  startNewChat: { vi: "Bắt đầu cuộc trò chuyện mới", en: "Start a new conversation" },
  loadFailed: { vi: "Không tải được cuộc trò chuyện.", en: "Couldn't load the conversation." },
  reconnecting: { vi: "Mất kết nối, đang thử kết nối lại…", en: "Connection lost, reconnecting…" },
  sendFailed: { vi: "Chưa gửi được.", en: "Not sent." },
  quotaReached: {
    vi: "Trợ lý tạm thời không thể trả lời. Bạn có thể kết nối với nhân viên hỗ trợ.",
    en: "The assistant can't answer right now. You can connect with a support agent.",
  },
  assistantTyping: { vi: "Trợ lý đang trả lời", en: "Assistant is typing" },
  jumpToLatest: { vi: "Tin nhắn mới nhất", en: "Jump to latest" },
} satisfies Record<string, Record<Language, string>>;

export type I18nKey = keyof typeof STRINGS;

export function t(language: Language, key: I18nKey): string {
  return STRINGS[key][language];
}
