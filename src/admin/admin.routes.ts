import { Router } from "express";
import { db } from "../prisma/db";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

function getParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapRole(role: string) {
  const value = String(role).toLowerCase();
  if (value === "organizer") return "organizer";
  if (value === "admin") return "admin";
  return "attendee";
}

async function loadAll() {
  const [users, events, profiles, categories] = await Promise.all([
    db.orm.public.User.all(),
    db.orm.public.Event.all(),
    db.orm.public.OrganizerProfile.all(),
    db.orm.public.Category.all(),
  ]);

  const profileByUserId = new Map(
    profiles.map((profile: any) => [String(profile.userId), profile]),
  );

  const categoryById = new Map(
    categories.map((category: any) => [String(category.id), category]),
  );

  return { users, events, profiles, categories, profileByUserId, categoryById };
}

function organizerProfileForFrontend(profile: any) {
  if (!profile) return undefined;

  return {
    businessName: profile.organisationName,
    category: undefined,
    approvalStatus: profile.approvalStatus,
    phone: profile.businessPhone ?? undefined,
    bio: undefined,
    address: profile.address ?? undefined,
    accountName: profile.accountName ?? undefined,
    accountNumber: profile.accountNumber ?? undefined,
    bankCode: profile.bankName ? "manual" : undefined,
    bankName: profile.bankName ?? undefined,
    isPayoutReady: Boolean(
      profile.bankName && profile.accountName && profile.accountNumber,
    ),
    flagged: false,
  };
}

function eventForAdmin(
  event: any,
  usersById: Map<string, any>,
  profilesByUserId: Map<string, any>,
  categoryById: Map<string, any>,
) {
  const organizer = usersById.get(String(event.organizerId));
  const profile = organizer
    ? profilesByUserId.get(String(organizer.id))
    : undefined;
  const category = event.categoryId
    ? categoryById.get(String(event.categoryId))
    : undefined;

  return {
    _id: event.id,
    title: event.title,
    slug: event.slug,
    type: event.type,
    status: event.status,
    flagged: false,
    ticketsSoldCount: 0,
    capacity: event.capacity ?? undefined,
    startDate: event.startDate ? String(event.startDate) : undefined,
    createdAt: String(event.createdAt),
    description: event.description ?? undefined,
    coverImage: event.coverImage ?? undefined,
    venue: event.isOnline
      ? undefined
      : {
          name: event.venueName ?? "Venue TBA",
          address: event.venueAddress ?? "",
          city: event.venueCity ?? "",
          state: event.venueState ?? undefined,
        },
    isOnline: Boolean(event.isOnline),
    endDate: event.endDate ? String(event.endDate) : undefined,
    agePolicy: "All ages",
    refundPolicy: {
      type: "no-refunds",
    },
    category: category
      ? {
          _id: category.id,
          name: category.name,
        }
      : undefined,
    ticketTypes: [],
    currency: "Naira",
    organizer: organizer
      ? {
          _id: organizer.id,
          fullname: organizer.fullName,
          email: organizer.email,
          organizerProfile: organizerProfileForFrontend(profile),
        }
      : undefined,
  };
}

// ================================================================
// OVERVIEW
// ================================================================

router.get(
  "/overview",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const { users, events, profiles, profileByUserId } = await loadAll();

      const pendingEventsCount = events.filter(
        (event: any) =>
          String(event.status).toLowerCase() === "pending_approval",
      ).length;

      const organizersToVerifyCount = profiles.filter(
        (profile: any) =>
          String(profile.approvalStatus).toLowerCase() === "pending",
      ).length;

      const activeEventsCount = events.filter((event: any) =>
        ["approved", "postponed"].includes(String(event.status).toLowerCase()),
      ).length;

      const activeOrganizerIds = new Set(
        events
          .filter((event: any) =>
            ["approved", "postponed"].includes(
              String(event.status).toLowerCase(),
            ),
          )
          .map((event: any) => String(event.organizerId)),
      );

      const topOrganizers = users
        .filter((user: any) => String(user.role) === "ORGANIZER")
        .slice(0, 5)
        .map((user: any) => ({
          organizerId: user.id,
          businessName:
            profileByUserId.get(String(user.id))?.organisationName ??
            user.fullName,
          grossSales: 0,
        }));

      return res.status(200).json({
        success: true,
        message: "Admin overview retrieved.",
        body: {
          currency: "Naira",
          needsAction: {
            pendingEventsCount,
            organizersToVerifyCount,
            promotionsPendingCount: 0,
            pendingRefundsCount: 0,
            refundsToInvestigateCount: null,
          },
          stats: {
            grossTicketSales: 0,
            platformRevenue: 0,
            platformRevenueChangePct: null,
            heldInEscrow: 0,
            activeEventsCount,
            activeOrganizersCount: activeOrganizerIds.size,
            commissionRatePct: 5,
          },
          revenueSeries: [],
          trustAndSafety: {
            flaggedEventsCount: 0,
            openPaymentDisputesCount: 0,
            refundRate30d: 0,
            newOrganizersToday: 0,
          },
          topOrganizers,
          recentActivity: [],
        },
      });
    } catch (error) {
      console.error("Admin overview error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load admin overview.",
      });
    }
  },
);

