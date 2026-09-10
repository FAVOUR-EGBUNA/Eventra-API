import { Router } from "express";
import { randomUUID } from "node:crypto";

import { db } from "../prisma/db";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

// ========================================
// HELPERS
// ========================================

function getParam(value: string | string[] | undefined): string | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function makeReference(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function buildVenue(event: any) {
  if (Boolean(event.isOnline)) {
    return {
      name: "Online event",
      address: "",
      city: "Online",
      state: "",
    };
  }

  return {
    name: event.venueName ?? "Venue TBA",
    address: event.venueAddress ?? "",
    city: event.venueCity ?? "",
    state: event.venueState ?? "",
  };
}

function buildVenueLabel(event: any): string {
  if (Boolean(event.isOnline)) {
    return "Online event";
  }

  const parts = [
    event.venueName,
    event.venueAddress,
    event.venueCity,
    event.venueState,
  ]
    .map((value) => (value ? String(value).trim() : ""))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "Venue TBA";
}

function frontendTicketStatus(
  ticket: any,
): "valid" | "checked_in" | "cancelled" | "refunded" {
  const status = String(ticket.status ?? "").toLowerCase();

  if (status === "used" || ticket.checkedInAt) {
    return "checked_in";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "refunded") {
    return "refunded";
  }

  return "valid";
}

// ========================================
// ATTENDEE / CONFIRMATION TICKET SHAPE
//
// This is the shape the current frontend
// checkout-confirmation and callback pages
// expect.
// ========================================

function serializeIssuedTicket(ticket: any, event: any, ticketType: any) {
  const eventType =
    String(event.type).toLowerCase() === "paid" ? "paid" : "free";

  return {
    _id: ticket.id,

    ticketId: ticket.ticketCode,

    code: ticket.ticketCode,

    attendeeName: ticket.guestName ?? "Attendee",

    attendeeEmail: ticket.guestEmail ?? "",

    type: eventType,

    price: Number(ticketType?.price ?? 0),

    status: frontendTicketStatus(ticket),

    checkedInAt: ticket.checkedInAt ? String(ticket.checkedInAt) : undefined,

    issuedAt: String(ticket.createdAt),

    ticketType: ticketType
      ? {
          _id: ticketType.id,
          name: ticketType.name,
        }
      : null,

    event: {
      _id: event.id,
      id: event.id,

      title: event.title ?? "Event",

      slug: event.slug,

      type: event.type,

      coverImage: event.coverImage ?? undefined,

      startDate: event.startDate
        ? String(event.startDate)
        : new Date().toISOString(),

      endDate: event.endDate ? String(event.endDate) : undefined,

      venue: buildVenue(event),

      refundPolicy:
        eventType === "free"
          ? {
              type: "no-refunds",
            }
          : {
              type: "refund-until-days-before",

              daysBefore: 3,
            },
    },
  };
}

// ========================================
// MY TICKETS PAGE SHAPE
//
// This maps database records into the
// existing src/types/ticket.ts structure.
// ========================================

function serializeMyTicket(
  ticket: any,
  event: any,
  ticketType: any,
  order?: any,
) {
  const isFree = String(event.type).toLowerCase() === "free";

  const typeName = isFree ? "Free" : (ticketType?.name ?? "Paid");

  const unitPrice = Number(ticketType?.price ?? 0);

  return {
    _id: ticket.id,

    eventName: event.title ?? "Event",

    category: [],

    eventDateTime: event.startDate
      ? String(event.startDate)
      : new Date().toISOString(),

    eventEntrance: Boolean(event.isOnline) ? "Online access" : "Main entrance",

    eventVenue: buildVenueLabel(event),

    referenceCode: ticket.ticketCode,

    orderID: order?.reference ?? ticket.ticketCode,

    holderName: ticket.guestName ?? "Attendee",

    ticketDetails: [
      {
        type: typeName,

        unitPrice,

        quantity: 1,
      },
    ],

    qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
      ticket.ticketCode,
    )}`,

    refundPolicy: isFree
      ? {
          type: "free-cancel" as const,

          note: "Free event · cancel anytime to release your spot.",
        }
      : {
          type: "refundable" as const,

          note: "Refunds allowed until 3 days before the event.",
        },

    // Extra real backend data.
    ticketId: ticket.ticketCode,

    code: ticket.ticketCode,

    status: frontendTicketStatus(ticket),

    checkedInAt: ticket.checkedInAt ? String(ticket.checkedInAt) : undefined,

    ticketType: ticketType
      ? {
          _id: ticketType.id,
          name: ticketType.name,
        }
      : null,
  };
}

// ========================================
// GET TICKET TYPES - COMPATIBILITY
// GET /api/v1/tickets/event/:eventId/ticket-types
//
// Main attendee frontend uses the events
// route, but this remains available too.
// ========================================

router.get("/event/:eventId/ticket-types", async (req, res) => {
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

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    const allTicketTypes = await db.orm.public.TicketType.all();

    const ticketTypes = allTicketTypes
      .filter(
        (ticketType: any) =>
          String(ticketType.eventId) === String(eventId) &&
          Boolean(ticketType.isActive),
      )
      .map((ticketType: any) => {
        const quantity = Number(ticketType.quantity ?? 0);

        const quantitySold = Number(ticketType.quantitySold ?? 0);

        return {
          _id: ticketType.id,

          id: ticketType.id,

          name: ticketType.name,

          description: ticketType.description ?? undefined,

          price: Number(ticketType.price ?? 0),

          quantity,

          quantitySold,

          purchaseLimitPerPerson: 10,

          available: Math.max(quantity - quantitySold, 0),

          isActive: Boolean(ticketType.isActive),
        };
      });

    return res.status(200).json({
      success: true,

      message: "Ticket types retrieved.",

      body: ticketTypes,
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
// FREE EVENT RSVP
// POST /api/v1/tickets/rsvp/:eventId
// ========================================

router.post(
  "/rsvp/:eventId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;

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

      if (!event) {
        return res.status(404).json({
          success: false,

          message: "Event not found.",
        });
      }

      if (String(event.status).toLowerCase() !== "approved") {
        return res.status(400).json({
          success: false,

          message: "This event is not available for reservations.",
        });
      }

      if (String(event.type).toLowerCase() !== "free") {
        return res.status(400).json({
          success: false,

          message: "This event requires paid checkout.",
        });
      }

      const requestedGuests = Number(req.body?.guests ?? 1);

      if (
        !Number.isInteger(requestedGuests) ||
        requestedGuests < 1 ||
        requestedGuests > 10
      ) {
        return res.status(400).json({
          success: false,

          message: "Guests must be between 1 and 10.",
        });
      }

      const guestName = String(req.body?.guestName ?? "").trim() || null;

      const guestEmail =
        String(req.body?.guestEmail ?? req.user!.email).trim() ||
        req.user!.email;

      const guestPhone = String(req.body?.guestPhone ?? "").trim() || null;

      // ========================================
      // PREVENT DUPLICATE ACTIVE RSVP
      // ========================================

      const allOrders = await db.orm.public.Order.all();

      const existingOrder = allOrders.find(
        (order: any) =>
          String(order.userId) === String(userId) &&
          String(order.eventId) === String(eventId) &&
          ["pending", "completed"].includes(String(order.status).toLowerCase()),
      );

      if (existingOrder) {
        const allTickets = await db.orm.public.Ticket.all();

        const activeTickets = allTickets.filter(
          (ticket: any) =>
            String(ticket.orderId) === String(existingOrder.id) &&
            !["cancelled", "refunded"].includes(
              String(ticket.status).toLowerCase(),
            ),
        );

        if (activeTickets.length > 0) {
          return res.status(409).json({
            success: false,

            message: "You already have a reservation for this event.",
          });
        }
      }

      // ========================================
      // FIND OR CREATE FREE TICKET TYPE
      // ========================================

      const allTicketTypes = await db.orm.public.TicketType.all();

      let ticketType = allTicketTypes.find(
        (item: any) =>
          String(item.eventId) === String(eventId) &&
          Number(item.price ?? 0) === 0 &&
          Boolean(item.isActive),
      );

      if (!ticketType) {
        const quantity =
          event.capacity && Number(event.capacity) > 0
            ? Number(event.capacity)
            : 1000;

        ticketType = await db.orm.public.TicketType.create({
          eventId,

          name: "Free Ticket",

          description: "General admission",

          price: 0,

          quantity,

          quantitySold: 0,

          isActive: true,
        });
      }

      const available =
        Number(ticketType.quantity) - Number(ticketType.quantitySold);

      if (available < requestedGuests) {
        return res.status(400).json({
          success: false,

          message:
            available <= 0
              ? "This event is fully booked."
              : `Only ${available} ticket(s) are available.`,
        });
      }

      // ========================================
      // CREATE FREE ORDER
      // ========================================

      const reference = makeReference("EVT-FREE");

      const order = await db.orm.public.Order.create({
        userId,

        eventId,

        reference,

        status: "completed",

        total: 0,

        guestName,

        guestEmail,

        guestPhone,
      });

      await db.orm.public.OrderItem.create({
        orderId: order.id,

        ticketTypeId: ticketType.id,

        quantity: requestedGuests,

        unitPrice: 0,

        subtotal: 0,
      });

      // ========================================
      // ISSUE TICKETS
      // ========================================

      const issuedTickets: any[] = [];

      for (let index = 0; index < requestedGuests; index += 1) {
        const ticket = await db.orm.public.Ticket.create({
          userId,

          eventId,

          orderId: order.id,

          ticketTypeId: ticketType.id,

          ticketCode: makeReference("TKT"),

          status: "active",

          guestName,

          guestEmail,

          checkedInAt: null,
        });

        issuedTickets.push(serializeIssuedTicket(ticket, event, ticketType));
      }

      await db.orm.public.TicketType.where({
        id: ticketType.id,
      }).update({
        quantitySold: Number(ticketType.quantitySold) + requestedGuests,
      });

      return res.status(201).json({
        success: true,

        message: "Reservation confirmed.",

        // IMPORTANT:
        // frontend free checkout expects
        // res.body itself to be the array.
        body: issuedTickets,
      });
    } catch (error) {
      console.error("Free RSVP error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not complete reservation.",
      });
    }
  },
);

// ========================================
// MY TICKETS
// GET /api/v1/tickets/my-tickets
// ========================================

router.get(
  "/my-tickets",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;

      const allTickets = await db.orm.public.Ticket.all();

      const userTickets = allTickets.filter(
        (ticket: any) => String(ticket.userId) === String(userId),
      );

      const allEvents = await db.orm.public.Event.all();

      const allTicketTypes = await db.orm.public.TicketType.all();

      const eventMap = new Map(
        allEvents.map((event: any) => [String(event.id), event]),
      );

      const ticketTypeMap = new Map(
        allTicketTypes.map((ticketType: any) => [
          String(ticketType.id),
          ticketType,
        ]),
      );

      const tickets = userTickets
        .map((ticket: any) => {
          const event = eventMap.get(String(ticket.eventId));

          if (!event) {
            return null;
          }

          return serializeIssuedTicket(
            ticket,

            event,

            ticketTypeMap.get(String(ticket.ticketTypeId)),
          );
        })
        .filter(Boolean);

      return res.status(200).json({
        success: true,

        message: "Tickets retrieved.",

        // Frontend supports the wrapped form.
        body: {
          tickets,

          currency: "Naira",
        },
      });
    } catch (error) {
      console.error("Get my tickets error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not retrieve tickets.",
      });
    }
  },
);

// ========================================
// GET ORDER BY REFERENCE
// GET /api/v1/tickets/orders/:reference
//
// This powers the fake Paystack callback.
// ========================================

router.get(
  "/orders/:reference",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const reference = getParam(req.params.reference);

      if (!reference) {
        return res.status(400).json({
          success: false,

          message: "Order reference is required.",
        });
      }

      const order = await db.orm.public.Order.where({
        reference,
      }).first();

      if (!order || String(order.userId) !== String(req.user!.id)) {
        return res.status(404).json({
          success: false,

          message: "Order not found.",
        });
      }

      const event = await db.orm.public.Event.where({
        id: order.eventId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,

          message: "Order event not found.",
        });
      }

      const allTickets = await db.orm.public.Ticket.all();

      const orderTickets = allTickets.filter(
        (ticket: any) => String(ticket.orderId) === String(order.id),
      );

      const allTicketTypes = await db.orm.public.TicketType.all();

      const ticketTypeMap = new Map(
        allTicketTypes.map((ticketType: any) => [
          String(ticketType.id),
          ticketType,
        ]),
      );

      const tickets = orderTickets.map((ticket: any) =>
        serializeIssuedTicket(
          ticket,

          event,

          ticketTypeMap.get(String(ticket.ticketTypeId)),
        ),
      );

      // Frontend callback currently expects:
      // status === "paid"
      //
      // Database enum uses "completed".
      // We translate only at API boundary.
      let frontendStatus = String(order.status).toLowerCase();

      if (frontendStatus === "completed") {
        frontendStatus = "paid";
      }

      const venue = buildVenue(event);

      return res.status(200).json({
        success: true,

        message: "Order retrieved.",

        body: {
          _id: order.id,
          id: order.id,

          reference: order.reference,

          status: frontendStatus,

          total: Number(order.total ?? 0),

          currency: "Naira",

          guestName: order.guestName ?? undefined,

          guestEmail: order.guestEmail ?? undefined,

          guestPhone: order.guestPhone ?? undefined,

          createdAt: String(order.createdAt),

          event: {
            _id: event.id,
            id: event.id,

            title: event.title,

            slug: event.slug,

            coverImage: event.coverImage ?? undefined,

            startDate: event.startDate
              ? String(event.startDate)
              : new Date().toISOString(),

            endDate: event.endDate ? String(event.endDate) : undefined,

            type: event.type,

            venue,
          },

          tickets,
        },
      });
    } catch (error) {
      console.error("Get order error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not retrieve order.",
      });
    }
  },
);

// ========================================
// DEMO PAID CHECKOUT
// POST /api/v1/tickets/checkout/:eventId
//
// DEMO ONLY:
// No real money moves.
// The order is completed immediately,
// tickets are issued immediately, and the
// attendee is redirected through the normal
// payment callback page.
// ========================================

router.post(
  "/checkout/:eventId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const eventId = getParam(req.params.eventId);

      if (!eventId) {
        return res.status(400).json({
          success: false,
          message: "Event ID is required.",
        });
      }

      // ========================================
      // FIND EVENT
      // ========================================

      const event = await db.orm.public.Event.where({
        id: eventId,
      }).first();

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found.",
        });
      }

      if (String(event.status).toLowerCase() !== "approved") {
        return res.status(400).json({
          success: false,
          message: "This event is not available for checkout.",
        });
      }

      if (String(event.type).toLowerCase() !== "paid") {
        return res.status(400).json({
          success: false,
          message: "This event does not require payment.",
        });
      }

      // ========================================
      // VALIDATE ITEMS
      // ========================================

      const items = Array.isArray(req.body?.items) ? req.body.items : [];

      if (items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Please select at least one ticket.",
        });
      }

      const allTicketTypes = await db.orm.public.TicketType.all();

      const eventTicketTypes = allTicketTypes.filter(
        (ticketType: any) =>
          String(ticketType.eventId) === String(eventId) &&
          Boolean(ticketType.isActive),
      );

      if (eventTicketTypes.length === 0) {
        return res.status(400).json({
          success: false,
          message: "This paid event does not have ticket types yet.",
        });
      }

      let total = 0;
      let totalQuantity = 0;

      const validatedItems: Array<{
        ticketType: any;
        quantity: number;
        subtotal: number;
      }> = [];

      for (const item of items) {
        const ticketTypeId = String(item?.ticketTypeId ?? "");

        const quantity = Number(item?.quantity ?? 0);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
          return res.status(400).json({
            success: false,
            message: "Each ticket quantity must be between 1 and 10.",
          });
        }

        const ticketType = eventTicketTypes.find(
          (candidate: any) => String(candidate.id) === ticketTypeId,
        );

        if (!ticketType) {
          return res.status(400).json({
            success: false,
            message: "Selected ticket type was not found.",
          });
        }

        const available =
          Number(ticketType.quantity) - Number(ticketType.quantitySold);

        if (available < quantity) {
          return res.status(400).json({
            success: false,
            message:
              available <= 0
                ? `${ticketType.name} is sold out.`
                : `Only ${available} ${ticketType.name} ticket(s) are available.`,
          });
        }

        const price = Number(ticketType.price ?? 0);

        if (price <= 0) {
          return res.status(400).json({
            success: false,
            message:
              "Paid checkout requires a ticket with a price greater than zero.",
          });
        }

        const subtotal = price * quantity;

        total += subtotal;
        totalQuantity += quantity;

        validatedItems.push({
          ticketType,
          quantity,
          subtotal,
        });
      }

      if (totalQuantity > 10) {
        return res.status(400).json({
          success: false,
          message: "You can purchase at most 10 tickets in one order.",
        });
      }

      // ========================================
      // BUYER DETAILS
      // ========================================

      const guestName = String(req.body?.guestName ?? "").trim() || null;

      const guestEmail =
        String(req.body?.guestEmail ?? req.user!.email).trim() ||
        req.user!.email;

      const guestPhone = String(req.body?.guestPhone ?? "").trim() || null;

      // ========================================
      // SIMULATED PAYSTACK SUCCESS
      // ========================================

      const reference = makeReference("PAYSTACK-DEMO");

      // Because this is a demo payment,
      // the order is completed immediately.
      const order = await db.orm.public.Order.create({
        userId,
        eventId,
        reference,
        status: "completed",
        total,
        guestName,
        guestEmail,
        guestPhone,
      });

      const issuedTickets: any[] = [];

      // ========================================
      // CREATE ORDER ITEMS + ISSUE TICKETS
      // ========================================

      for (const item of validatedItems) {
        await db.orm.public.OrderItem.create({
          orderId: order.id,
          ticketTypeId: item.ticketType.id,
          quantity: item.quantity,
          unitPrice: Number(item.ticketType.price),
          subtotal: item.subtotal,
        });

        for (let index = 0; index < item.quantity; index += 1) {
          const ticket = await db.orm.public.Ticket.create({
            userId,
            eventId,
            orderId: order.id,
            ticketTypeId: item.ticketType.id,
            ticketCode: makeReference("TKT"),
            status: "active",
            guestName,
            guestEmail,
            checkedInAt: null,
          });

          issuedTickets.push(
            serializeIssuedTicket(ticket, event, item.ticketType),
          );
        }

        await db.orm.public.TicketType.where({
          id: item.ticketType.id,
        }).update({
          quantitySold: Number(item.ticketType.quantitySold) + item.quantity,
        });
      }

      // ========================================
      // DEMO PAYSTACK REDIRECT
      // ========================================

      const frontendUrl = (
        process.env.FRONTEND_URL ?? "http://localhost:4001"
      ).replace(/\/+$/, "");

      // IMPORTANT:
      // The frontend React route is:
      //
      // /payment/checkout/callback
      //
      // NOT:
      // /payment/checkout-callback
      const authorizationUrl =
        `${frontendUrl}/payment/checkout/callback` +
        `?reference=${encodeURIComponent(reference)}`;

      return res.status(201).json({
        success: true,
        message: "Demo payment completed successfully.",
        body: {
          orderId: order.id,
          reference,
          authorizationUrl,
          total,
          currency: "Naira",
          paymentProvider: "paystack-demo",
          demo: true,
          tickets: issuedTickets,
        },
      });
    } catch (error) {
      console.error("Demo paid checkout error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not complete demo checkout.",
      });
    }
  },
);

// ========================================
// CANCEL RESERVATION
// DELETE /api/v1/tickets/:ticketId/reservation
// ========================================

router.delete(
  "/:ticketId/reservation",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = getParam(req.params.ticketId);

      if (!ticketId) {
        return res.status(400).json({
          success: false,

          message: "Ticket ID is required.",
        });
      }

      // Support both raw DB id and friendly
      // TKT-... code from frontend.
      let ticket = await db.orm.public.Ticket.where({
        id: ticketId,

        userId: req.user!.id,
      }).first();

      if (!ticket) {
        ticket = await db.orm.public.Ticket.where({
          ticketCode: ticketId,

          userId: req.user!.id,
        }).first();
      }

      if (!ticket) {
        return res.status(404).json({
          success: false,

          message: "Ticket not found.",
        });
      }

      const status = String(ticket.status).toLowerCase();

      if (status !== "active") {
        return res.status(400).json({
          success: false,

          message:
            status === "used"
              ? "A checked-in ticket cannot be cancelled."
              : "This ticket cannot be cancelled.",
        });
      }

      await db.orm.public.Ticket.where({
        id: ticket.id,
      }).update({
        status: "cancelled",
      });

      const ticketType = await db.orm.public.TicketType.where({
        id: ticket.ticketTypeId,
      }).first();

      if (ticketType && Number(ticketType.quantitySold) > 0) {
        await db.orm.public.TicketType.where({
          id: ticketType.id,
        }).update({
          quantitySold: Math.max(Number(ticketType.quantitySold) - 1, 0),
        });
      }

      return res.status(200).json({
        success: true,

        message: "Reservation cancelled.",

        body: {
          ticketId: ticket.ticketCode,

          status: "cancelled",
        },
      });
    } catch (error) {
      console.error("Cancel reservation error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not cancel reservation.",
      });
    }
  },
);

// ========================================
// DEMO REFUND REQUEST
// POST /api/v1/tickets/:ticketId/refund-request
//
// Demo only: immediately marks ticket
// refunded instead of creating a real
// review workflow.
// ========================================

router.post(
  "/:ticketId/refund-request",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const ticketId = getParam(req.params.ticketId);

      if (!ticketId) {
        return res.status(400).json({
          success: false,

          message: "Ticket ID is required.",
        });
      }

      let ticket = await db.orm.public.Ticket.where({
        id: ticketId,

        userId: req.user!.id,
      }).first();

      if (!ticket) {
        ticket = await db.orm.public.Ticket.where({
          ticketCode: ticketId,

          userId: req.user!.id,
        }).first();
      }

      if (!ticket) {
        return res.status(404).json({
          success: false,

          message: "Ticket not found.",
        });
      }

      if (String(ticket.status).toLowerCase() !== "active") {
        return res.status(400).json({
          success: false,

          message: "This ticket is not eligible for a refund.",
        });
      }

      await db.orm.public.Ticket.where({
        id: ticket.id,
      }).update({
        status: "refunded",
      });

      const ticketType = await db.orm.public.TicketType.where({
        id: ticket.ticketTypeId,
      }).first();

      if (ticketType && Number(ticketType.quantitySold) > 0) {
        await db.orm.public.TicketType.where({
          id: ticketType.id,
        }).update({
          quantitySold: Math.max(Number(ticketType.quantitySold) - 1, 0),
        });
      }

      // RefundRequestPopulated is more
      // elaborate in the original frontend.
      // For demo compatibility, return useful
      // basic information without pretending
      // a real payment refund happened.
      return res.status(200).json({
        success: true,

        message: "Demo refund completed successfully.",

        body: {
          _id: ticket.id,

          ticketId: ticket.ticketCode,

          status: "refunded",

          reason: req.body?.reason ?? "Demo refund",

          description: req.body?.description ?? "",

          requestedResolution: req.body?.requestedResolution ?? "refund",

          additionalInformation: req.body?.additionalInformation ?? "",

          demo: true,

          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Demo refund error:", error);

      return res.status(500).json({
        success: false,

        message: "Could not process demo refund.",
      });
    }
  },
);

export default router;
