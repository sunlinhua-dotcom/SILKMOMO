// seed-brand.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  if (users.length === 0) {
    console.log("No users found.");
    return;
  }
  const adminUser = users.find(u => u.role === 'admin') || users[0];
  
  const existingProfile = await prisma.brandProfile.findFirst({
    where: { userId: adminUser.id, isDefault: true }
  });

  const aestheticConfig = {
    lightingStyle: "high-end_editorial_film_warmth",
    bgPreference: "warm_domestic_cozy_minimal",
    promptSuffix: "Cinematic Kodak Portra 400 feel, relaxed lifestyle, extreme fabric macro details, no pure white backgrounds.",
    name: "Luxury Editorial Vibe (高级生活方式)"
  };

  if (existingProfile) {
    await prisma.brandProfile.update({
      where: { id: existingProfile.id },
      data: aestheticConfig
    });
    console.log("Updated existing default brand profile for user", adminUser.username);
  } else {
    await prisma.brandProfile.create({
      data: {
        userId: adminUser.id,
        isDefault: true,
        ...aestheticConfig
      }
    });
    console.log("Created brand profile for user", adminUser.username);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
