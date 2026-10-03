import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateChatbotDto } from "./create-chatbot.dto";
import { UpdateChatbotDto } from "./update-chatbot.dto";

// Mirrors the global ValidationPipe({ transform: true }) path: plainToInstance runs @Transform, then validate.
async function errorsFor<T extends { name?: string }>(cls: new () => T, body: object) {
  const dto = plainToInstance(cls, body);
  return { dto, errors: await validate(dto) };
}

describe("chatbot name validation", () => {
  it.each<new () => { name?: string }>([CreateChatbotDto, UpdateChatbotDto])("%o rejects empty and whitespace-only names", async (cls) => {
    expect((await errorsFor(cls, { name: "" })).errors).not.toHaveLength(0);
    expect((await errorsFor(cls, { name: "   " })).errors).not.toHaveLength(0);
  });

  it.each<new () => { name?: string }>([CreateChatbotDto, UpdateChatbotDto])("%o trims surrounding whitespace", async (cls) => {
    const { dto, errors } = await errorsFor(cls, { name: "  NovaSoft  " });
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("NovaSoft");
  });

  it("allows a PATCH that omits name", async () => {
    expect((await errorsFor(UpdateChatbotDto, { description: "x" })).errors).toHaveLength(0);
  });
});
