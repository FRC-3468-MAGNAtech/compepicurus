"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SelectedEventsPanel } from "@/components/event/selected-events-panel";
import { moveActiveEvent, toggleActiveEvent, type ActiveEventsState } from "@/lib/active-events";
import type { FtcEvent } from "@/lib/ftc/types";

const ev = (code: string, name: string): FtcEvent => ({ code, season: 2025, name, dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" });
const EVENTS = [ev("USWABON1", "Bonney Lake Qualifier"), ev("USWASEQ", "Sequim League Meet"), ev("USWATAC", "Tacoma Championship")];

function Fixture() {
  const q = useSearchParams();
  const canEdit = q.get("readonly") !== "1";
  const count = Number(q.get("events") ?? 3);
  const [state, setState] = useState<ActiveEventsState>(() => ({ events: EVENTS.slice(0, count), primaryCode: EVENTS[0].code }));

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Active Events</h1>
      <SelectedEventsPanel
        events={state.events}
        primaryCode={state.primaryCode}
        canEdit={canEdit}
        onRemove={(event) => setState(toggleActiveEvent(state, event))}
        onMove={(code, toIndex) => setState(moveActiveEvent(state, code, toIndex))}
      />
      <p data-testid="primary" data-code={state.primaryCode ?? ""}>
        Primary: {state.primaryCode}
      </p>
      <ol data-testid="order">
        {state.events.map((e) => (
          <li key={e.code}>{e.code}</li>
        ))}
      </ol>
      <div data-testid="below" className="glass-card p-4">
        Content below the panel
      </div>
      <div style={{ height: 1600 }} aria-hidden />
    </div>
  );
}

export function EventPanelFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
