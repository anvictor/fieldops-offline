export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type InspectionInput = { id?: string; title?: string; status?: "draft" | "completed" };

export function inspectionId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "INVALID_INPUT", "id must be a UUID.");
  }
  return value.toLowerCase();
}

export function inspectionInput(body: unknown, partial = false, allowId = false): InspectionInput {
  const invalid = (message: string): never => { throw new ApiError(400, "INVALID_INPUT", message); };
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("Body must be a JSON object.");
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "title" && key !== "status" && !(allowId && key === "id"))) return invalid("Unexpected inspection field.");
  if (partial && keys.length === 0) return invalid("Provide title or status to update.");
  const result: InspectionInput = {};
  if (allowId && Object.hasOwn(input, "id")) result.id = inspectionId(input.id);
  if (!partial || Object.hasOwn(input, "title")) {
    if (typeof input.title !== "string") return invalid("title must be a string.");
    const title = input.title.trim();
    if (!title || [...title].length > 200 || title.includes("\u0000")) {
      return invalid("title must contain 1–200 characters and no null characters.");
    }
    result.title = title;
  }
  if (Object.hasOwn(input, "status")) {
    if (input.status !== "draft" && input.status !== "completed") return invalid("status must be draft or completed.");
    result.status = input.status;
  }
  return result;
}
