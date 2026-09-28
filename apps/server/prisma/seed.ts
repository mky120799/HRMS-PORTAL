/**
 * Development seed: one workspace ("acme") with an admin account and default
 * leave policies. Sample employees/payroll/etc. are added from the UI via
 * "Start with sample data" (POST /tenants/seed-demo), which uses the same code
 * path real trial users get.
 *
 * Refuses to run against production.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const DEFAULT_LEAVE_POLICIES = [
  { type: 'ANNUAL', annualQuota: 18, isPaid: true },
  { type: 'SICK', annualQuota: 12, isPaid: true },
  { type: 'CASUAL', annualQuota: 6, isPaid: true },
  { type: 'UNPAID', annualQuota: 0, isPaid: false },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const prisma = new PrismaClient();
  const email = 'admin@acme.test';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-12345';

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { name: 'Acme Corporation', slug: 'acme', timezone: 'Asia/Kolkata', subscriptionStatus: 'TRIAL', trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  await prisma.leavePolicy.createMany({ data: DEFAULT_LEAVE_POLICIES.map((p) => ({ ...p, tenantId: tenant.id })), skipDuplicates: true });

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: {},
    create: { tenantId: tenant.id, email, name: 'Acme Admin', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 12) },
  });
  await prisma.employee.upsert({
    where: { userId: user.id },
    update: {},
    create: { tenantId: tenant.id, userId: user.id, email, firstName: 'Acme', lastName: 'Admin', department: 'Management', designation: 'Administrator' },
  });

  console.log(`Seeded workspace "acme". Sign in with workspace=acme, email=${email}, password=${password}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
