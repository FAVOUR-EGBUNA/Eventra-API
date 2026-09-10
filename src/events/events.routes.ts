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

function serializeTicketType(ticketType: any) {
  const quantity = Number(ticketType.quantity ?? 0);

  const quantitySold = Number(ticketType.quantitySold ?? 0);

  const quantityRemaining = Math.max(quantity - quantitySold, 0);

  return {
    _id: ticketType.id,
    id: ticketType.id,

    name: ticketType.name,

    description: ticketType.description ?? undefined,

    price: Number(ticketType.price ?? 0),

    quantity,

    quantitySold,

    // Frontend dashboard expects quantityRemaining.
    // Keep available too because attendee-facing ticket UI already uses it.
    quantityRemaining,

    purchaseLimitPerPerson: 10,

    available: quantityRemaining,

    isActive: Boolean(ticketType.isActive),
  };
}

async function getEventTicketTypes(eventId: string) {
  const allTicketTypes = await db.orm.public.TicketType.all();

  return allTicketTypes.filter(
    (ticketType: any) =>
      String(ticketType.eventId) === String(eventId) &&
      Boolean(ticketType.isActive),
  );
}

async function ensureFreeTicketType(event: any) {
  const existingTicketTypes = await getEventTicketTypes(String(event.id));

  if (existingTicketTypes.length > 0) {
    return existingTicketTypes;
  }

  if (String(event.type).toLowerCase() !== "free") {
    return existingTicketTypes;
  }

  const quantity =
    event.capacity && Number(event.capacity) > 0
      ? Number(event.capacity)
      : 1000;

  const freeTicket = await db.orm.public.TicketType.create({
    eventId: event.id,

    name: "Free Ticket",

    description: "General admission",

    price: 0,

    quantity,

    quantitySold: 0,

    isActive: true,
  });

  return [freeTicket];
}

async function getEventTicketStats(eventId: string) {
  const allTickets = await db.orm.public.Ticket.all();

  const eventTickets = allTickets.filter(
    (ticket: any) =>
      String(ticket.eventId) === String(eventId) &&
      String(ticket.status).toLowerCase() !== "cancelled" &&
      String(ticket.status).toLowerCase() !== "refunded",
  );

  const allOrders = await db.orm.public.Order.all();

  const completedOrders = allOrders.filter(
    (order: any) =>
      String(order.eventId) === String(eventId) &&
      String(order.status).toLowerCase() === "completed",
  );

  const revenueTotal = completedOrders.reduce(
    (total: number, order: any) => total + Number(order.total ?? 0),
    0,
  );

  const checkedInCount = eventTickets.filter(
    (ticket: any) =>
      String(ticket.status).toLowerCase() === "used" ||
      Boolean(ticket.checkedInAt),
  ).length;

  return {
    tickets: eventTickets,

    reservationsCount: completedOrders.length,

    ticketsSoldCount: eventTickets.length,

    revenueTotal,

    checkedInCount,
  };
}

