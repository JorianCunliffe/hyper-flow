import type { CalendarLedger } from "./model.js";
import {
  readCalendarLedger,
  listCalendarLedgers,
  transactCalendarLedger,
} from "../serverStore.js";
export interface CalendarStore {
  read(orgId: string, id: string): Promise<CalendarLedger | null>;
  list(orgId: string): Promise<CalendarLedger[]>;
  transact(
    orgId: string,
    id: string,
    update: (current: CalendarLedger | null) => CalendarLedger,
  ): Promise<CalendarLedger>;
}
export const calendarStore: CalendarStore = {
  read: readCalendarLedger,
  list: listCalendarLedgers,
  transact: transactCalendarLedger,
};
