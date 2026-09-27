import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { prisma, type User } from "@helpflow/database";
import { ApiErrorCode, HelpFlowApiException } from "@helpflow/types";
import { RefreshTokenService } from "./refresh-token.service";
import type { RegisterDto } from "./dto/register.dto";
import type { LoginDto } from "./dto/login.dto";

export interface AuthResult {
  user: Pick<User, "id" | "email" | "name">;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  // tsx/esbuild emits no decorator metadata, so every param needs an explicit @Inject(token).
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HelpFlowApiException(ApiErrorCode.DUPLICATE_RESOURCE, "An account with this email already exists");
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await prisma.user.create({ data: { email, passwordHash, name: dto.name } });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    // Never reveal whether the email or the password was wrong.
    const invalidCredentials = () => new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Invalid email or password");

    if (!user) throw invalidCredentials();
    const passwordOk = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordOk) throw invalidCredentials();

    return this.issueTokens(user);
  }

  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const { userId, rawToken } = await this.refreshTokens.rotate(rawRefreshToken);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HelpFlowApiException(ApiErrorCode.UNAUTHENTICATED, "Account no longer exists");
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken: this.signAccessToken(user),
      refreshToken: rawToken,
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(rawRefreshToken);
  }

  private async issueTokens(user: User): Promise<AuthResult> {
    const refreshToken = await this.refreshTokens.issue(user.id);
    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken: this.signAccessToken(user),
      refreshToken,
    };
  }

  private signAccessToken(user: Pick<User, "id" | "email">): string {
    return this.jwt.sign({ sub: user.id, email: user.email });
  }
}
