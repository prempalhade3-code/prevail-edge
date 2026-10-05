import { EventStream } from "../components/EventStream";
import { PageIntro } from "../components/ui";
import type { TimelineEvent } from "../types";

export function TimelinePage({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="px-5 py-6">
      <PageIntro
        title="Event timeline"
        detail="Chronological stream from the live snapshot and /v1/history/events. Resource snapshots are filtered out."
      />
      <EventStream events={events} limit={80} />
    </div>
  );
}