function serializeEvent(
  event: any,
  category?: any,
  ticketTypes: any[] = [],
  stats?: {
    reservationsCount: number;
    ticketsSoldCount: number;
    revenueTotal: number;
  },
) {
  const isOnline = Boolean(event.isOnline);

  const serializedTicketTypes = ticketTypes.map(serializeTicketType);

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

    reservationsCount: stats?.reservationsCount ?? 0,

    ticketsSoldCount: stats?.ticketsSoldCount ?? 0,

    revenueTotal: stats?.revenueTotal ?? 0,

    ticketTypes: serializedTicketTypes,

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

    const search = getParam(req.query.q as string | string[] | undefined)
      ?.trim()
      .toLowerCase();

    const city = getParam(req.query.city as string | string[] | undefined)
      ?.trim()
      .toLowerCase();

    const categoryParam = getParam(
      req.query.category as string | string[] | undefined,
    );

    const type = getParam(
      req.query.type as string | string[] | undefined,
    )?.toLowerCase();

    const when = getParam(
      req.query.when as string | string[] | undefined,
    )?.toLowerCase();

    const sort = getParam(
      req.query.sort as string | string[] | undefined,
    )?.toLowerCase();

    const minPriceParam = getParam(
      req.query.minPrice as string | string[] | undefined,
    );

    const maxPriceParam = getParam(
      req.query.maxPrice as string | string[] | undefined,
    );

    const minPrice =
      minPriceParam !== null && minPriceParam !== ""
        ? Number(minPriceParam)
        : null;

    const maxPrice =
      maxPriceParam !== null && maxPriceParam !== ""
        ? Number(maxPriceParam)
        : null;

    const categoryIds = categoryParam
      ? categoryParam
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    const allEvents = await db.orm.public.Event.all();
    const allCategories = await db.orm.public.Category.all();

    const categoryMap = new Map(
      allCategories.map((category: any) => [String(category.id), category]),
    );

    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay();

    const daysUntilMonday = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(startOfWeek.getDate() + daysUntilMonday);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfWeekend = new Date(startOfWeek);
    startOfWeekend.setDate(startOfWeekend.getDate() + 5);
    startOfWeekend.setHours(0, 0, 0, 0);

    const endOfWeekend = new Date(startOfWeek);
    endOfWeekend.setDate(endOfWeekend.getDate() + 6);
    endOfWeekend.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    let filteredEvents = allEvents.filter((event: any) => {
      const status = String(event.status ?? "").toLowerCase();

      if (status !== "approved") {
        return false;
      }

      // -------------------------------
      // CATEGORY
      // -------------------------------
      if (
        categoryIds.length > 0 &&
        !categoryIds.includes(String(event.categoryId ?? ""))
      ) {
        return false;
      }

      // -------------------------------
      // FREE / PAID
      // -------------------------------
      if (
        type &&
        ["free", "paid"].includes(type) &&
        String(event.type ?? "").toLowerCase() !== type
      ) {
        return false;
      }

      // -------------------------------
      // LOCATION
      // -------------------------------
      if (city && city !== "all") {
        const eventCity = String(event.venueCity ?? "").toLowerCase();
        const eventState = String(event.venueState ?? "").toLowerCase();

        if (!eventCity.includes(city) && !eventState.includes(city)) {
          return false;
        }
      }

      // -------------------------------
      // SEARCH
      // -------------------------------
      if (search) {
        const category = event.categoryId
          ? categoryMap.get(String(event.categoryId))
          : null;

        const haystack = [
          event.title,
          event.description,
          event.venueName,
          event.venueCity,
          event.venueState,
          category?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) {
          return false;
        }
      }

      // -------------------------------
      // PRICE
      // -------------------------------
      const eventPrice = Number(event.minPrice ?? 0);

      if (
        minPrice !== null &&
        Number.isFinite(minPrice) &&
        eventPrice < minPrice
      ) {
        return false;
      }

      if (
        maxPrice !== null &&
        Number.isFinite(maxPrice) &&
        eventPrice > maxPrice
      ) {
        return false;
      }

      // -------------------------------
      // DATE
      // -------------------------------
      if (when) {
        const eventDate = new Date(String(event.startDate));

        if (Number.isNaN(eventDate.getTime())) {
          return false;
        }

        if (
          when === "today" &&
          (eventDate < startOfToday || eventDate > endOfToday)
        ) {
          return false;
        }

        if (
          when === "this-week" &&
          (eventDate < startOfWeek || eventDate > endOfWeek)
        ) {
          return false;
        }

        if (
          when === "this-weekend" &&
          (eventDate < startOfWeekend || eventDate > endOfWeekend)
        ) {
          return false;
        }

        if (
          when === "this-month" &&
          (eventDate < startOfMonth || eventDate > endOfMonth)
        ) {
          return false;
        }
      }

      return true;
    });

    // -------------------------------
    // SORTING
    // -------------------------------
    if (sort === "date") {
      filteredEvents.sort((a: any, b: any) => {
        return (
          new Date(String(a.startDate)).getTime() -
          new Date(String(b.startDate)).getTime()
        );
      });
    } else if (sort === "price-asc") {
      filteredEvents.sort(
        (a: any, b: any) => Number(a.minPrice ?? 0) - Number(b.minPrice ?? 0),
      );
    } else if (sort === "price-desc") {
      filteredEvents.sort(
        (a: any, b: any) => Number(b.minPrice ?? 0) - Number(a.minPrice ?? 0),
      );
    } else {
      // Trending/default:
      // promoted events first, then newest-created events.
      filteredEvents.sort((a: any, b: any) => {
        const promotedDifference =
          Number(Boolean(b.isPromoted)) - Number(Boolean(a.isPromoted));

        if (promotedDifference !== 0) {
          return promotedDifference;
        }

        return (
          new Date(String(b.createdAt)).getTime() -
          new Date(String(a.createdAt)).getTime()
        );
      });
    }

    const serializedEvents = filteredEvents.map((event: any) =>
      serializeEvent(
        event,
        event.categoryId
          ? categoryMap.get(String(event.categoryId))
          : undefined,
      ),
    );

    const total = serializedEvents.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const start = (page - 1) * limit;
    const paginatedEvents = serializedEvents.slice(start, start + limit);

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

      const allTickets = await db.orm.public.Ticket.all();

      const allOrders = await db.orm.public.Order.all();

      const events = organizerEvents.map((event: any) => {
        const category = event.categoryId
          ? categoryMap.get(String(event.categoryId))
          : null;

        const eventTickets = allTickets.filter(
          (ticket: any) =>
            String(ticket.eventId) === String(event.id) &&
            !["cancelled", "refunded"].includes(
              String(ticket.status).toLowerCase(),
            ),
        );

        const completedOrders = allOrders.filter(
          (order: any) =>
            String(order.eventId) === String(event.id) &&
            String(order.status).toLowerCase() === "completed",
        );

        const revenueTotal = completedOrders.reduce(
          (total: number, order: any) => total + Number(order.total ?? 0),
          0,
        );

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

          ticketsSoldCount: eventTickets.length,

          reservationsCount: completedOrders.length,

          revenueTotal,
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

      const ticketTypes = await getEventTicketTypes(eventId);

      const stats = await getEventTicketStats(eventId);

      return res.status(200).json({
        success: true,

        message: "Event retrieved.",

        body: serializeEvent(event, category, ticketTypes, stats),
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

      // Current frontend sends:
      // {
      //   isOnline: boolean,
      //   venue: { name, address, city, state }
      // }
      //
      // Older frontend code may still send:
      // {
      //   locationType,
      //   venueName,
      //   address,
      //   city,
      //   state
      // }
      //
      // Support both shapes so existing flows do not break.

      if (payload.isOnline !== undefined) {
        updateData.isOnline = Boolean(payload.isOnline);
      } else if (payload.locationType !== undefined) {
        updateData.isOnline = String(payload.locationType) === "online";
      }

      const nestedVenue =
        payload.venue &&
        typeof payload.venue === "object" &&
        !Array.isArray(payload.venue)
          ? (payload.venue as Record<string, unknown>)
          : null;

      if (nestedVenue) {
        if (nestedVenue.name !== undefined) {
          updateData.venueName = String(nestedVenue.name).trim() || null;
        }

        if (nestedVenue.address !== undefined) {
          updateData.venueAddress = String(nestedVenue.address).trim() || null;
        }

        if (nestedVenue.city !== undefined) {
          updateData.venueCity = String(nestedVenue.city).trim() || null;
        }

        if (nestedVenue.state !== undefined) {
          updateData.venueState = String(nestedVenue.state).trim() || null;
        }
      }

      // Backward-compatible flat location fields.
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

      // If the event is switched to online, clear stale physical venue data.
      if (updateData.isOnline === true) {
        updateData.venueName = null;
        updateData.venueAddress = null;
        updateData.venueCity = null;
        updateData.venueState = null;
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

      const ticketTypes = await getEventTicketTypes(eventId);

      const stats = await getEventTicketStats(eventId);

      return res.status(200).json({
        success: true,

        message: "Event updated.",

        body: serializeEvent(updatedEvent, category, ticketTypes, stats),
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
// POSTPONE EVENT
// PATCH /api/v1/events/:eventId/postpone
// ========================================

router.patch(
  "/:eventId/postpone",
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

      const currentStatus = String(event.status ?? "").toLowerCase();

      if (!["approved", "postponed"].includes(currentStatus)) {
        return res.status(400).json({
          success: false,
          message: "Only a live event can be postponed.",
        });
      }

      const newStartDateRaw =
        req.body?.newStartDate ?? req.body?.startDate ?? req.body?.date;

      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      if (!newStartDateRaw) {
        return res.status(400).json({
          success: false,
          message: "A new event date is required.",
        });
      }

      const oldStartDate = event.startDate
        ? new Date(String(event.startDate))
        : null;

      const oldEndDate = event.endDate ? new Date(String(event.endDate)) : null;

      if (!oldStartDate || Number.isNaN(oldStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "The event does not have a valid current start date.",
        });
      }

      const newDatePart = getDatePart(newStartDateRaw);

      if (!newDatePart) {
        return res.status(400).json({
          success: false,
          message: "Invalid new event date.",
        });
      }

      const hours = String(oldStartDate.getHours()).padStart(2, "0");
      const minutes = String(oldStartDate.getMinutes()).padStart(2, "0");

      const newStartInstant = toInstantFromLocalParts(
        newDatePart,
        `${hours}:${minutes}`,
      );

      if (!newStartInstant) {
        return res.status(400).json({
          success: false,
          message: "Invalid new event date.",
        });
      }

      const newStartAsDate = new Date(newStartInstant.toString());

      if (newStartAsDate.getTime() <= Date.now()) {
        return res.status(400).json({
          success: false,
          message: "The new event date must be in the future.",
        });
      }

      let newEndInstant: Temporal.Instant | null = null;

      if (oldEndDate && !Number.isNaN(oldEndDate.getTime())) {
        const durationMs = oldEndDate.getTime() - oldStartDate.getTime();

        if (durationMs > 0) {
          const newEndDate = new Date(newStartAsDate.getTime() + durationMs);

          newEndInstant = Temporal.Instant.from(newEndDate.toISOString());
        }
      }

      const updateData: Record<string, unknown> = {
        startDate: newStartInstant,
        status: "postponed",
      };

      if (newEndInstant) {
        updateData.endDate = newEndInstant;
      }

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update(updateData);

      const updatedEvent = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      if (!updatedEvent) {
        return res.status(404).json({
          success: false,
          message: "Event not found after postponement.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Event postponed successfully.",
        body: {
          _id: updatedEvent.id,
          status: updatedEvent.status,
          startDate: updatedEvent.startDate
            ? String(updatedEvent.startDate)
            : undefined,
          endDate: updatedEvent.endDate
            ? String(updatedEvent.endDate)
            : undefined,
          reason: reason || undefined,
        },
      });
    } catch (error) {
      console.error("Postpone event error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not postpone event.",
      });
    }
  },
);

// ========================================
// CANCEL EVENT
// PATCH /api/v1/events/:eventId/cancel
// ========================================

router.patch(
  "/:eventId/cancel",
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

      const currentStatus = String(event.status ?? "").toLowerCase();

      if (currentStatus === "cancelled") {
        return res.status(400).json({
          success: false,
          message: "This event has already been cancelled.",
        });
      }

      if (!["approved", "postponed"].includes(currentStatus)) {
        return res.status(400).json({
          success: false,
          message: "Only a live or postponed event can be cancelled.",
        });
      }

      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

      if (!reason) {
        return res.status(400).json({
          success: false,
          message: "Please provide a reason for cancelling the event.",
        });
      }

      // Cancel the event first. Public event listing/detail endpoints only
      // expose approved events, so this immediately stops further sales/RSVPs.
      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update({
        status: "cancelled",
      });

      const allTickets = await db.orm.public.Ticket.all();

      const affectedTickets = allTickets.filter(
        (ticket: any) =>
          String(ticket.eventId) === String(eventId) &&
          !["cancelled", "refunded"].includes(
            String(ticket.status ?? "").toLowerCase(),
          ),
      );

      const paidEvent = String(event.type ?? "").toLowerCase() === "paid";

      // Demo payment flow:
      // paid tickets are marked refunded to simulate an automatic refund;
      // free reservations are simply cancelled. No real Paystack money is
      // moved because checkout itself is demo-only.
      for (const ticket of affectedTickets) {
        await db.orm.public.Ticket.where({
          id: ticket.id,
        }).update({
          status: paidEvent ? "refunded" : "cancelled",
        });
      }

      const updatedEvent = await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).first();

      return res.status(200).json({
        success: true,
        message: paidEvent
          ? "Event cancelled. Paid tickets were marked as refunded in demo mode."
          : "Event cancelled. Existing reservations were cancelled.",
        body: {
          _id: updatedEvent?.id ?? eventId,
          status: "cancelled",
          reason,
          affectedTickets: affectedTickets.length,
          demoRefunds: paidEvent ? affectedTickets.length : 0,
        },
      });
    } catch (error) {
      console.error("Cancel event error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not cancel event.",
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

      const ticketTypes = await getEventTicketTypes(eventId);

      const stats = await getEventTicketStats(eventId);

      const capacity = event.capacity ?? null;

      const capacityRemaining =
        capacity === null
          ? null
          : Math.max(Number(capacity) - stats.ticketsSoldCount, 0);

      const recentTickets = stats.tickets
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(String(b.createdAt)).getTime() -
            new Date(String(a.createdAt)).getTime(),
        )
        .slice(0, 5);

      const ticketTypesForRecentAttendees = await getEventTicketTypes(eventId);

      const recentTicketTypeMap = new Map(
        ticketTypesForRecentAttendees.map((ticketType: any) => [
          String(ticketType.id),
          ticketType,
        ]),
      );

      const recentAttendees = recentTickets.map((ticket: any) => {
        const ticketType = recentTicketTypeMap.get(String(ticket.ticketTypeId));
        const rawStatus = String(ticket.status ?? "").toLowerCase();
        const checkedIn = rawStatus === "used" || Boolean(ticket.checkedInAt);

        let frontendStatus: "valid" | "checked_in" | "cancelled" | "refunded" =
          "valid";

        if (checkedIn) {
          frontendStatus = "checked_in";
        } else if (rawStatus === "cancelled") {
          frontendStatus = "cancelled";
        } else if (rawStatus === "refunded") {
          frontendStatus = "refunded";
        }

        return {
          _id: ticket.id,

          attendeeName: ticket.guestName ?? ticket.guestEmail ?? "Attendee",

          attendeeEmail: ticket.guestEmail ?? "",

          code: ticket.ticketCode,

          ticketId: ticket.ticketCode,

          status: frontendStatus,

          ticketTypeName: ticketType?.name ?? "General admission",

          checkedInAt: ticket.checkedInAt ? String(ticket.checkedInAt) : null,
        };
      });

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

          reservationsCount: stats.reservationsCount,

          capacity,

          capacityRemaining,

          ticketsSoldCount: stats.ticketsSoldCount,

          revenueTotal: stats.revenueTotal,

          checkedInCount: stats.checkedInCount,

          recentAttendees,

          ticketTypes: ticketTypes.map(serializeTicketType),

          payout: {
            amountDue: stats.revenueTotal,
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
// ORGANIZER EVENT ATTENDEES
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

      const stats = await getEventTicketStats(eventId);
      const ticketTypes = await getEventTicketTypes(eventId);

      const ticketTypeMap = new Map(
        ticketTypes.map((ticketType: any) => [
          String(ticketType.id),
          ticketType,
        ]),
      );

      const eventType =
        String(event.type).toLowerCase() === "paid" ? "paid" : "free";

      const tickets = stats.tickets.map((ticket: any) => {
        const ticketType = ticketTypeMap.get(String(ticket.ticketTypeId));

        const rawStatus = String(ticket.status ?? "").toLowerCase();

        const checkedIn = rawStatus === "used" || Boolean(ticket.checkedInAt);

        let frontendStatus: "valid" | "checked_in" | "cancelled" | "refunded" =
          "valid";

        if (checkedIn) {
          frontendStatus = "checked_in";
        } else if (rawStatus === "cancelled") {
          frontendStatus = "cancelled";
        } else if (rawStatus === "refunded") {
          frontendStatus = "refunded";
        }

        return {
          _id: ticket.id,
          id: ticket.id,

          code: ticket.ticketCode,

          // Required by Attendees page
          ticketId: ticket.ticketCode,

          type: eventType,

          price: Number(ticketType?.price ?? 0),

          attendeeName: ticket.guestName ?? ticket.guestEmail ?? "Attendee",

          attendeeEmail: ticket.guestEmail ?? "",

          status: frontendStatus,

          checkedInAt: ticket.checkedInAt ? String(ticket.checkedInAt) : null,

          // Required by Attendees page
          issuedAt: String(ticket.createdAt),

          ticketType: ticketType
            ? {
                _id: ticketType.id,
                name: ticketType.name,
              }
            : null,
        };
      });

      const checkedInCount = tickets.filter(
        (ticket: any) => ticket.status === "checked_in",
      ).length;

      return res.status(200).json({
        success: true,
        message: "Attendees retrieved.",
        body: {
          tickets,

          stats: {
            total: tickets.length,

            checkedIn: checkedInCount,

            notIn: Math.max(tickets.length - checkedInCount, 0),
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
// CREATE PAID EVENT TICKET TYPE
// POST /api/v1/events/:eventId/ticket-types
// ========================================

router.post(
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

      if (String(event.type).toLowerCase() !== "paid") {
        return res.status(400).json({
          success: false,
          message: "Ticket types can only be created for paid events.",
        });
      }

      const name = String(req.body?.name ?? "").trim();

      const description = String(req.body?.description ?? "").trim() || null;

      const price = Number(req.body?.price);

      const quantity = Number(req.body?.quantity);

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Ticket type name is required.",
        });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          success: false,
          message: "Ticket price must be greater than zero.",
        });
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Ticket quantity must be at least 1.",
        });
      }

      const allTicketTypes = await db.orm.public.TicketType.all();

      const duplicate = allTicketTypes.find(
        (ticketType: any) =>
          String(ticketType.eventId) === String(eventId) &&
          String(ticketType.name).toLowerCase() === name.toLowerCase() &&
          Boolean(ticketType.isActive),
      );

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "A ticket type with this name already exists.",
        });
      }

      const ticketType = await db.orm.public.TicketType.create({
        eventId,

        name,

        description,

        price,

        quantity,

        quantitySold: 0,

        isActive: true,
      });

      // Keep event.minPrice in sync.
      const currentTypes = allTicketTypes.filter(
        (item: any) =>
          String(item.eventId) === String(eventId) && Boolean(item.isActive),
      );

      const prices = [
        ...currentTypes.map((item: any) => Number(item.price ?? 0)),

        price,
      ].filter((value) => Number.isFinite(value) && value > 0);

      const minPrice = prices.length > 0 ? Math.min(...prices) : price;

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update({
        minPrice,
      });

      return res.status(201).json({
        success: true,

        message: "Ticket type created.",

        body: {
          _id: ticketType.id,

          id: ticketType.id,

          name: ticketType.name,

          description: ticketType.description ?? undefined,

          price: Number(ticketType.price),

          quantity: Number(ticketType.quantity),

          quantitySold: Number(ticketType.quantitySold),

          purchaseLimitPerPerson: 10,

          isActive: Boolean(ticketType.isActive),
        },
      });
    } catch (error) {
      console.error("Create ticket type error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not create ticket type.",
      });
    }
  },
);

