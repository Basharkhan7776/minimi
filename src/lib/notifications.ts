import { isTauri } from "./external";

async function tauriNotification() {
  return import("@tauri-apps/plugin-notification");
}

export async function notificationPermission(): Promise<
  "granted" | "denied" | "default" | "unsupported"
> {
  if (isTauri()) {
    try {
      const { isPermissionGranted } = await tauriNotification();
      return (await isPermissionGranted()) ? "granted" : "default";
    } catch {
      return "unsupported";
    }
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } =
        await tauriNotification();
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function showSystemNotification(input: {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}): Promise<boolean> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, sendNotification } =
        await tauriNotification();
      if (!(await isPermissionGranted())) return false;
      sendNotification({
        title: input.title,
        body: input.body,
        group: input.tag,
      });
      return true;
    } catch {
      return false;
    }
  }

  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }
  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.tag,
    });
    notification.onclick = () => {
      window.focus();
      input.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
