import { useLayoutEffect } from "react";
import { blockAppUpdate } from "../updateSafety";

export function useUpdateBlocker(blocked: boolean) {
  useLayoutEffect(() => blocked ? blockAppUpdate() : undefined, [blocked]);
}
