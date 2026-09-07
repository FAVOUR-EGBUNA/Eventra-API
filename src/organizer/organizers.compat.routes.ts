import { Router } from "express";
import { db } from "../prisma/db";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

const defaultNotificationPreferences = {
  newSalesRsvps: true,
  dailySalesSummary: true,
  payoutConfirmations: true,
  eventApprovals: true,
};

async function getProfile(userId: string) {
  return db.orm.public.OrganizerProfile.where({ userId }).first();
}

function adaptProfile(profile: any) {
  if (!profile) return null;

  return {
    businessName: profile.organisationName,
    category: undefined,
    city: profile.city ?? "",
    contactPhone: profile.businessPhone ?? "",
    publicEmail: profile.businessEmail ?? "",
    bio: undefined,
    bankName: profile.bankName ?? undefined,
    bankCode: profile.bankName ? "manual" : undefined,
    accountNumber: profile.accountNumber ?? undefined,
    accountName: profile.accountName ?? undefined,
    isPayoutReady: Boolean(
      profile.bankName && profile.accountNumber && profile.accountName,
    ),
    approvalStatus: profile.approvalStatus,
    paystackRecipientCode: undefined,
  };
}

router.get(
  "/profile",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const profile = await getProfile(req.user!.id);

      return res.status(200).json({
        success: true,
        message: "Organizer profile retrieved.",
        body: adaptProfile(profile),
      });
    } catch (error) {
      console.error("Organizer profile compatibility error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve organizer profile.",
      });
    }
  },
);

router.patch(
  "/profile",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const existing = await getProfile(userId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: "Organizer profile not found.",
        });
      }

      const payload = req.body ?? {};

      await db.orm.public.OrganizerProfile.where({ userId }).update({
        organisationName:
          payload.businessName !== undefined
            ? String(payload.businessName).trim()
            : existing.organisationName,
        businessEmail:
          payload.publicEmail !== undefined
            ? String(payload.publicEmail).trim() || null
            : existing.businessEmail,
        businessPhone:
          payload.contactPhone !== undefined
            ? String(payload.contactPhone).trim() || null
            : existing.businessPhone,
        city:
          payload.city !== undefined
            ? String(payload.city).trim() || null
            : existing.city,
        bankName:
          payload.bankName !== undefined
            ? String(payload.bankName).trim() || null
            : existing.bankName,
        accountName:
          payload.accountName !== undefined
            ? String(payload.accountName).trim() || null
            : existing.accountName,
        accountNumber:
          payload.accountNumber !== undefined
            ? String(payload.accountNumber).trim() || null
            : existing.accountNumber,
      });

      const updated = await getProfile(userId);

      return res.status(200).json({
        success: true,
        message: "Organizer profile updated.",
        body: adaptProfile(updated),
      });
    } catch (error) {
      console.error("Update organizer profile compatibility error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not update organizer profile.",
      });
    }
  },
);

router.get(
  "/overview",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const allEvents = await db.orm.public.Event.all();

      const events = allEvents.filter(
        (event: any) => String(event.organizerId) === String(organizerId),
      );

      const categories = await db.orm.public.Category.all();
      const categoryMap = new Map(
        categories.map((category: any) => [String(category.id), category.name]),
      );

      const recentEvents = events
        .slice()
        .sort((a: any, b: any) =>
          String(b.createdAt).localeCompare(String(a.createdAt)),
        )
        .slice(0, 5)
        .map((event: any) => ({
          _id: event.id,
          title: event.title,
          slug: event.slug,
          coverImage: event.coverImage ?? undefined,
          category: event.categoryId
            ? (categoryMap.get(String(event.categoryId)) ?? "")
            : "",
          startDate: event.startDate
            ? String(event.startDate)
            : String(event.createdAt),
          soldCount: 0,
          capacity: event.capacity ?? null,
          status: event.status,
          statusLabel: String(event.status),
        }));

      const liveEventsCount = events.filter(
        (event: any) => String(event.status).toLowerCase() === "approved",
      ).length;

      return res.status(200).json({
        success: true,
        message: "Organizer overview retrieved.",
        body: {
          ticketsSold: 0,
          ticketsSoldChangePct: null,
          revenue: 0,
          revenueChangePct: null,
          liveEventsCount,
          payoutDue: 0,
          nextPayoutInDays: null,
          recentEvents,
          revenueSeries: [],
          ticketsByType: [],
          currency: "Naira",
        },
      });
    } catch (error) {
      console.error("Organizer overview compatibility error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve organizer overview.",
      });
    }
  },
);

router.get(
  "/payouts",
  requireAuth,
  requireRole("ORGANIZER"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Payouts retrieved.",
      body: {
        earningsByEvent: [],
        payoutHistory: [],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/notification-preferences",
  requireAuth,
  requireRole("ORGANIZER"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Notification preferences retrieved.",
      body: defaultNotificationPreferences,
    });
  },
);

router.patch(
  "/notification-preferences",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    return res.status(200).json({
      success: true,
      message: "Notification preferences updated.",
      body: {
        ...defaultNotificationPreferences,
        ...(req.body ?? {}),
      },
    });
  },
);

router.get(
  "/banks",
  requireAuth,
  requireRole("ORGANIZER"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Banks retrieved.",
      body: [
        { name: "Access Bank", code: "044" },
        { name: "First Bank of Nigeria", code: "011" },
        { name: "Guaranty Trust Bank", code: "058" },
        { name: "United Bank for Africa", code: "033" },
        { name: "Zenith Bank", code: "057" },
        { name: "Fidelity Bank", code: "070" },
        { name: "Stanbic IBTC Bank", code: "221" },
        { name: "Sterling Bank", code: "232" },
        { name: "Union Bank of Nigeria", code: "032" },
        { name: "Wema Bank", code: "035" },
      ],
    });
  },
);

router.post(
  "/resolve-account",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { accountNumber } = req.body ?? {};

      if (!accountNumber) {
        return res.status(400).json({
          success: false,
          message: "Account number is required.",
        });
      }

      const profile = await getProfile(req.user!.id);

      if (
        profile?.accountNumber &&
        String(profile.accountNumber) === String(accountNumber) &&
        profile.accountName
      ) {
        return res.status(200).json({
          success: true,
          message: "Account resolved from saved profile.",
          body: {
            accountName: profile.accountName,
          },
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Live bank account verification is not connected yet. Use the account already saved on your organizer profile.",
      });
    } catch (error) {
      console.error("Resolve account compatibility error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not resolve account.",
      });
    }
  },
);

export default router;
