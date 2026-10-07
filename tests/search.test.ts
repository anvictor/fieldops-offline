import { describe, expect, it } from "vitest";
import { searchInspections } from "../src/search";
import type { StoredInspection } from "../src/db";
const rows: StoredInspection[] = [
  { id: "one", title: "Насос 💧 Pump", status: "draft" },
  { id: "two", title: "PUMP [A].*", status: "completed" },
  { id: "three", title: "Café valve", status: "draft" },
];
describe("offline title search", () => {
  it("matches trimmed Unicode and Latin queries without case sensitivity", () => {
    expect(searchInspections(rows, " НАСОС ", "all")).toEqual([rows[0]]);
    expect(searchInspections(rows, "pump", "all")).toEqual(rows.slice(0, 2));
    expect(searchInspections(rows, "💧", "all")).toEqual([rows[0]]);
  });
  it("combines status and title rather than searching outside the selected status", () => {
    expect(searchInspections(rows, "pump", "draft")).toEqual([rows[0]]);
    expect(searchInspections(rows, "pump", "completed")).toEqual([rows[1]]);
    expect(searchInspections(rows, "valve", "completed")).toEqual([]);
  });
  it("blank/whitespace matches all titles while retaining status", () => {
    expect(searchInspections(rows, "", "all")).toEqual(rows);
    expect(searchInspections(rows, " \n ", "draft")).toEqual([rows[0], rows[2]]);
  });
  it("treats punctuation literally and does not fold diacritics", () => {
    expect(searchInspections(rows, ".*", "all")).toEqual([rows[1]]);
    expect(searchInspections(rows, "[a]", "all")).toEqual([rows[1]]);
    expect(searchInspections(rows, "cafe", "all")).toEqual([]);
    expect(searchInspections(rows, "CAFÉ", "all")).toEqual([rows[2]]);
  });
  it("preserves source/order and cannot mutate a frozen dataset", () => {
    const frozen = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    const matches = searchInspections(frozen, "", "all");
    expect(matches).toEqual(rows); expect(matches).not.toBe(frozen);
    matches.pop(); expect(frozen).toHaveLength(3);
  });
  it("handles empty and no-match datasets", () => {
    expect(searchInspections([], "pump", "all")).toEqual([]);
    expect(searchInspections(rows, "missing", "all")).toEqual([]);
  });
});
