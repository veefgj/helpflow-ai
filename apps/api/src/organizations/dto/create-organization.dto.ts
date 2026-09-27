import { IsString, MinLength } from "class-validator";

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
