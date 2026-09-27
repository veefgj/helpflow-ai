import { IsOptional, IsString, MinLength } from "class-validator";

export class BootstrapSessionDto {
  @IsString()
  @MinLength(1)
  chatbotId!: string;

  @IsOptional()
  @IsString()
  visitorToken?: string;
}
