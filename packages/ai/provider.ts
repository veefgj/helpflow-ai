// ADR-001: OpenAI behind LlmProvider / EmbeddingProvider interfaces — one implementation each,
// so a future provider swap (or the deterministic FakeProvider used in tests/dev) stays contained.

export interface EmbeddingOutput {
  embedding: number[];
  tokens: number;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<EmbeddingOutput[]>;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatStreamParams {
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  onChunk: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  /** True if the stream was cut short by `signal` or a timeout before a natural stop. */
  interrupted: boolean;
}

export interface LlmProvider {
  readonly model: string;
  streamChatCompletion(params: ChatStreamParams): Promise<ChatCompletionResult>;
}
