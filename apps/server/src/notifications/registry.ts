/** Every channel kind's recipes, by kind: one for alerts, one for reports. */
import type { ChannelKind } from '@quanthea/shared';
import { alertmanagerRecipe } from './alertmanager.ts';
import { discordRecipe } from './discord.ts';
import { pagerDutyRecipe } from './pagerduty.ts';
import type { ChannelRecipe } from './recipe.ts';
import { alertmanagerReportRecipe } from './report-alertmanager.ts';
import { discordReportRecipe } from './report-discord.ts';
import { pagerDutyReportRecipe } from './report-pagerduty.ts';
import type { ReportRecipe } from './report-recipe.ts';
import { slackReportRecipe } from './report-slack.ts';
import { teamsReportRecipe } from './report-teams.ts';
import { webhookReportRecipe } from './report-webhook.ts';
import { slackRecipe } from './slack.ts';
import { teamsRecipe } from './teams.ts';
import { webhookRecipe } from './webhook.ts';

/** The alert recipes, by kind. */
export const channelRecipes: Readonly<Record<ChannelKind, ChannelRecipe>> = {
  webhook: webhookRecipe,
  slack: slackRecipe,
  discord: discordRecipe,
  teams: teamsRecipe,
  pagerduty: pagerDutyRecipe,
  alertmanager: alertmanagerRecipe,
};

/** The report recipes, by kind. */
export const reportRecipes: Readonly<Record<ChannelKind, ReportRecipe>> = {
  webhook: webhookReportRecipe,
  slack: slackReportRecipe,
  discord: discordReportRecipe,
  teams: teamsReportRecipe,
  pagerduty: pagerDutyReportRecipe,
  alertmanager: alertmanagerReportRecipe,
};