// ========================================
// UPDATE PAID EVENT TICKET TYPE
// PATCH /api/v1/events/:eventId/ticket-types/:ticketTypeId
// ========================================

router.patch(
  "/:eventId/ticket-types/:ticketTypeId",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const eventId = getParam(req.params.eventId);

      const ticketTypeId = getParam(req.params.ticketTypeId);

      if (!eventId || !ticketTypeId) {
        return res.status(400).json({
          success: false,

          message: "Event ID and ticket type ID are required.",
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

      if (String(event.type).toLowerCase() !== "paid") {
        return res.status(400).json({
          success: false,

          message: "Ticket types can only be updated for paid events.",
        });
      }

      const ticketType = await db.orm.public.TicketType.where({
        id: ticketTypeId,
        eventId,
      }).first();

      if (!ticketType) {
        return res.status(404).json({
          success: false,

          message: "Ticket type not found.",
        });
      }

      const updateData: Record<string, unknown> = {};

      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();

        if (!name) {
          return res.status(400).json({
            success: false,

            message: "Ticket type name cannot be empty.",
          });
        }

        const allTicketTypes = await db.orm.public.TicketType.all();

        const duplicate = allTicketTypes.find(
          (item: any) =>
            String(item.eventId) === String(eventId) &&
            String(item.id) !== String(ticketTypeId) &&
            String(item.name).toLowerCase() === name.toLowerCase() &&
            Boolean(item.isActive),
        );

        if (duplicate) {
          return res.status(409).json({
            success: false,

            message: "A ticket type with this name already exists.",
          });
        }

        updateData.name = name;
      }

      if (req.body?.description !== undefined) {
        updateData.description = String(req.body.description).trim() || null;
      }

      if (req.body?.price !== undefined) {
        const price = Number(req.body.price);

        if (!Number.isFinite(price) || price <= 0) {
          return res.status(400).json({
            success: false,

            message: "Ticket price must be greater than zero.",
          });
        }

        updateData.price = price;
      }

      if (req.body?.quantity !== undefined) {
        const quantity = Number(req.body.quantity);

        if (!Number.isInteger(quantity) || quantity < 1) {
          return res.status(400).json({
            success: false,

            message: "Ticket quantity must be at least 1.",
          });
        }

        const quantitySold = Number(ticketType.quantitySold ?? 0);

        if (quantity < quantitySold) {
          return res.status(400).json({
            success: false,

            message: `Quantity cannot be lower than the ${quantitySold} ticket(s) already sold.`,
          });
        }

        updateData.quantity = quantity;
      }

      if (Object.keys(updateData).length > 0) {
        await db.orm.public.TicketType.where({
          id: ticketTypeId,
          eventId,
        }).update(updateData);
      }

      const updatedTicketType = await db.orm.public.TicketType.where({
        id: ticketTypeId,
        eventId,
      }).first();

      if (!updatedTicketType) {
        return res.status(404).json({
          success: false,

          message: "Ticket type not found after update.",
        });
      }

      // Recalculate event minimum price.
      const allTicketTypes = await db.orm.public.TicketType.all();

      const eventTicketTypes = allTicketTypes.filter(
        (item: any) =>
          String(item.eventId) === String(eventId) && Boolean(item.isActive),
      );

      const prices = eventTicketTypes
        .map((item: any) => Number(item.price ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update({
        minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      });

      return res.status(200).json({
        success: true,

        message: "Ticket type updated.",

        body: {
          _id: updatedTicketType.id,

          id: updatedTicketType.id,

          name: updatedTicketType.name,

          description: updatedTicketType.description ?? undefined,

          price: Number(updatedTicketType.price),

          quantity: Number(updatedTicketType.quantity),

          quantitySold: Number(updatedTicketType.quantitySold),

          purchaseLimitPerPerson: 10,

          isActive: Boolean(updatedTicketType.isActive),
        },
      });
    } catch (error) {
      console.error("Update ticket type error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not update ticket type.",
      });
    }
  },
);

// ========================================
// DELETE PAID EVENT TICKET TYPE
// DELETE /api/v1/events/:eventId/ticket-types/:ticketTypeId
// ========================================

router.delete(
  "/:eventId/ticket-types/:ticketTypeId",
  requireAuth,
  requireRole("ORGANIZER"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const organizerId = req.user!.id;

      const eventId = getParam(req.params.eventId);

      const ticketTypeId = getParam(req.params.ticketTypeId);

      if (!eventId || !ticketTypeId) {
        return res.status(400).json({
          success: false,

          message: "Event ID and ticket type ID are required.",
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

      const ticketType = await db.orm.public.TicketType.where({
        id: ticketTypeId,
        eventId,
      }).first();

      if (!ticketType) {
        return res.status(404).json({
          success: false,

          message: "Ticket type not found.",
        });
      }

      if (Number(ticketType.quantitySold ?? 0) > 0) {
        return res.status(409).json({
          success: false,

          message: "A ticket type with existing sales cannot be deleted.",
        });
      }

      await db.orm.public.TicketType.where({
        id: ticketTypeId,
        eventId,
      }).delete();

      // Recalculate minPrice after delete.
      const allTicketTypes = await db.orm.public.TicketType.all();

      const remainingTypes = allTicketTypes.filter(
        (item: any) =>
          String(item.eventId) === String(eventId) &&
          String(item.id) !== String(ticketTypeId) &&
          Boolean(item.isActive),
      );

      const prices = remainingTypes
        .map((item: any) => Number(item.price ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);

      await db.orm.public.Event.where({
        id: eventId,
        organizerId,
      }).update({
        minPrice: prices.length > 0 ? Math.min(...prices) : 0,
      });

      return res.status(200).json({
        success: true,

        message: "Ticket type deleted.",

        body: {
          _id: ticketTypeId,
        },
      });
    } catch (error) {
      console.error("Delete ticket type error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not delete ticket type.",
      });
    }
  },
);

// ========================================
// EVENT TICKET TYPES
// GET /api/v1/events/:eventId/ticket-types
//
// PUBLIC because attendees need this endpoint
// before reserving or buying a ticket.
// ========================================

router.get("/:eventId/ticket-types", async (req, res) => {
  try {
    const eventId = getParam(req.params.eventId);

    if (!eventId) {
      return res.status(400).json({
        success: false,

        message: "Event ID is required.",
      });
    }

    const event = await db.orm.public.Event.where({
      id: eventId,
    }).first();

    if (!event || String(event.status).toLowerCase() !== "approved") {
      return res.status(404).json({
        success: false,

        message: "Event not found.",
      });
    }

    const ticketTypes = await ensureFreeTicketType(event);

    return res.status(200).json({
      success: true,

      message: "Ticket types retrieved.",

      body: ticketTypes.map(serializeTicketType),
    });
  } catch (error) {
    console.error("Get ticket types error:", error);

    return res.status(500).json({
      success: false,

      message: "Could not retrieve ticket types.",
    });
  }
});

// ========================================
// ORGANIZER CHECK-IN
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

      const ticketCode = String(
        req.body?.ticketCode ?? req.body?.code ?? "",
      ).trim();

      if (!ticketCode) {
        return res.status(400).json({
          success: false,
          message: "Ticket code is required.",
          body: {
            result: "invalid",
            checkedInAt: null,
          },
        });
      }

      const ticket = await db.orm.public.Ticket.where({
        ticketCode,
      }).first();

      if (!ticket || String(ticket.eventId) !== String(eventId)) {
        return res.status(404).json({
          success: false,
          message: "Ticket is not valid for this event.",
          body: {
            result: "invalid",
            checkedInAt: null,
          },
        });
      }

      const rawStatus = String(ticket.status ?? "").toLowerCase();

      if (rawStatus === "cancelled" || rawStatus === "refunded") {
        return res.status(400).json({
          success: false,
          message: "This ticket is no longer valid.",
          body: {
            result: "invalid",
            checkedInAt: null,
          },
        });
      }

      const ticketType = await db.orm.public.TicketType.where({
        id: ticket.ticketTypeId,
      }).first();

      const buildFrontendTicket = (
        currentTicket: any,
        checkedInAtValue?: string | null,
      ) => ({
        _id: currentTicket.id,

        code: currentTicket.ticketCode,

        type: String(event.type).toLowerCase() === "paid" ? "paid" : "free",

        price: Number(ticketType?.price ?? 0),

        attendeeName:
          currentTicket.guestName ?? currentTicket.guestEmail ?? "Attendee",

        attendeeEmail: currentTicket.guestEmail ?? "",

        status: checkedInAtValue ? "checked_in" : "valid",

        checkedInAt: checkedInAtValue ?? null,

        ticketType: ticketType
          ? {
              _id: ticketType.id,
              name: ticketType.name,
            }
          : null,
      });

      // ========================================
      // ALREADY CHECKED IN
      // ========================================

      if (rawStatus === "used" || ticket.checkedInAt) {
        const existingCheckedInAt = ticket.checkedInAt
          ? String(ticket.checkedInAt)
          : null;

        return res.status(200).json({
          success: true,
          message: "Ticket has already been checked in.",
          body: {
            result: "already_used",

            checkedInAt: existingCheckedInAt,

            ticket: buildFrontendTicket(ticket, existingCheckedInAt),
          },
        });
      }

      // ========================================
      // CHECK TICKET IN
      // ========================================

      const checkedInAt = Temporal.Now.instant();

      await db.orm.public.Ticket.where({
        id: ticket.id,
      }).update({
        status: "used",
        checkedInAt,
      });

      const checkedInAtString = String(checkedInAt);

      return res.status(200).json({
        success: true,
        message: "Ticket checked in successfully.",

        body: {
          result: "valid",

          checkedInAt: checkedInAtString,

          ticket: buildFrontendTicket(ticket, checkedInAtString),
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

      const tickets = await db.orm.public.Ticket.all();

      const eventHasTickets = tickets.some(
        (ticket: any) => String(ticket.eventId) === String(eventId),
      );

      if (eventHasTickets) {
        return res.status(409).json({
          success: false,

          message:
            "This event has ticket records and cannot be permanently deleted.",
        });
      }

      const orders = await db.orm.public.Order.all();

      const eventHasOrders = orders.some(
        (order: any) => String(order.eventId) === String(eventId),
      );

      if (eventHasOrders) {
        return res.status(409).json({
          success: false,

          message:
            "This event has order records and cannot be permanently deleted.",
        });
      }

      const ticketTypes = await getEventTicketTypes(eventId);

      for (const ticketType of ticketTypes) {
        await db.orm.public.TicketType.where({
          id: ticketType.id,
        }).delete();
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

      // Copy ticket types for paid events,
      // but reset sold quantity to zero.
      const originalTicketTypes = await getEventTicketTypes(eventId);

      for (const ticketType of originalTicketTypes) {
        await db.orm.public.TicketType.create({
          eventId: copy.id,

          name: ticketType.name,

          description: ticketType.description ?? null,

          price: Number(ticketType.price ?? 0),

          quantity: Number(ticketType.quantity ?? 0),

          quantitySold: 0,

          isActive: Boolean(ticketType.isActive),
        });
      }

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
// SPOTLIGHT / PROMOTED EVENTS
// GET /api/v1/events/spotlight
// ========================================

router.get("/spotlight", async (req, res) => {
  try {
    const placement = String(req.query.placement ?? "spotlight");

    const requestedLimit = Number(req.query.limit ?? 8);

    const limit = Math.min(
      Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 8, 1),
      20,
    );

    const allEvents = await db.orm.public.Event.all();

    const allCategories = await db.orm.public.Category.all();

    const allTicketTypes = await db.orm.public.TicketType.all();

    const categoryMap = new Map(
      allCategories.map((category: any) => [String(category.id), category]),
    );

    let promotedEvents = allEvents.filter(
      (event: any) =>
        String(event.status).toLowerCase() === "approved" &&
        Boolean(event.isPromoted),
    );

    /*
     * Our portfolio backend currently stores
     * isPromoted but does not yet store separate
     * hero / featured / spotlight packages.
     *
     * The frontend still sends placement so we
     * accept it for API compatibility.
     */
    void placement;

    promotedEvents = promotedEvents.slice(0, limit);

    const events = promotedEvents.map((event: any) => {
      const category = event.categoryId
        ? categoryMap.get(String(event.categoryId))
        : undefined;

      const eventTicketTypes = allTicketTypes.filter(
        (ticketType: any) =>
          String(ticketType.eventId) === String(event.id) &&
          Boolean(ticketType.isActive),
      );

      return serializeEvent(event, category, eventTicketTypes);
    });

    return res.status(200).json({
      success: true,

      message: "Spotlight events retrieved.",

      body: {
        events,

        currency: "Naira",
      },
    });
  } catch (error) {
    console.error("Get spotlight events error:", error);

    return res.status(500).json({
      success: false,

      message: "Could not retrieve spotlight events.",
    });
  }
});

// ========================================
// GET PUBLIC EVENT BY SLUG
// GET /api/v1/events/:slug
//
// KEEP THIS LAST.
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

    const event = await db.orm.public.Event.where({
      slug,
    }).first();

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

    const ticketTypes = await ensureFreeTicketType(event);

    const stats = await getEventTicketStats(String(event.id));

    return res.status(200).json({
      success: true,

      message: "Event retrieved.",

      body: serializeEvent(event, category, ticketTypes, stats),
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
