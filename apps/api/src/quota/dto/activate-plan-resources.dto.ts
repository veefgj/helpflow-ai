import { ArrayMaxSize, IsArray, IsIn, IsString } from "class-validator";

export class ActivatePlanResourcesDto {
  @IsIn(["chatbots", "documents", "agents"])
  type!: "chatbots" | "documents" | "agents";

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids!: string[];
}
