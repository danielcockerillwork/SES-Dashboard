import { describe, expect, it } from "vitest";
import { normalizeAppointment } from "@/lib/serviceminder/reporting";

describe("ServiceMinder reporting appointment line items", () => {
  it("normalizes service price, parts, and authoritative appointment total", () => {
    const row = normalizeAppointment({
      AppointmentId: 47517174,
      ServiceName: "Target Maintenance",
      ServicePrice: "275",
      Total: "575",
      AddOnParts: [{ Quantity: 5, UnitPrice: 60, Name: "5\" Rotor Installed", PartId: 234778 }],
    });

    expect(row.servicePrice).toBe(275);
    expect(row.partsTotal).toBe(300);
    expect(row.jobTotal).toBe(575);
    expect(row.lineItems).toEqual([
      {
        name: "5\" Rotor Installed",
        quantity: 5,
        sku: "234778",
        notes: null,
        unitPrice: 60,
        unitOfMeasure: null,
        total: 300,
      },
    ]);
  });

  it("derives job total when no authoritative total exists", () => {
    const row = normalizeAppointment({
      AppointmentId: "SM-1",
      ServiceName: "Controller Repair",
      ServicePrice: 150,
      Parts: [{ Name: "Controller", Quantity: 1, UnitPrice: 650 }],
    });

    expect(row.partsTotal).toBe(650);
    expect(row.jobTotal).toBe(800);
  });

  it("coerces quantity strings and defaults invalid quantities to one", () => {
    const row = normalizeAppointment({
      AppointmentId: "SM-2",
      AddOnParts: [
        { Name: "Rotor", Quantity: "2", UnitPrice: "90", UnitOfMeasure: "each", Notes: "Front bed" },
        { Name: "Valve", Quantity: "not a number", UnitPrice: 180 },
      ],
    });

    expect(row.lineItems).toMatchObject([
      { name: "Rotor", quantity: 2, unitPrice: 90, unitOfMeasure: "each", notes: "Front bed", total: 180 },
      { name: "Valve", quantity: 1, unitPrice: 180, total: 180 },
    ]);
  });

  it("returns an empty line item list when no parts are present", () => {
    const row = normalizeAppointment({
      AppointmentId: "SM-3",
      ServiceName: "Inspection",
    });

    expect(row.lineItems).toEqual([]);
    expect(row.partsTotal).toBe(0);
  });

  it("normalizes slot-wrapped line item payloads", () => {
    const row = normalizeAppointment({
      Slots: [
        {
          AppointmentId: 47517174,
          ServiceName: "Target Maintenance",
          Total: 1170,
          AddOnParts: [
            { PartId: 234778, Quantity: 5, UnitPrice: 60, Name: "5\" Rotor Installed" },
            { PartId: 234779, Quantity: 4, UnitPrice: 180, Name: "Valve Rebuild" },
          ],
        },
      ],
    });

    expect(row.id).toBe("47517174");
    expect(row.serviceName).toBe("Target Maintenance");
    expect(row.partsTotal).toBe(1020);
    expect(row.servicePrice).toBe(150);
    expect(row.jobTotal).toBe(1170);
    expect(row.lineItems).toHaveLength(2);
  });

  it("uses proposal lines when appointment add-on parts are empty", () => {
    const row = normalizeAppointment({
      AppointmentId: 45186120,
      ServiceName: "SES Inspection",
      Total: 143.94,
      AddOnParts: [],
      ServicePrice: 0,
      ProposalLines: [
        {
          Quantity: 1,
          UnitPrice: 150,
          ExtendedTotal: 150,
          LineDescription: "1\" Lateral Line Leak",
          Part: { Id: 2289873, UnitOfMeasure: "each" },
        },
        {
          Quantity: 1,
          UnitPrice: -15,
          ExtendedTotal: -15,
          LineDescription: "CLUB Membership 10% Discount",
          Part: { Id: 940984 },
        },
      ],
    });

    expect(row.servicePrice).toBe(0);
    expect(row.partsTotal).toBe(135);
    expect(row.jobTotal).toBe(143.94);
    expect(row.lineItems).toMatchObject([
      { name: "1\" Lateral Line Leak", quantity: 1, unitPrice: 150, total: 150, sku: "2289873", unitOfMeasure: "each" },
      { name: "CLUB Membership 10% Discount", quantity: 1, unitPrice: -15, total: -15, sku: "940984" },
    ]);
  });
});
