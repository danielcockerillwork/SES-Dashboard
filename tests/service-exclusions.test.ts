import { describe, expect, it } from "vitest";
import { isExcludedServiceName } from "@/lib/serviceminder/service-exclusions";

describe("service exclusions", () => {
  it("matches service names case-insensitively", () => {
    expect(isExcludedServiceName("Installation Estimate", ["installation estimate"])).toBe(true);
    expect(isExcludedServiceName("Meeting", ["New System Quote"])).toBe(false);
  });

  it("always excludes new system quote variants", () => {
    expect(isExcludedServiceName("New System Quote", [])).toBe(true);
    expect(isExcludedServiceName("Residential New System Estimate", [])).toBe(true);
    expect(isExcludedServiceName("New System Walkthrough", [])).toBe(false);
  });

  it("always excludes drainage quote variants without hiding drainage service work", () => {
    expect(isExcludedServiceName("Drainage Quote", [])).toBe(true);
    expect(isExcludedServiceName("Backyard Drainage Estimate", [])).toBe(true);
    expect(isExcludedServiceName("Drainage Repair", [])).toBe(false);
  });

  it("always excludes installation estimate variants without hiding installation service work", () => {
    expect(isExcludedServiceName("Installation Estimate", [])).toBe(true);
    expect(isExcludedServiceName("Commercial Installation Quote", [])).toBe(true);
    expect(isExcludedServiceName("Installation Service", [])).toBe(false);
  });
});
