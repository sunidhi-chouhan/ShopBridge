import { useState } from "react";
import { resetDemo } from "../api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

/**
 * Confirmation for the shared demo reset. The server enforces who may reset (demo
 * accounts on a deployment that enables it); this dialog prevents accidental resets.
 */
export function ResetDemoDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"confirm" | "running" | "error">("confirm");
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (phase === "running") return;
    setPhase("confirm");
    setError(null);
    onClose();
  }

  async function onConfirm() {
    if (phase === "running") return;
    setPhase("running");
    setError(null);
    try {
      await resetDemo();
      setPhase("confirm");
      onDone();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The demo could not be reset. Nothing was changed.");
      setPhase("error");
    }
  }

  return (
    <Dialog open={open} title="Reset all demo data?" onClose={close}>
      <p>
        This will restore ShopBridge to its original demo state. All changes made by demo users—including new orders,
        cart updates, product changes, and support activity—will be removed. All demo accounts and sample data will be
        restored.
      </p>
      <p className="meta reset-scope">
        This is a shared demo: everyone using it right now will see the restored data. Fresh order conversations are
        created in Nexconn. Accounts that are not demo accounts are kept.
      </p>
      {phase === "running" ? (
        <p className="note" role="status">
          Restoring the demo… this takes a few seconds.
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <Button variant="secondary" onClick={close} disabled={phase === "running"}>
          Cancel
        </Button>
        <Button variant="danger" pending={phase === "running"} onClick={() => void onConfirm()}>
          Reset Demo Data
        </Button>
      </div>
    </Dialog>
  );
}
