import { Router } from "express";
import { Temporal } from "@js-temporal/polyfill";

import { db } from "../prisma/db";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

// ==========================
// GET ORGANIZER PROFILE
// ==========================

router.get(
  "/profile",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;

      const profile = await db.orm.public.OrganizerProfile.where({
        userId,
      }).first();

      return res.status(200).json({
        success: true,
        message: "Organizer profile retrieved.",
        body: profile ?? null,
      });
    } catch (error) {
      console.error("Get organizer profile error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }
  },
);

// ==========================
// SAVE / UPDATE ONBOARDING
// ==========================

router.post(
  "/profile",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;

      const {
        organisationName,
        businessEmail,
        businessPhone,
        website,

        address,
        city,
        state,
        country,

        bankName,
        accountName,
        accountNumber,

        submit,
      } = req.body;

      if (!organisationName) {
        return res.status(400).json({
          success: false,
          message: "Organisation name is required.",
        });
      }

      const existingProfile = await db.orm.public.OrganizerProfile.where({
        userId,
      }).first();

      const approvalStatus =
        submit === true
          ? "pending"
          : (existingProfile?.approvalStatus ?? "draft");

      const submittedAt =
        submit === true
          ? Temporal.Now.instant()
          : (existingProfile?.submittedAt ?? null);

      if (!existingProfile) {
        const profile = await db.orm.public.OrganizerProfile.create({
          userId,

          organisationName: organisationName.trim(),

          businessEmail: businessEmail?.trim() || null,

          businessPhone: businessPhone?.trim() || null,

          website: website?.trim() || null,

          address: address?.trim() || null,

          city: city?.trim() || null,

          state: state?.trim() || null,

          country: country?.trim() || null,

          bankName: bankName?.trim() || null,

          accountName: accountName?.trim() || null,

          accountNumber: accountNumber?.trim() || null,

          approvalStatus,

          submittedAt,
        });

        return res.status(201).json({
          success: true,
          message:
            submit === true
              ? "Organizer application submitted."
              : "Organizer profile saved as draft.",
          body: profile,
        });
      }

      await db.orm.public.OrganizerProfile.where({ userId }).update({
        organisationName: organisationName.trim(),

        businessEmail: businessEmail?.trim() || null,

        businessPhone: businessPhone?.trim() || null,

        website: website?.trim() || null,

        address: address?.trim() || null,

        city: city?.trim() || null,

        state: state?.trim() || null,

        country: country?.trim() || null,

        bankName: bankName?.trim() || null,

        accountName: accountName?.trim() || null,

        accountNumber: accountNumber?.trim() || null,

        approvalStatus,

        submittedAt,
      });

      const updatedProfile = await db.orm.public.OrganizerProfile.where({
        userId,
      }).first();

      return res.status(200).json({
        success: true,
        message:
          submit === true
            ? "Organizer application submitted."
            : "Organizer profile updated.",
        body: updatedProfile,
      });
    } catch (error) {
      console.error("Save organizer profile error:", error);

      return res.status(500).json({
        success: false,
        message: "Internal server error.",
      });
    }
  },
);

export default router;
