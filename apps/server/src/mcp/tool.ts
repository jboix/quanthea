/**
 * What an MCP tool is: a name, a description written for a model, a Zod schema for its arguments,
 * the weakest role that may call it, and the function that runs it. Every tool reads; none writes.
 */
import type { McpCallOutcome, Principal, Role } from '@quanthea/shared';
import { z } from 'zod';

/** A tool call that has ended, for the record of what tokens did. */
export interface ToolCallNote {
  /** The tool, as the caller named it. */
  readonly tool: string;
  /** The arguments the caller sent. */
  readonly input: unknown;
  /** Whether it answered, was refused (also an unknown tool), or failed. */
  readonly outcome: McpCallOutcome;
  /** How long it took. */
  readonly durationMs: number;
}

/** What a tool call runs with. */
export interface McpToolContext {
  /** Who the call acts as: the owner of the API token, with the token's role. */
  readonly principal: Principal;
  /** Aborted when the client goes away. */
  readonly signal: AbortSignal;
  /** Told of each tool call when it ends, whatever its outcome. */
  readonly onCall?: (note: ToolCallNote) => void;
}

/** A refusal of a tool call that the model can read and correct. */
export class ToolRefusal extends Error {
  /**
   * Creates a refusal.
   *
   * @param message - What is wrong, written for the model, quoting no data.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ToolRefusal';
  }
}

/**
 * What a tool reads. `read` tools read what is pinned or active. `query` tools describe a
 * connector's schema and run a query the caller wrote.
 */
export type ToolGroup = 'read' | 'query';

/** A tool as the endpoint lists and calls it. */
export interface McpTool {
  /** The name a client calls it by. */
  readonly name: string;
  /** A short name for people. */
  readonly title: string;
  /** What it returns and when to use it, for the model. */
  readonly description: string;
  /** The JSON Schema of its arguments. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** The weakest role that may call it. */
  readonly minimumRole: Role;
  /** `query` for a tool that runs a query its caller wrote: an admin turns those on. */
  readonly group: ToolGroup;
  /**
   * Runs the tool.
   *
   * @param input - The arguments as sent.
   * @param context - Who calls, and the signal.
   * @returns The result, a JSON object.
   * @throws {ToolRefusal} When the arguments do not match the schema.
   */
  call(input: unknown, context: McpToolContext): Promise<object>;
}

/** The fields {@link defineTool} takes. */
interface ToolDefinition<Schema extends z.ZodType> {
  /** The name a client calls it by. */
  readonly name: string;
  /** A short name for people. */
  readonly title: string;
  /** What it returns and when to use it, for the model. */
  readonly description: string;
  /** Validates its arguments. */
  readonly input: Schema;
  /** The weakest role that may call it. */
  readonly minimumRole: Role;
  /** `query` for a tool that runs a query its caller wrote. */
  readonly group: ToolGroup;
  /**
   * Runs the tool on arguments that passed the schema.
   *
   * @param input - The parsed arguments.
   * @param context - Who calls, and the signal.
   * @returns The result, a JSON object.
   */
  run(input: z.output<Schema>, context: McpToolContext): object | Promise<object>;
}

/**
 * The problems of arguments that failed their schema, one per line.
 *
 * @param error - The validation error.
 * @returns The lines.
 */
function issueLines(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || 'arguments'}: ${issue.message}`)
    .join('\n');
}

/**
 * Declares a tool. Its arguments are parsed with the schema before it runs.
 *
 * @param definition - The name, the texts, the schema, the role and the function.
 * @returns The tool.
 */
export function defineTool<Schema extends z.ZodType>(definition: ToolDefinition<Schema>): McpTool {
  const { name, title, description, minimumRole, group } = definition;
  const schema = z.toJSONSchema(definition.input, { io: 'input', unrepresentable: 'any' });
  return {
    name,
    title,
    description,
    minimumRole,
    group,
    inputSchema: schema as Record<string, unknown>,
    call: async (input, context) => {
      const parsed = definition.input.safeParse(input ?? {});
      if (!parsed.success)
        throw new ToolRefusal(`Invalid arguments for ${name}:\n${issueLines(parsed.error)}`);
      return definition.run(parsed.data, context);
    },
  };
}
