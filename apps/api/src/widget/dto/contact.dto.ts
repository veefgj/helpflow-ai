import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class ContactDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
