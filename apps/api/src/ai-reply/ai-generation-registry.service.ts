// Section 7 T2 "Cancels any AI stream (INTERRUPTED)": a customer requesting handoff mid-generation
// must be able to abort the in-flight stream. In-process only — fine for the single API replica
// the MVP runs (ADR-002); a multi-replica deployment would need this signal routed through Redis too.
import { Injectable } from "@nestjs/common";

@Injectable()
export class AiGenerationRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(conversationId: string, controller: AbortController): void {
    this.controllers.set(conversationId, controller);
  }

  unregister(conversationId: string): void {
    this.controllers.delete(conversationId);
  }

  /** Returns true if a generation was in flight and has now been asked to abort. */
  abort(conversationId: string): boolean {
    const controller = this.controllers.get(conversationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