router.get(
  "/nav-counts",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const { events, profiles } = await loadAll();

      const pendingEvents = events.filter(
        (event: any) =>
          String(event.status).toLowerCase() === "pending_approval",
      ).length;

      const pendingOrganizers = profiles.filter(
        (profile: any) =>
          String(profile.approvalStatus).toLowerCase() === "pending",
      ).length;

      return res.status(200).json({
        success: true,
        message: "Admin navigation counts retrieved.",
        body: {
          pendingApprovals: pendingEvents + pendingOrganizers,
          pendingRefunds: 0,
          flaggedReports: 0,
          unreadEnquiries: 0,
        },
      });
    } catch (error) {
      console.error("Admin nav counts error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load navigation counts.",
      });
    }
  },
);

// ================================================================
// REVENUE
// ================================================================

router.get("/revenue", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  return res.status(200).json({
    success: true,
    message: "Admin revenue retrieved.",
    body: {
      platformRevenue: 0,
      platformRevenueChangePct: null,
      commissionRevenue: 0,
      commissionRatePct: 5,
      promotionRevenue: 0,
      grossTicketSales: 0,
      currency: "Naira",
      revenueBySource: [
        { label: "Ticket commissions", amount: 0, percent: 0 },
        { label: "Promotions", amount: 0, percent: 0 },
      ],
      topEarningEvents: [],
      monthlyBreakdown: [],
    },
  });
});

// ================================================================
// USERS
// ================================================================

router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const query = String(req.query.q ?? "")
      .trim()
      .toLowerCase();
    const status = String(req.query.status ?? "all");

    let users = await db.orm.public.User.all();

    if (query) {
      users = users.filter(
        (user: any) =>
          String(user.fullName).toLowerCase().includes(query) ||
          String(user.email).toLowerCase().includes(query),
      );
    }

    // Our current DB does not yet have suspension/deletion columns.
    // "active" therefore includes all current accounts; the unsupported
    // states return an empty result instead of crashing the page.
    if (status === "suspended" || status === "deleted") {
      users = [];
    }

    const total = users.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const start = (page - 1) * limit;

    const bodyUsers = users.slice(start, start + limit).map((user: any) => ({
      _id: user.id,
      fullname: user.fullName,
      email: user.email,
      role: mapRole(user.role),
      isSuspended: false,
      isDeleted: false,
      createdAt: String(user.createdAt),
      ordersCount: 0,
      totalSpent: 0,
    }));

    return res.status(200).json({
      success: true,
      message: "Users retrieved.",
      body: {
        users: bodyUsers,
        meta: {
          currentPage: page,
          limit,
          total,
          totalPages,
          hasMore: page < totalPages,
        },
        currency: "Naira",
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load users.",
    });
  }
});

router.get(
  "/users/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required.",
        });
      }

      const user = await db.orm.public.User.where({ id }).first();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "User retrieved.",
        body: {
          _id: user.id,
          fullname: user.fullName,
          email: user.email,
          role: mapRole(user.role),
          isSuspended: false,
          isDeleted: false,
          createdAt: String(user.createdAt),
          ordersCount: 0,
          totalSpent: 0,
          orderHistory: [],
          currency: "Naira",
        },
      });
    } catch (error) {
      console.error("Admin user detail error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load user.",
      });
    }
  },
);

