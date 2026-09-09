import React from 'react';

/** A failed connection check is not evidence that an account has no mailboxes. */
export function ServiceStatusNotices({ status }: { status?: { mailboxStatus?: string; upgradeRequired?: boolean } }) {
  return <>
    {status?.mailboxStatus === 'unavailable' && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      Mailbox status is unavailable. Check the Communications connection before relying on this status report.
    </p>}
    {status?.upgradeRequired && <p role="status" className="mt-2 text-xs font-bold text-amber-700">
      A legacy triage schedule is not linked to a project. Review it in schedule settings to link or pause it. Reading this status has not changed the schedule.
    </p>}
  </>;
}
