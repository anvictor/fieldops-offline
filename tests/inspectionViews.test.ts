import { describe, expect, it } from "vitest";
import { reconcileInspections } from "../src/hooks/useInspections";
import type { InspectionRow } from "../src/hooks/useInspections";
const record = { id: "one", title: "Original", status: "draft" as const };
describe("cross-tab inspection views", () => {
  it("refreshes committed fields while retaining editor identity; deleted editors alone survive", () => {
    const old: InspectionRow[] = [{ inspection: record, editing: true, deleted: false },
      { inspection: { ...record, id: "two" }, editing: false, deleted: false }];
    const updated = reconcileInspections(old, [{ ...record, title: "Other tab" }]);
    expect(updated).toEqual([{ inspection: { ...record, title: "Other tab" }, editing: true, deleted: false }]);
    expect(reconcileInspections(updated, [])).toEqual([{ ...updated[0], deleted: true }]);
    expect(reconcileInspections([{ ...updated[0], editing: false }], [])).toEqual([]);
  });
});