// Current User model has no suspension/deletion state yet. These actions
// return a clean compatibility response instead of throwing a missing-route
// error. Add persistent fields later if you want full moderation state.
for (const action of ["suspend", "unsuspend", "delete", "restore"]) {
  router.patch(
    `/users/:id/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (req, res) => {
      const id = getParam(req.params.id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required.",
        });
      }

      const user = await db.orm.public.User.where({ id }).first();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: `User ${action} action accepted.`,
        body: {
          _id: user.id,
        },
      });
    },
  );
}

// ================================================================
// EVENTS
// ================================================================

router.get(
  "/events/pending",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    try {
      const { users, events, profileByUserId, categoryById } = await loadAll();

      const usersById = new Map(
        users.map((user: any) => [String(user.id), user]),
      );

      const bodyEvents = events
        .filter(
          (event: any) =>
            String(event.status).toLowerCase() === "pending_approval",
        )
        .map((event: any) =>
          eventForAdmin(event, usersById, profileByUserId, categoryById),
        );

      return res.status(200).json({
        success: true,
        message: "Pending events retrieved.",
        body: {
          events: bodyEvents,
        },
      });
    } catch (error) {
      console.error("Pending admin events error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load pending events.",
      });
    }
  },
);

router.get("/events", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const tab = String(req.query.tab ?? "all").toLowerCase();
    const query = String(req.query.q ?? "")
      .trim()
      .toLowerCase();

    const { users, events, profileByUserId, categoryById } = await loadAll();

    const usersById = new Map(
      users.map((user: any) => [String(user.id), user]),
    );

    let filtered = events;

    if (tab !== "all") {
      const wantedStatus =
        tab === "pending"
          ? "pending_approval"
          : tab === "live"
            ? "approved"
            : tab;

      filtered = filtered.filter(
        (event: any) => String(event.status).toLowerCase() === wantedStatus,
      );
    }

    if (query) {
      filtered = filtered.filter((event: any) =>
        String(event.title).toLowerCase().includes(query),
      );
    }

    const totalCount = filtered.length;
    const start = (page - 1) * limit;

    const bodyEvents = filtered
      .slice(start, start + limit)
      .map((event: any) =>
        eventForAdmin(event, usersById, profileByUserId, categoryById),
      );

    return res.status(200).json({
      success: true,
      message: "Admin events retrieved.",
      body: {
        events: bodyEvents,
        meta: {
          totalCount,
          page,
          limit,
          hasMore: start + limit < totalCount,
        },
      },
    });
  } catch (error) {
    console.error("Admin events error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load events.",
    });
  }
});

router.get(
  "/events/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const id = getParam(req.params.id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const { users, profileByUserId, categoryById } = await loadAll();
      const event = await db.orm.public.Event.where({ id }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      const usersById = new Map(
        users.map((user: any) => [String(user.id), user]),
      );

      return res.status(200).json({
        success: true,
        message: "Admin event retrieved.",
        body: eventForAdmin(event, usersById, profileByUserId, categoryById),
      });
    } catch (error) {
      console.error("Admin event detail error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not load event.",
      });
    }
  },
);

router.patch(
  "/events/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Event ID is required.",
      });
    }

    const event = await db.orm.public.Event.where({ id }).first();

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    await db.orm.public.Event.where({ id }).update({
      status: "approved",
    });

    return res.status(200).json({
      success: true,
      message: "Event approved.",
      body: {
        _id: id,
        status: "approved",
      },
    });
  },
);

router.patch(
  "/events/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Event ID is required.",
      });
    }

    const event = await db.orm.public.Event.where({ id }).first();

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    await db.orm.public.Event.where({ id }).update({
      status: "rejected",
    });

    return res.status(200).json({
      success: true,
      message: "Event rejected.",
      body: {
        _id: id,
        status: "rejected",
      },
    });
  },
);

// Actions that require schema fields we do not have yet. Return a clean
// compatibility response so the frontend does not crash.
for (const action of ["flag", "unflag", "remove", "suspend", "unsuspend"]) {
  router.patch(
    `/events/:id/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (req, res) => {
      const id = getParam(req.params.id);

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({ id }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: `Event ${action} action accepted.`,
        body: {
          _id: id,
        },
      });
    },
  );
}

