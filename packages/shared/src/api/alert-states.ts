/** The states a series of an alert is in, and its labels: what the alert contracts share. */
import { z } from 'zod';

/** The states of a series: the condition holds for a while, fires, or the data is missing. */
export const alertStates = ['ok', 'pending', 'firing', 'no_data', 'error'] as const;

/** The state of a series. */
export type AlertState = (typeof alertStates)[number];

/** Validates a series' labels. */
export const seriesLabelsSchema = z.record(z.string(), z.string());
