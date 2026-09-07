import { db } from "../prisma/db";

const categories = [
  { name: "Music", slug: "music" },
  { name: "Business", slug: "business" },
  { name: "Technology", slug: "technology" },
  { name: "Food & Drink", slug: "food-and-drink" },
  { name: "Arts & Culture", slug: "arts-and-culture" },
  { name: "Fashion", slug: "fashion" },
  { name: "Sports", slug: "sports" },
  { name: "Health & Wellness", slug: "health-and-wellness" },
  { name: "Education", slug: "education" },
  { name: "Networking", slug: "networking" },
  { name: "Entertainment", slug: "entertainment" },
  { name: "Community", slug: "community" },
  { name: "Religious", slug: "religious" },
  { name: "Charity", slug: "charity" },
  { name: "Other", slug: "other" },
];

async function seedCategories() {
  console.log("Seeding Eventra categories...");

  for (const category of categories) {
    const existing = await db.orm.public.Category.where({
      slug: category.slug,
    }).first();

    if (existing) {
      console.log(`Skipping existing category: ${category.name}`);
      continue;
    }

    await db.orm.public.Category.create({
      name: category.name,
      slug: category.slug,
      isActive: true,
    });

    console.log(`Created category: ${category.name}`);
  }

  console.log("Category seed complete.");
}

seedCategories().catch((error) => {
  console.error("Category seed failed:", error);
  process.exit(1);
});
