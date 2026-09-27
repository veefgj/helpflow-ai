import { IsString, MinLength } from "class-validator";

export class CreateKnowledgeBaseDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
