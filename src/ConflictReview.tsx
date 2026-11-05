import { useEffect, useRef, useState } from "react";
import { normalizeTitle } from "./api";
import { loadReviewDraft, saveReviewDraft } from "./db";
import type { StoredInspection } from "./db";
import { useUpdateBlocker } from "./hooks/useUpdateBlocker";

type Props = {
  itemId: string;
  pending: StoredInspection;
  current?: StoredInspection;
  busy: boolean;
  review: () => Promise<void>;
  save: (title: string, status: StoredInspection["status"], version: number) => Promise<void>;
};

export function ConflictReview({ itemId, pending, current, busy, review, save }: Props) {
  const [title, setTitle] = useState(pending.title);
  const [status, setStatus] = useState(pending.status);
  const [storageError, setStorageError] = useState("");
  const edited = useRef(false);
  const draftSequence = useRef(0);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedDraft, setSavedDraft] = useState(false);
  useUpdateBlocker(savingDraft || title !== pending.title || status !== pending.status);
  useEffect(() => {
    let active = true;
    const writes = draftSequence;
    void loadReviewDraft(itemId).then(draft => {
      if (active && !edited.current && draft) { setTitle(draft.title); setStatus(draft.status); setSavedDraft(true); }
    }).catch(() => { if (active) setStorageError("Could not restore the review draft. Pending changes are retained."); });
    return () => { active = false; writes.current++; };
  }, [itemId]);
  function change(nextTitle: string, nextStatus: StoredInspection["status"]) {
    edited.current = true;
    setTitle(nextTitle); setStatus(nextStatus);
    const sequence = ++draftSequence.current;
    setSavingDraft(true); setSavedDraft(false); setStorageError("");
    void saveReviewDraft(itemId, { title: nextTitle, status: nextStatus }).then(() => {
      if (sequence === draftSequence.current) { setSavingDraft(false); setSavedDraft(true); }
    }).catch(() => {
      if (sequence === draftSequence.current) {
        setSavingDraft(false); setStorageError("Could not persist this review draft. Copy it before reloading.");
      }
    });
  }
  return <section className="conflict-review" role="region" aria-label="Review conflicting inspection">
    <h3>Review conflicting inspection</h3>
    <p>Pending title: {pending.title}</p>
    <p>Pending status: {pending.status}</p>
    {current ? <>
      <p>Server title: {current.title}</p>
      <p>Server status: {current.status}</p>
      <p>Server version: {current.version}</p>
    </> : <p>Review the current server version before saving this retained change.</p>}
    <button disabled={busy} onClick={() => void review()}>Review server version</button>
    <form onSubmit={event => { event.preventDefault(); if (current?.version) void save(title, status, current.version); }}>
      <label>Reviewed title<input value={title} disabled={busy} onChange={event => change(event.target.value, status)} /></label>
      <label>Reviewed status<select value={status} disabled={busy}
        onChange={event => change(title, event.target.value as StoredInspection["status"])}>
        <option value="draft">Draft</option><option value="completed">Completed</option>
      </select></label>
      <button disabled={busy || savingDraft || !current || !normalizeTitle(title)} type="submit">Save reviewed changes</button>
    </form>
    <p>Saving sends your reviewed title and status. Other pending edits may need separate review. Deleting an inspection removes it even if someone else edited it.</p>
    <p aria-live="polite">{savingDraft ? "Saving review draft…" : savedDraft ? "Review draft saved on this device." : ""}</p>
    {storageError && <p role="alert">{storageError}</p>}
  </section>;
}
