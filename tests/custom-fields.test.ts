import { describe, expect, it } from "vitest";
import { extractCustomFields, summarizeFieldValues } from "@/lib/serviceminder/custom-fields";

describe("custom field extraction", () => {
  it("extracts array-based custom fields and score-like values", () => {
    const fields = extractCustomFields({
      AppointmentId: 1,
      CustomFields: [
        { Name: "Water Conservation Score", Value: "92" },
        { Label: "Follow-up Required", Value: "No" },
      ],
    });

    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe("Follow-up Required");
    expect(fields[1].name).toBe("Water Conservation Score");
    expect(fields[1].numericValue).toBe(92);
    expect(fields[1].scoreLike).toBe(true);
  });

  it("extracts object-map field containers and preserves mixed value types", () => {
    const fields = extractCustomFields({
      CustomFieldValues: {
        "Irrigation Health Rating": { Score: 8 },
        "Controller Program Updated": true,
        "Technician Note": "Zones adjusted",
      },
    });

    expect(fields.map((field) => field.name)).toEqual([
      "Controller Program Updated",
      "Irrigation Health Rating",
      "Technician Note",
    ]);
    expect(fields.find((field) => field.name === "Controller Program Updated")?.valueType).toBe("boolean");
    expect(fields.find((field) => field.name === "Technician Note")?.displayValue).toBe("Zones adjusted");
  });

  it("does not mistake CustomerName for a direct custom field", () => {
    const fields = extractCustomFields({
      CustomerName: "Casey Nguyen",
      CustomScore: 88,
      Custom_Rating: 7,
    });

    expect(fields.map((field) => field.name)).toEqual(["Rating", "Score"]);
  });

  it("summarizes coverage, missing counts, top values, and score statistics", () => {
    const fields = [
      ...extractCustomFields({ CustomFields: [{ Name: "Water Score", Value: "90" }] }),
      ...extractCustomFields({ CustomFields: [{ Name: "Water Score", Value: "80" }] }),
      ...extractCustomFields({ CustomFields: [{ Name: "Follow-up", Value: "Yes" }] }),
    ];

    const summaries = summarizeFieldValues(4, fields);
    const waterScore = summaries.find((summary) => summary.name === "Water Score");
    const followUp = summaries.find((summary) => summary.name === "Follow-up");

    expect(waterScore?.count).toBe(2);
    expect(waterScore?.missingCount).toBe(2);
    expect(waterScore?.average).toBe(85);
    expect(waterScore?.scoreLike).toBe(true);
    expect(followUp?.topValues).toEqual([{ value: "Yes", count: 1 }]);
  });
});
