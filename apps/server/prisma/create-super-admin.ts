/**
 * Creates (or resets) a platform operator account.
 *   SUPER_ADMIN_EMAIL=ops@company.com SUPER_ADMIN_PASSWORD='...' npm run create-super-admin -w @hrms/server
 * Operators live in a dedicated internal workspace ("platform") so they never
 * belong to — or appear in — a customer tenant.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password || password.length < 14) {
    throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (min 14 characters)');
  }
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: {},
    create: { name: 'Platform Operations', slug: 'platform', subscriptionStatus: 'ACTIVE', subscriptionPlan: 'ENTERPRISE' },
  });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { passwordHash, role: 'SUPER_ADMIN', isActive: true, tokenVersion: { increment: 1 } },
    create: { tenantId: tenant.id, email, name: 'Platform Operator', role: 'SUPER_ADMIN', passwordHash },
  });
  console.log(`Super admin ready. Sign in with workspace=platform, email=${email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
