import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { useEffect, useState } from "react";

import { atom, useAtom } from "../app-jotai";

import { APP_NAME } from "./names";

/** "Not now" hides the prompt for this long. */
export const INSTALL_PROMPT_SNOOZE = 14 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = "excalidraw-install-prompt-snoozed-at";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Chromium fires this once the page is installable; keep it for the button.
let installEvent: InstallEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event as InstallEvent;
  listeners.forEach((fn) => fn());
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  listeners.forEach((fn) => fn());
});

export const isRunningAsApp = () =>
  ["standalone", "window-controls-overlay", "minimal-ui", "fullscreen"].some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches,
  ) || !!(navigator as any).standalone;

export const shouldShowInstallPrompt = (opts: {
  runningAsApp: boolean;
  embedded: boolean;
  snoozedAt: number | null;
  now: number;
}) =>
  !opts.runningAsApp &&
  !opts.embedded &&
  (opts.snoozedAt === null ||
    opts.now - opts.snoozedAt > INSTALL_PROMPT_SNOOZE);

const readSnoozedAt = () => {
  try {
    const value = Number(localStorage.getItem(SNOOZE_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
};

/** Other dialogs (storage setup) wait while this is open. */
export const installPromptOpenAtom = atom(
  shouldShowInstallPrompt({
    runningAsApp: isRunningAsApp(),
    embedded: window.self !== window.top,
    snoozedAt: readSnoozedAt(),
    now: Date.now(),
  }),
);

export const InstallPrompt = () => {
  const [open, setOpen] = useAtom(installPromptOpenAtom);
  const [canInstall, setCanInstall] = useState(!!installEvent);

  useEffect(() => {
    const update = () => setCanInstall(!!installEvent);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (!open) {
    return null;
  }

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      // private mode: it just shows again next time
    }
    setOpen(false);
  };

  const install = async () => {
    const event = installEvent;
    if (!event) {
      return;
    }
    await event.prompt();
    const { outcome } = await event.userChoice;
    // the event can't be reused; the browser fires a new one if needed
    installEvent = null;
    setCanInstall(false);
    if (outcome === "accepted") {
      setOpen(false);
    }
  };

  return (
    <Dialog
      size="small"
      title={`Install ${APP_NAME} as an app`}
      className="local-files-dialog"
      onCloseRequest={snooze}
    >
      <p className="local-files-setup__text">
        {APP_NAME} works best installed. It gets its own window and icon, works
        offline, and keeps access to your canvases folder between launches. In a
        browser tab, the browser may ask you to allow folder access again every
        time you open it.
      </p>
      {!canInstall && (
        <p className="local-files-muted">
          To install, use the install icon at the right end of the address bar,
          or the browser menu → <em>Install app</em> (Safari: File →{" "}
          <em>Add to Dock</em>). Already installed? Open it from your apps
          instead.
        </p>
      )}
      <div className="local-files-dialog__actions">
        <FilledButton
          variant="outlined"
          color="muted"
          label={canInstall ? "Not now" : "Continue in browser"}
          onClick={snooze}
        />
        {canInstall && <FilledButton label="Install app" onClick={install} />}
      </div>
    </Dialog>
  );
};
