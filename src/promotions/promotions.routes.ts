import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.get(
  "/packages",
  requireAuth,
  requireRole("ORGANIZER"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Promotion packages retrieved.",
      body: {
        packages: [
          {
            id: "spotlight",
            label: "Spotlight",
            priceNaira: 5000,
            durationDays: 7,
            description: "Extra visibility on Explore.",
            placementLabel: "Explore spotlight",
          },
          {
            id: "featured",
            label: "Featured",
            priceNaira: 10000,
            durationDays: 7,
            description: "Featured placement across Eventra.",
            placementLabel: "Featured events",
            popular: true,
          },
          {
            id: "homepage-hero",
            label: "Homepage Hero",
            priceNaira: 20000,
            durationDays: 7,
            description: "Premium homepage hero placement.",
            placementLabel: "Homepage hero",
          },
        ],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/mine",
  requireAuth,
  requireRole("ORGANIZER"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Promotions retrieved.",
      body: {
        promotions: [],
        currency: "Naira",
      },
    });
  },
);

export default router;
