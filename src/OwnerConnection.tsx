import { useId, useState } from "react";

type Props = {
  connected: boolean;
  available: boolean;
  unavailableReason?: string;
  connect: (token: string | null) => Promise<boolean>;
};

export function OwnerConnection({ connected, available, unavailableReason, connect }: Props) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || !/^[A-Za-z0-9_-]{43,128}$/.test(draft)) {
      setError("Enter a valid owner token for the configured HTTPS API.");
      return;
    }
    const token = draft;
    setDraft("");
    setError("");
    void connect(token).then((accepted) => {
      if (!accepted) setError("Could not connect securely. Check this browser and API configuration.");
    });
  }

  return <aside aria-label="Private synchronization">
    <h2>Private synchronization</h2>
    <p>Connecting sends pending inspections to your configured API. The owner token grants access to all inspections on that API; keep it private.</p>
    <p>The token stays in this tab’s memory. Reloading or disconnecting clears it. Local inspections stay on this device.</p>
    {connected ? <>
      <p>Owner token entered for this tab.</p>
      <button onClick={() => { setDraft(""); setError(""); void connect(null); }}>Disconnect</button>
    </> : <form onSubmit={submit} autoComplete="off">
      <label htmlFor={inputId}>Owner token</label>
      <input id={inputId} type="password" autoComplete="off" spellCheck={false}
        value={draft} disabled={!available} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" disabled={!available || !draft}>Connect</button>
    </form>}
    {!available && <p>{unavailableReason ?? "Secure API synchronization is not configured. You can keep working offline."}</p>}
    {error && <p role="alert">{error}</p>}
    <p>Disconnect stops new requests. A request already received by the API may still complete.</p>
  </aside>;
}
