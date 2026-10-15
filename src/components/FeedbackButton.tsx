import { useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";
import { feedbackApi } from "@/api/client";
import type { FeedbackRequest } from "@/api/types";
import { Button, ErrorNote, Label, Textarea } from "./ui";
import { useToast } from "./toast";

/**
 * Feedback skickas till backend (/api/feedback) via Workern – kräver inloggning.
 * Skärmdumpar tas medvetet inte automatiskt: de kan innehålla klientuppgifter.
 */
export function FeedbackButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<FeedbackRequest["priority"]>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    if (!description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await feedbackApi.send({
        description: description.trim(),
        priority,
        path: window.location.pathname,
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
      toast("Tack! Feedbacken är skickad.");
      setDescription("");
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted shadow-sm hover:text-ink"
      >
        <MessageSquarePlus className="size-3.5" aria-hidden /> Feedback
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="fb-title">
          <div className="w-full max-w-md rounded-lg bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="fb-title" className="font-serif text-xl">
                Lämna feedback
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Stäng">
                <X className="size-5 text-muted" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="fb-desc">Vad hände eller vad saknas?</Label>
                <Textarea id="fb-desc" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
                <p className="mt-1 text-xs text-muted">Skriv inte in känsliga klientuppgifter här.</p>
              </div>
              <div>
                <Label htmlFor="fb-prio">Prioritet</Label>
                <select
                  id="fb-prio"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as FeedbackRequest["priority"])}
                  className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"
                >
                  <option value="low">Låg</option>
                  <option value="normal">Normal</option>
                  <option value="high">Hög</option>
                </select>
              </div>
              {error != null && <ErrorNote error={error} />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Avbryt
                </Button>
                <Button onClick={submit} loading={busy} disabled={!description.trim()}>
                  Skicka
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
