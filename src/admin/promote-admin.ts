import "dotenv/config";
import { db } from "../prisma/db";

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error(
    "Usage: npx tsx src/admin/promote-admin.ts your-email@example.com",
  );
  process.exit(1);
}

async function main() {
  const user = await db.orm.public.User.where({ email }).first();

  if (!user) {
    console.error(
      "No Eventra user exists with that email. Create/log in with the account first.",
    );
    process.exit(1);
  }

  await db.orm.public.User.where({ id: user.id }).update({
    role: "ADMIN",
    isEmailVerified: true,
  });

  console.log(`Admin access granted to ${user.email}`);
}

main().catch((error) => {
  console.error("Could not promote admin:", error);
  process.exit(1);
});
