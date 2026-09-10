import { Router } from "express";
import { db } from "../prisma/db";

const router = Router();

// ========================================
// GET ALL ACTIVE CATEGORIES
// ========================================

router.get("/", async (_req, res) => {
  try {
    const categories = await db.orm.public.Category.where({
      isActive: true,
    }).all();

    const events = await db.orm.public.Event.where({
      status: "approved",
    }).all();

    const body = categories.map((category) => {
      const eventCount = events.filter(
        (event) => event.categoryId === category.id,
      ).length;

      return {
        _id: category.id,
        name: category.name,
        slug: category.slug,
        isActive: category.isActive,
        eventCount,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Categories retrieved.",
      body,
    });
  } catch (error) {
    console.error("Get categories error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});

export default router;
