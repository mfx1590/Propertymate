import { createHash, randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ProfilesService } from '../users/profiles.service';
import { TokenService, TokenPair } from './token.service';
import { OTP_PROVIDER, OtpProvider } from './otp/otp.provider';
import { AccountType } from './dto/auth.dto';

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly profilesService: ProfilesService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  async requestOtp(phone: string): Promise<{ sent: boolean; devCode?: string }> {
    const code = randomInt(100000, 999999).toString();

    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await this.otpProvider.send(phone, code);

    // convenience for local dev only — never returned when a real provider is configured
    const isMock = (this.config.get<string>('OTP_PROVIDER') ?? 'mock') === 'mock';
    return { sent: true, ...(isMock ? { devCode: code } : {}) };
  }

  async verifyOtp(
    phone: string,
    code: string,
    ip?: string,
    accountType?: AccountType,
  ): Promise<TokenPair & { isNewUser: boolean }> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new UnauthorizedException('No valid code — request a new one');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts — request a new code');
    }

    if (otp.codeHash !== sha256(code)) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('Incorrect code');
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

    let user = await this.prisma.user.findUnique({ where: { phone } });
    const isNewUser = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, phoneVerifiedAt: new Date() },
      });
      await this.assignDefaultCustomerRole(user.id);
      await this.assignAccountType(user.id, accountType, ip);
      await this.audit.log({
        actorId: user.id,
        action: 'user.register.otp',
        entityType: 'user',
        entityId: user.id,
        after: { accountType: accountType ?? 'customer' },
        ip,
      });
    } else {
      if (user.status !== 'active') throw new UnauthorizedException('Account is not active');
      if (!user.phoneVerifiedAt) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { phoneVerifiedAt: new Date() },
        });
      }
      await this.audit.log({
        actorId: user.id,
        action: 'user.login.otp',
        entityType: 'user',
        entityId: user.id,
        ip,
      });
    }

    const pair = await this.tokenService.issuePair(user, ip);
    return { ...pair, isNewUser };
  }

  async register(
    email: string,
    password: string,
    locale = 'en',
    ip?: string,
    accountType?: AccountType,
  ): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const user = await this.prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), locale },
    });
    await this.assignDefaultCustomerRole(user.id);
    await this.assignAccountType(user.id, accountType, ip);
    await this.audit.log({
      actorId: user.id,
      action: 'user.register.email',
      entityType: 'user',
      entityId: user.id,
      after: { accountType: accountType ?? 'customer' },
      ip,
    });

    return this.tokenService.issuePair(user, ip);
  }

  /** Grants the account type chosen at registration (customer baseline is separate). */
  private async assignAccountType(userId: string, accountType?: AccountType, ip?: string) {
    if (!accountType || accountType === 'customer') return;
    await this.profilesService.applyForRole(userId, accountType, ip);
  }

  async login(email: string, password: string, ip?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status !== 'active') throw new UnauthorizedException('Account is not active');

    await this.audit.log({
      actorId: user.id,
      action: 'user.login.email',
      entityType: 'user',
      entityId: user.id,
      ip,
    });
    return this.tokenService.issuePair(user, ip);
  }

  async refresh(refreshToken: string, ip?: string): Promise<TokenPair> {
    return this.tokenService.rotate(refreshToken, ip);
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokenService.revoke(refreshToken);
    return { ok: true };
  }

  /** Every new user starts as an (unverified-docs-not-needed) customer (Plan §3). */
  private async assignDefaultCustomerRole(userId: string): Promise<void> {
    const customerRole = await this.prisma.role.findUnique({ where: { key: 'customer' } });
    if (!customerRole) throw new BadRequestException('Roles not seeded — run npm run db:seed');
    await this.prisma.userRole.create({
      data: {
        userId,
        roleId: customerRole.id,
        verificationStatus: 'verified', // customers need phone OTP only (Plan §3)
        badgeTier: 'verified',
      },
    });
  }
}
