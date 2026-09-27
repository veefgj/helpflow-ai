import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
