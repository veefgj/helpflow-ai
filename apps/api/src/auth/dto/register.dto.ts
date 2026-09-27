import { IsEmail, IsString, MinLength } from "class-validator";
import { DEFAULTS } from "@helpflow/config";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(DEFAULTS.auth.passwordMinLength)
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
