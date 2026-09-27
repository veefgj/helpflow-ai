import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv, DEFAULTS } from "@helpflow/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RefreshTokenService } from "./refresh-token.service";

const env = loadEnv();

@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: DEFAULTS.auth.accessTokenTtlSec },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
  exports: [JwtModule],
})
export class AuthModule {}
