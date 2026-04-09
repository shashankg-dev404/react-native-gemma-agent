import RNCalendarEvents from 'react-native-calendar-events';
import type { SkillManifest } from '../src/types';

export const readCalendarSkill: SkillManifest = {
  name: 'read_calendar',
  description:
    "Read events from the device calendar for a specific day. Returns event titles, times, and locations. Works completely offline — reads directly from the device's local calendar.",
  version: '1.0.0',
  type: 'native',
  requiresNetwork: false,
  category: 'utility',
  parameters: {
    date: {
      type: 'string',
      description:
        'Date to check in YYYY-MM-DD format. Defaults to today if not specified.',
    },
  },
  instructions:
    "Use this when the user asks about their schedule, calendar, meetings, appointments, or what's planned for a day. Omit the date parameter to get today's events.",
  execute: async (params) => {
    try {
      const status = await RNCalendarEvents.requestPermissions();
      if (status !== 'authorized') {
        return { error: 'Calendar permission denied by user.' };
      }

      const now = new Date();
      const dateStr = params.date
        ? String(params.date)
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const startDate = new Date(`${dateStr}T00:00:00`).toISOString();
      const endDate = new Date(`${dateStr}T23:59:59`).toISOString();

      const events = await RNCalendarEvents.fetchAllEvents(startDate, endDate);

      if (!events || events.length === 0) {
        return { result: `No events found for ${dateStr}.` };
      }

      const formatted = events
        .sort(
          (a, b) =>
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        )
        .map((e) => {
          const start = new Date(e.startDate);
          const end = new Date(e.endDate);
          const startTime = start.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          const endTime = end.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          let line = `${startTime}–${endTime}: ${e.title}`;
          if (e.location) {
            line += ` (at ${e.location})`;
          }
          return line;
        })
        .join('\n');

      return {
        result: `Calendar events for ${dateStr} (${events.length} events):\n${formatted}`,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to read calendar';
      return { error: `Calendar error: ${msg}` };
    }
  },
};
