import { Router } from "express";
import { Temporal } from "@js-temporal/polyfill";
import { db } from "../prisma/db";
import {
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

// ========================================
// HELPERS
// ========================================

function makeSlug(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getParam(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getDatePart(value: unknown): string | null {
  if (!value) return null;

  const raw = String(value);

  if (raw.includes("T")) {
    return raw.split("T")[0] ?? null;
  }

  return raw;
}

function getTimePart(value: unknown): string | null {
  if (!value) return null;

  const raw = String(value);

  if (raw.includes("T")) {
    const time = raw.split("T")[1];
    return time ? time.slice(0, 5) : null;
  }

  return raw.slice(0, 5);
}

function toInstantFromLocalParts(
  datePart: string,
  timePart: string,
): Temporal.Instant | null {
  const parsed = new Date(`${datePart}T${timePart}:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return Temporal.Instant.from(parsed.toISOString());
}

function serializeEvent(event: any, category?: any) {
  const isOnline = Boolean(event.isOnline);

  return {
    _id: event.id,

    slug: event.slug,

    title: event.title,

    description: event.description ?? undefined,

    type: event.type,

    category: category
      ? {
          _id: category.id,
          name: category.name,
        }
      : null,

    coverImage: event.coverImage ?? undefined,

    venue: isOnline
      ? undefined
      : {
          name: event.venueName ?? "Venue TBA",

          address: event.venueAddress ?? "",

          city: event.venueCity ?? "",

          state: event.venueState ?? "",
        },

    startDate: event.startDate
      ? String(event.startDate)
      : new Date().toISOString(),

    endDate: event.endDate ? String(event.endDate) : undefined,

    minPrice: Number(event.minPrice ?? 0),

    isPromoted: Boolean(event.isPromoted),

    status: event.status,

    lineup: [],

    lineupCount: 0,

    reservationsCount: 0,

    ticketsSoldCount: 0,

    revenueTotal: 0,

    ticketTypes: [],

    createdAt: String(event.createdAt),

    updatedAt: event.updatedAt ? String(event.updatedAt) : undefined,

    capacity: event.capacity ?? null,

    trendingScore: 0,
  };
}

// ========================================
// GET PUBLIC EVENTS
// GET /api/v1/events
// ========================================

router.get("/", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 100);

    const allEvents = await db.orm.public.Event.all();

    const publicEvents = allEvents.filter((event: any) => {
      const status = String(event.status ?? "").toLowerCase();

      return status === "approved";
    });

    const allCategories = await db.orm.public.Category.all();

    const categoryMap = new Map(
      allCategories.map((category: any) => [String(category.id), category]),
    );

    const serializedEvents = publicEvents.map((event: any) =>
      serializeEvent(
        event,

        event.categoryId
          ? categoryMap.get(String(event.categoryId))
          : undefined,
      ),
    );

    const start = (page - 1) * limit;

    const paginatedEvents = serializedEvents.slice(start, start + limit);

    const total = serializedEvents.length;

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.status(200).json({
      success: true,

      message: "Events retrieved.",

      body: {
        events: paginatedEvents,

        currency: "Naira",

        meta: {
          currentPage: page,

          limit,

          total,

          totalPages,

          hasMore: page < totalPages,
        },
      },
    });
  } catch (error) {
    console.error("Get events error:", error);

    return res.status(500).json({
      success: false,

      message: "Could not retrieve events.",
    });
  }
});

// ========================================
// CREATE DRAFT EVENT
// POST /api/v1/events
// ========================================

router.post(
  "/",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const { type } = req.body as {
        type?: "free" | "paid";
      };

      if (!type || !["free", "paid"].includes(type)) {
        return res.status(400).json({
          success: false,

          message: "Event type must be free or paid.",
        });
      }

      const timestamp = Date.now();

      const event = await db.orm.public.Event.create({
        organizerId,

        title: "Untitled Event",

        slug: `untitled-event-${timestamp}`,

        type,

        status: "draft",

        description: null,

        categoryId: null,

        coverImage: null,

        startDate: null,

        endDate: null,

        isOnline: false,

        venueName: null,

        venueAddress: null,

        venueCity: null,

        venueState: null,

        venueCountry: null,

        capacity: null,

        minPrice: 0,

        isPromoted: false,
      });

      return res.status(201).json({
        success: true,

        message: "Draft event created.",

        body: {
          _id: event.id,

          slug: event.slug,

          type: event.type,

          status: event.status,
        },
      });
    } catch (error) {
      console.error("Create event error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not create event.",
      });
    }
  },
);

// ========================================
// GET ORGANIZER'S EVENTS
// GET /api/v1/events/mine
// ========================================

router.get(
  "/mine",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const allEvents = await db.orm.public.Event.all();

      const organizerEvents = allEvents.filter(
        (event: any) => String(event.organizerId) === String(organizerId),
      );

      const allCategories = await db.orm.public.Category.all();

      const categoryMap = new Map(
        allCategories.map((category: any) => [String(category.id), category]),
      );

      const events = organizerEvents.map((event: any) => {
        const category = event.categoryId
          ? categoryMap.get(String(event.categoryId))
          : null;

        return {
          _id: event.id,

          title: event.title ?? "Untitled Event",

          slug: event.slug,

          coverImage: event.coverImage ?? undefined,

          category: category
            ? {
                name: category.name,
              }
            : null,

          type: event.type,

          status: event.status,

          startDate: event.startDate ? String(event.startDate) : undefined,

          endDate: event.endDate ? String(event.endDate) : undefined,

          capacity: event.capacity ?? null,

          ticketsSoldCount: 0,

          reservationsCount: 0,

          revenueTotal: 0,
        };
      });

      return res.status(200).json({
        success: true,

        message: "Organizer events retrieved.",

        body: {
          events,

          meta: {
            total: events.length,
          },

          currency: "Naira",
        },
      });
    } catch (error) {
      console.error("Get organizer events error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not retrieve organizer events.",
      });
    }
  },
);

// ========================================
// GET ORGANIZER EVENT BY ID
// GET /api/v1/events/mine/:eventId
// ========================================

router.get(
  "/mine/:eventId",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,

          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,

          message: "Event not found.",
        });
      }

      let category = null;

      if (event.categoryId) {
        category = await db.orm.public.Category.where({
          id: event.categoryId,
        }).first();
      }

      return res.status(200).json({
        success: true,

        message: "Event retrieved.",

        body: serializeEvent(event, category),
      });
    } catch (error) {
      console.error("Get organizer event error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not retrieve event.",
      });
    }
  },
);

// ========================================
// UPDATE EVENT
// PATCH /api/v1/events/:eventId
// ========================================

router.patch(
  "/:eventId",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,

          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,

          message: "Event not found.",
        });
      }

      const payload = req.body as Record<string, unknown>;

      const updateData: Record<string, unknown> = {};

      // ========================================
      // TITLE
      // ========================================

      if (payload.title !== undefined) {
        const title = String(payload.title).trim();

        updateData.title = title;

        if (title) {
          const baseSlug = makeSlug(title);

          updateData.slug = `${baseSlug}-${event.id.slice(-6).toLowerCase()}`;
        }
      }

      // ========================================
      // DESCRIPTION
      // ========================================

      if (payload.description !== undefined) {
        updateData.description = String(payload.description).trim() || null;
      }

      // ========================================
      // CATEGORY
      // ========================================

      if (payload.category !== undefined) {
        const categoryValue = String(payload.category).trim();

        let category = null;

        if (isUuid(categoryValue)) {
          category = await db.orm.public.Category.where({
            id: categoryValue,
          }).first();
        }

        if (!category) {
          category = await db.orm.public.Category.where({
            name: categoryValue,
          }).first();
        }

        if (!category) {
          category = await db.orm.public.Category.where({
            slug: categoryValue.toLowerCase(),
          }).first();
        }

        if (!category) {
          return res.status(400).json({
            success: false,

            message: "Selected category was not found.",
          });
        }

        updateData.categoryId = category.id;
      }

      // ========================================
      // COVER IMAGE
      // ========================================

      if (payload.coverImage !== undefined) {
        updateData.coverImage = String(payload.coverImage).trim() || null;
      }

      // ========================================
      // EVENT DATE + TIMES
      // ========================================

      if (payload.date !== undefined) {
        const datePart = getDatePart(payload.date);

        const startTimePart = getTimePart(payload.startTime) ?? "00:00";

        const endTimePart = getTimePart(payload.endTime) ?? startTimePart;

        if (!datePart) {
          return res.status(400).json({
            success: false,
            message: "Invalid event date.",
          });
        }

        const startInstant = toInstantFromLocalParts(datePart, startTimePart);

        const endInstant = toInstantFromLocalParts(datePart, endTimePart);

        if (!startInstant) {
          return res.status(400).json({
            success: false,
            message: "Invalid event start date or time.",
          });
        }

        if (!endInstant) {
          return res.status(400).json({
            success: false,
            message: "Invalid event end date or time.",
          });
        }

        updateData.startDate = startInstant;

        updateData.endDate = endInstant;
      }

      // ========================================
      // START TIME ONLY
      // ========================================

      if (
        payload.startTime !== undefined &&
        payload.date === undefined &&
        event.startDate
      ) {
        const existingDate = String(event.startDate).split("T")[0];

        const startTimePart = getTimePart(payload.startTime);

        if (existingDate && startTimePart) {
          const startInstant = toInstantFromLocalParts(
            existingDate,
            startTimePart,
          );

          if (startInstant) {
            updateData.startDate = startInstant;
          }
        }
      }

      // ========================================
      // END TIME ONLY
      // ========================================

      if (
        payload.endTime !== undefined &&
        payload.date === undefined &&
        event.endDate
      ) {
        const existingDate = String(event.endDate).split("T")[0];

        const endTimePart = getTimePart(payload.endTime);

        if (existingDate && endTimePart) {
          const endInstant = toInstantFromLocalParts(existingDate, endTimePart);

          if (endInstant) {
            updateData.endDate = endInstant;
          }
        }
      }

      // ========================================
      // LOCATION
      // ========================================

      if (payload.locationType !== undefined) {
        updateData.isOnline = String(payload.locationType) === "online";
      }

      if (payload.venueName !== undefined) {
        updateData.venueName = String(payload.venueName).trim() || null;
      }

      if (payload.address !== undefined) {
        updateData.venueAddress = String(payload.address).trim() || null;
      }

      if (payload.city !== undefined) {
        updateData.venueCity = String(payload.city).trim() || null;
      }

      if (payload.state !== undefined) {
        updateData.venueState = String(payload.state).trim() || null;
      }

      // ========================================
      // RSVP LIMIT
      // ========================================

      if (payload.rsvpLimit !== undefined) {
        const capacity = Number(payload.rsvpLimit);

        if (!Number.isNaN(capacity)) {
          updateData.capacity = capacity;
        }
      }

      // ========================================
      // EVENT TYPE
      // ========================================

      if (payload.eventType !== undefined) {
        const eventType = String(payload.eventType);

        if (eventType === "free" || eventType === "paid") {
          updateData.type = eventType;
        }
      }

      // ========================================
      // SAVE
      // ========================================

      if (Object.keys(updateData).length > 0) {
        await db.orm.public.Event.where({
          id: eventId,
          organizerId,
        }).update(updateData);
      }

      const updatedEvent = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!updatedEvent) {
        return res.status(404).json({
          success: false,

          message: "Event not found after update.",
        });
      }

      let category = null;

      if (updatedEvent.categoryId) {
        category = await db.orm.public.Category.where({
          id: updatedEvent.categoryId,
        }).first();
      }

      return res.status(200).json({
        success: true,

        message: "Event updated.",

        body: serializeEvent(updatedEvent, category),
      });
    } catch (error) {
      console.error("Update event error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not update event.",
      });
    }
  },
);

// ========================================
// EVENT DASHBOARD DETAILS
// GET /api/v1/events/:eventId/dashboard
// ========================================

router.get(
  "/:eventId/dashboard",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      let category = null;

      if (event.categoryId) {
        category = await db.orm.public.Category.where({
          id: event.categoryId,
        }).first();
      }

      return res.status(200).json({
        success: true,
        message: "Event dashboard retrieved.",
        body: {
          event: {
            _id: event.id,
            title: event.title,
            slug: event.slug,
            status: event.status,
            type: event.type,
            category: category?.name ?? null,
            coverImage: event.coverImage ?? undefined,
            startDate: event.startDate
              ? String(event.startDate)
              : new Date().toISOString(),
            isOnline: Boolean(event.isOnline),
            venue: event.isOnline
              ? null
              : {
                  name: event.venueName ?? "Venue TBA",
                  city: event.venueCity ?? "",
                },
            isPromoted: Boolean(event.isPromoted),
            promotionStatus: undefined,
          },
          reservationsCount: 0,
          capacity: event.capacity ?? null,
          capacityRemaining: event.capacity ?? null,
          ticketsSoldCount: 0,
          revenueTotal: 0,
          checkedInCount: 0,
          recentAttendees: [],
          ticketTypes: [],
          payout: {
            amountDue: 0,
          },
          currency: "Naira",
        },
      });
    } catch (error) {
      console.error("Get event dashboard error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve event dashboard.",
      });
    }
  },
);

// ========================================
// EVENT ATTENDEES
// GET /api/v1/events/:eventId/attendees
// ========================================

router.get(
  "/:eventId/attendees",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Attendees retrieved.",
        body: {
          tickets: [],
          stats: {
            total: 0,
            checkedIn: 0,
            notIn: 0,
          },
        },
      });
    } catch (error) {
      console.error("Get attendees error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve attendees.",
      });
    }
  },
);

// ========================================
// EVENT TICKET TYPES
// GET /api/v1/events/:eventId/ticket-types
// ========================================

router.get(
  "/:eventId/ticket-types",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Ticket types retrieved.",
        body: [],
      });
    } catch (error) {
      console.error("Get ticket types error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not retrieve ticket types.",
      });
    }
  },
);

// ========================================
// CHECK-IN
// POST /api/v1/events/:eventId/check-in
// ========================================

router.post(
  "/:eventId/check-in",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Ticket checked.",
        body: {
          result: "invalid",
          checkedInAt: null,
        },
      });
    } catch (error) {
      console.error("Check-in error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not check ticket.",
      });
    }
  },
);

// ========================================
// DELETE EVENT
// DELETE /api/v1/events/:eventId
// ========================================

router.delete(
  "/:eventId",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).delete();

      return res.status(200).json({
        success: true,
        message: "Event deleted.",
        body: null,
      });
    } catch (error) {
      console.error("Delete event error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not delete event.",
      });
    }
  },
);

// ========================================
// DUPLICATE EVENT
// POST /api/v1/events/:eventId/duplicate
// ========================================

router.post(
  "/:eventId/duplicate",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      const original = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!original) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      const copy = await db.orm.public.Event.create({
        organizerId,
        categoryId: original.categoryId ?? null,
        title: `${original.title} Copy`,
        slug: `${makeSlug(original.title)}-copy-${Date.now()}`,
        description: original.description ?? null,
        type: original.type,
        status: "draft",
        coverImage: original.coverImage ?? null,
        startDate: null,
        endDate: null,
        isOnline: Boolean(original.isOnline),
        venueName: original.venueName ?? null,
        venueAddress: original.venueAddress ?? null,
        venueCity: original.venueCity ?? null,
        venueState: original.venueState ?? null,
        venueCountry: original.venueCountry ?? null,
        capacity: original.capacity ?? null,
        minPrice: Number(original.minPrice ?? 0),
        isPromoted: false,
      });

      return res.status(201).json({
        success: true,
        message: "Event duplicated.",
        body: {
          _id: copy.id,
        },
      });
    } catch (error) {
      console.error("Duplicate event error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not duplicate event.",
      });
    }
  },
);

// ========================================
// SUBMIT EVENT FOR APPROVAL
// POST /api/v1/events/:eventId/submit
// ========================================

router.post(
  "/:eventId/submit",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,

          message: "Event ID is required.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,

          message: "Event not found.",
        });
      }

      if (!event.title || event.title === "Untitled Event") {
        return res.status(400).json({
          success: false,

          message: "Add an event title before submitting.",
        });
      }

      if (!event.categoryId) {
        return res.status(400).json({
          success: false,

          message: "Select an event category before submitting.",
        });
      }

      if (!event.startDate) {
        return res.status(400).json({
          success: false,

          message: "Add an event date before submitting.",
        });
      }

      if (!event.description) {
        return res.status(400).json({
          success: false,

          message: "Add an event description before submitting.",
        });
      }

      if (!event.coverImage) {
        return res.status(400).json({
          success: false,

          message: "Add a cover image before submitting.",
        });
      }

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update({
        status: "pending_approval",
      });

      return res.status(200).json({
        success: true,

        message: "Event submitted for admin approval.",

        body: {
          message: "Event submitted for admin approval.",
        },
      });
    } catch (error) {
      console.error("Submit event error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not submit event for approval.",
      });
    }
  },
);

// ========================================
// GET PUBLIC EVENT BY SLUG
// GET /api/v1/events/:slug
// ========================================

router.get("/:slug", async (req, res) => {
  try {
    const slug = getParam(req.params.slug);

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Event slug is required.",
      });
    }

    const event = await db.orm.public.Event.where({ slug }).first();

    if (!event || String(event.status).toLowerCase() !== "approved") {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    let category = null;

    if (event.categoryId) {
      category = await db.orm.public.Category.where({
        id: event.categoryId,
      }).first();
    }

    return res.status(200).json({
      success: true,
      message: "Event retrieved.",
      body: serializeEvent(event, category),
    });
  } catch (error) {
    console.error("Get public event error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve event.",
    });
  }
});

export default router;