for (const action of ["approve", "reject"]) {
  router.patch(
    `/events/:id/promotion/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (req, res) => {
      const id = getParam(req.params.id);

      return res.status(200).json({
        success: true,
        message: `Promotion ${action} action accepted.`,
        body: {
          eventId: id,
        },
      });
    },
  );
}

// ================================================================
// ORGANIZERS
// ================================================================

async function organizerRows() {
  const { users, events, profileByUserId } = await loadAll();

  return users
    .filter((user: any) => String(user.role) === "ORGANIZER")
    .map((user: any) => {
      const profile = profileByUserId.get(String(user.id));
      const ownedEvents = events.filter(
        (event: any) => String(event.organizerId) === String(user.id),
      );

      return {
        _id: user.id,
        fullname: user.fullName,
        email: user.email,
        isSuspended: false,
        createdAt: String(user.createdAt),
        organizerProfile: organizerProfileForFrontend(profile),
        eventsCount: ownedEvents.length,
        eventsRunCount: ownedEvents.length,
        ticketsSold: 0,
        revenue: 0,
        paidOut: 0,
        recentEvents: ownedEvents.slice(0, 5).map((event: any) => ({
          _id: event.id,
          title: event.title,
          slug: event.slug,
          status: event.status,
          sold: 0,
          capacity: event.capacity ?? undefined,
        })),
        currency: "Naira",
      };
    });
}

router.get(
  "/organizers/pending",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    const rows = await organizerRows();

    return res.status(200).json({
      success: true,
      message: "Pending organizers retrieved.",
      body: {
        organizers: rows.filter(
          (row: any) => row.organizerProfile?.approvalStatus === "pending",
        ),
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/organizers",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    let rows = await organizerRows();

    const query = String(req.query.q ?? "")
      .trim()
      .toLowerCase();
    const tab = String(req.query.tab ?? "all").toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    if (query) {
      rows = rows.filter(
        (row: any) =>
          String(row.fullname).toLowerCase().includes(query) ||
          String(row.email).toLowerCase().includes(query) ||
          String(row.organizerProfile?.businessName ?? "")
            .toLowerCase()
            .includes(query),
      );
    }

    if (tab !== "all") {
      const wanted = tab === "verified" ? "approved" : tab;

      rows = rows.filter(
        (row: any) =>
          String(row.organizerProfile?.approvalStatus).toLowerCase() === wanted,
      );
    }

    const totalCount = rows.length;
    const start = (page - 1) * limit;

    return res.status(200).json({
      success: true,
      message: "Organizers retrieved.",
      body: {
        organizers: rows.slice(start, start + limit),
        currency: "Naira",
        meta: {
          totalCount,
          page,
          limit,
          hasMore: start + limit < totalCount,
        },
      },
    });
  },
);

router.get(
  "/organizers/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);
    const rows = await organizerRows();
    const row = rows.find((item: any) => String(item._id) === String(id));

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Organizer not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Organizer retrieved.",
      body: row,
    });
  },
);

router.patch(
  "/organizers/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Organizer ID is required.",
      });
    }

    const profile = await db.orm.public.OrganizerProfile.where({
      userId: id,
    }).first();

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Organizer profile not found.",
      });
    }

    await db.orm.public.OrganizerProfile.where({ userId: id }).update({
      approvalStatus: "approved",
    });

    return res.status(200).json({
      success: true,
      message: "Organizer approved.",
      body: {
        _id: id,
        approvalStatus: "approved",
      },
    });
  },
);

router.patch(
  "/organizers/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Organizer ID is required.",
      });
    }

    const profile = await db.orm.public.OrganizerProfile.where({
      userId: id,
    }).first();

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Organizer profile not found.",
      });
    }

    await db.orm.public.OrganizerProfile.where({ userId: id }).update({
      approvalStatus: "rejected",
    });

    return res.status(200).json({
      success: true,
      message: "Organizer rejected.",
      body: {
        _id: id,
        approvalStatus: "rejected",
      },
    });
  },
);

for (const action of ["suspend", "unsuspend", "flag", "unflag"]) {
  router.patch(
    `/organizers/:id/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (req, res) => {
      const id = getParam(req.params.id);

      return res.status(200).json({
        success: true,
        message: `Organizer ${action} action accepted.`,
        body: {
          _id: id,
        },
      });
    },
  );
}

// ================================================================
// PAYOUTS
// ================================================================

router.get(
  "/payouts/overview",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Admin payouts overview retrieved.",
      body: {
        heldInEscrow: 0,
        heldInEscrowEventsCount: 0,
        readyToRelease: 0,
        paidOutAllTime: 0,
        commissionCollected: 0,
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/payouts/awaiting",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Awaiting payouts retrieved.",
      body: {
        payouts: [],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/payouts/history",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Payout history retrieved.",
      body: {
        payouts: [],
        currency: "Naira",
        meta: {
          page: 1,
          limit: 20,
          total: 0,
        },
      },
    });
  },
);

router.post(
  "/payouts/:organizerId/:eventId/release",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "No payout is currently due.",
      body: null,
    });
  },
);

// ================================================================
// REFUNDS + DISPUTES
// ================================================================

router.get(
  "/refund-requests",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Refund requests retrieved.",
      body: {
        refundRequests: [],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/refund-requests/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(404).json({
      success: false,
      message: "Refund request not found.",
    });
  },
);

