import OpenAI from "openai";
import { loadEnv } from "@helpflow/config";
import { countTokens } from "./tokenizer";
import type { ChatCompletionResult, ChatStreamParams, EmbeddingOutput, EmbeddingProvider, LlmProvider } from "./provider";

function client(): OpenAI {
  const env = loadEnv();
  return new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;

  constructor() {
    this.model = loadEnv().EMBEDDING_MODEL;
  }

  async embed(texts: string[]): Promise<EmbeddingOutput[]> {
    if (texts.length === 0) return [];
    const res = await client().embeddings.create({ model: this.model, input: texts });
    return res.data.map((d, i) => ({ embedding: d.embedding, tokens: countTokens(texts[i]!) }));
  }
}

export class OpenAiLlmProvider implements LlmProvider {
  readonly model: string;

  constructor() {
    this.model = loadEnv().LLM_CHAT_MODEL;
  }

  async streamChatCompletion(params: ChatStreamParams): Promise<ChatCompletionResult> {
    const stream = await client().chat.completions.create(
      {
        model: this.model,
        messages: params.messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: params.signal },
    );

    let content = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let interrupted = false;

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          params.onChunk(delta);
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }
    } catch (err) {
      if (params.signal?.aborted) {
        interrupted = true;
      } else {
        throw err;
      }
    }

    if (!inputTokens && !outputTokens) {
      // stream_options.include_usage should always supply this, but estimate defensively.
      inputTokens = params.messages.reduce((sum, m) => sum + countTokens(m.content), 0);
      outputTokens = countTokens(content);
    }

    return { content, inputTokens, outputTokens, interrupted };
  }
}
