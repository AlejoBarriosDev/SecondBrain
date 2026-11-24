import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedUserDefaults } from "../src/modules/core/seed-defaults";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    console.log(
      "[seed] No users exist yet. Defaults will be seeded automatically on first login.",
    );
    return;
  }

  for (const user of users) {
    await seedUserDefaults(prisma, user.id);
    console.log(`[seed] Seeded defaults for user ${user.email} (${user.id})`);
  }
}

main()
  .catch((err) => {
    console.error("[seed] Error seeding database:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