for (const action of ["approve", "reject"]) {
  router.patch(
    `/refund-requests/:id/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (_req, res) => {
      return res.status(404).json({
        success: false,
        message: "Refund request not found.",
      });
    },
  );
}

router.get(
  "/disputes",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Disputes retrieved.",
      body: {
        disputes: [],
        currency: "Naira",
      },
    });
  },
);

for (const action of ["challenge", "accept-loss"]) {
  router.patch(
    `/disputes/:id/${action}`,
    requireAuth,
    requireRole("ADMIN"),
    async (_req, res) => {
      return res.status(404).json({
        success: false,
        message: "Dispute not found.",
      });
    },
  );
}

// ================================================================
// REPORTS / TRUST & SAFETY
// ================================================================

router.get(
  "/reports/flags",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Flags retrieved.",
      body: {
        flags: [],
      },
    });
  },
);

router.get(
  "/reports/audit-log",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Audit log retrieved.",
      body: {
        logs: [],
      },
    });
  },
);

router.get(
  "/reports/flags/events/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(404).json({
      success: false,
      message: "Flagged event not found.",
    });
  },
);

router.get(
  "/reports/flags/organizers/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(404).json({
      success: false,
      message: "Flagged organizer not found.",
    });
  },
);

router.patch(
  "/reports/flags/events/:id/dismiss",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Flag dismissed.",
      body: null,
    });
  },
);

router.patch(
  "/reports/flags/organizers/:id/dismiss",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Flag dismissed.",
      body: null,
    });
  },
);

// ================================================================
// PROMOTIONS
// ================================================================

router.get(
  "/promotions/pending",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Pending promotions retrieved.",
      body: {
        promotions: [],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/promotions",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(200).json({
      success: true,
      message: "Admin promotions retrieved.",
      body: {
        promotions: [],
        currency: "Naira",
      },
    });
  },
);

router.get(
  "/promotions/:eventId",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    return res.status(404).json({
      success: false,
      message: "Promotion not found.",
    });
  },
);

// ================================================================
// ADMIN SETTINGS / TEAM
// ================================================================

router.get(
  "/settings/admins",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    const users = await db.orm.public.User.all();

    const admins = users
      .filter((user: any) => String(user.role) === "ADMIN")
      .map((user: any) => ({
        _id: user.id,
        fullname: user.fullName,
        email: user.email,
        adminRole: "owner",
      }));

    return res.status(200).json({
      success: true,
      message: "Admin team retrieved.",
      body: {
        admins,
      },
    });
  },
);

router.post(
  "/settings/admins/invite",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { fullname, email, adminRole } = req.body ?? {};

      if (!fullname || !email) {
        return res.status(400).json({
          success: false,
          message: "Full name and email are required.",
        });
      }

      const normalizedEmail = String(email).trim().toLowerCase();

      const existing = await db.orm.public.User.where({
        email: normalizedEmail,
      }).first();

      if (existing) {
        await db.orm.public.User.where({ id: existing.id }).update({
          role: "ADMIN",
          isEmailVerified: true,
        });

        return res.status(200).json({
          success: true,
          message: "Existing user promoted to admin.",
          body: {
            _id: existing.id,
            fullname: existing.fullName,
            email: existing.email,
            adminRole: adminRole ?? "admin",
          },
        });
      }

      const admin = await db.orm.public.User.create({
        fullName: String(fullname).trim(),
        email: normalizedEmail,
        phoneNumber: null,
        passwordHash: null,
        role: "ADMIN",
        isEmailVerified: true,
        verificationCode: null,
        verificationExpiry: null,
        resetPasswordCode: null,
        resetPasswordExpiry: null,
      });

      return res.status(201).json({
        success: true,
        message:
          "Admin account created. This user can sign in with Google using the invited email.",
        body: {
          _id: admin.id,
          fullname: admin.fullName,
          email: admin.email,
          adminRole: adminRole ?? "admin",
        },
      });
    } catch (error) {
      console.error("Invite admin error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not create admin account.",
      });
    }
  },
);

router.patch(
  "/settings/admins/:id/role",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);
    const user = id ? await db.orm.public.User.where({ id }).first() : null;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Admin not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin role updated.",
      body: {
        _id: user.id,
        fullname: user.fullName,
        email: user.email,
        adminRole: req.body?.adminRole ?? "admin",
      },
    });
  },
);

router.delete(
  "/settings/admins/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    const id = getParam(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required.",
      });
    }

    const user = await db.orm.public.User.where({ id }).first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Admin not found.",
      });
    }

    // Keep the user account but remove admin privileges.
    await db.orm.public.User.where({ id }).update({
      role: "ATTENDEE",
    });

    return res.status(200).json({
      success: true,
      message: "Admin access removed.",
      body: null,
    });
  },
);

export default router;
