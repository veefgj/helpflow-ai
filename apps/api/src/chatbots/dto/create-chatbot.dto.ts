import { IsString, MinLength } from "class-validator";

export class CreateChatbotDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
