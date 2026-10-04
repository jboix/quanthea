/** Every channel kind's recipe, by kind. */
import type { ChannelKind } from '@quanthea/shared';
import { discordRecipe } from './discord.ts';
import { pagerDutyRecipe } from './pagerduty.ts';
import type { ChannelRecipe } from './recipe.ts';
import { slackRecipe } from './slack.ts';
import { teamsRecipe } from './teams.ts';
import { webhookRecipe } from './webhook.ts';

/** The recipes, by kind. */
export const channelRecipes: Readonly<Record<ChannelKind, ChannelRecipe>> = {
  webhook: webhookRecipe,
  slack: slackRecipe,
  discord: discordRecipe,
  teams: teamsRecipe,
  pagerduty: pagerDutyRecipe,
};
