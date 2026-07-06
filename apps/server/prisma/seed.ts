import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with demo data...');

  // 1. Create a Demo Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-corp' },
    update: {},
    create: {
      name: 'Acme Corporation',
      slug: 'acme-corp',
      subscriptionStatus: 'ACTIVE',
      subscriptionPlan: 'PRO',
    },
  });

  console.log(`✅ Tenant created: ${tenant.name}`);

  // 2. Create Default Admin User & Employee Profile
  const adminPassword = await bcrypt.hash('password123', 10);
  const adminUser = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: 'admin@hrms.com'
      }
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@hrms.com',
      passwordHash: adminPassword,
      name: 'Admin User',
      role: 'ADMIN',
    },
  });

  await prisma.employee.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: adminUser.id,
      email: 'admin@hrms.com',
      firstName: 'Admin',
      lastName: 'User',
      department: 'Management',
    },
  });

  console.log(`✅ Admin user created: admin@hrms.com / password123`);

  // 3. Create Employees
  const departments = ['Engineering', 'HR', 'Sales', 'Marketing', 'Finance'];
  const employees = [];

  for (let i = 0; i < 20; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName, provider: 'acme.corp' }).toLowerCase();
    
    // Only create a user for some of them to save time, or just create employees
    const emp = await prisma.employee.create({
      data: {
        tenantId: tenant.id,
        email,
        firstName,
        lastName,
        department: faker.helpers.arrayElement(departments),
      }
    });

    // Create base salary structure
    await prisma.salaryStructure.create({
      data: {
        tenantId: tenant.id,
        employeeId: emp.id,
        baseSalary: faker.number.int({ min: 40000, max: 120000 }),
        allowances: faker.number.int({ min: 1000, max: 5000 }),
      }
    });

    employees.push(emp);
  }

  console.log(`✅ Created 20 demo employees with salary structures`);

  // 4. Create Leaves
  for (const emp of employees.slice(0, 5)) {
    // Approved leave in the past
    await prisma.leaveRequest.create({
      data: {
        tenantId: tenant.id,
        employeeId: emp.id,
        type: faker.helpers.arrayElement(['ANNUAL', 'SICK']),
        startDate: faker.date.recent({ days: 30 }),
        endDate: faker.date.recent({ days: 28 }),
        status: 'APPROVED',
      }
    });

    // Pending leave in the future
    await prisma.leaveRequest.create({
      data: {
        tenantId: tenant.id,
        employeeId: emp.id,
        type: 'ANNUAL',
        startDate: faker.date.soon({ days: 10 }),
        endDate: faker.date.soon({ days: 15 }),
        status: 'PENDING',
      }
    });
  }

  console.log(`✅ Created sample leave requests`);

  console.log('🎉 Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
