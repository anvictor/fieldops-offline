import { useContext } from "react";
import { OnlineStatusContext } from "../contexts/OnlineStatusContext";

export function useOnlineStatus(): boolean {
  const isOnline = useContext(OnlineStatusContext);

  if (isOnline === undefined) {
    throw new Error("useOnlineStatus must be used within an OnlineStatusProvider");
  }

  return isOnline;
}
