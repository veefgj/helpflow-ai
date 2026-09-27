import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import type { UnavailablePolicy } from "@helpflow/database";

export class UpdateChatbotDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  welcomeMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyTokenCap?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  handoffTimeoutSec?: number;

  @IsOptional()
  @IsIn(["RESUME_AI", "COLLECT_EMAIL"])
  unavailablePolicy?: UnavailablePolicy;
}
