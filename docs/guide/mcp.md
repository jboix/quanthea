# MCP server

An assistant outside quanthea reads it through an MCP server. Its tools read pinned dashboards,
alerts and reports. What they return of the data follows each connector's access level.

## Connect an assistant

Every signed-in person makes their own tokens.

1. Open the account menu and choose **MCP tokens**.
2. Name the token after what will use it.
3. Choose its role, up to your own, and how long it lasts.
4. Copy the token. It starts with `qth_` and is shown once.

The assistant connects to one address and sends the token as a header:

```
https://quanthea.example.com/api/mcp
```

In a client that takes a JSON configuration:

```json
{
  "mcpServers": {
    "quanthea": {
      "type": "http",
      "url": "https://quanthea.example.com/api/mcp",
      "headers": { "Authorization": "Bearer qth_…" }
    }
  }
}
```

The assistant can then find a dashboard, read what its panels show, check an alert and read a
report's run, and use them in its own work.

## What a token is

A token acts as you on the MCP address, with the role you gave it.

- It works on the MCP address only. Every other part of quanthea answers 403 to it.
- Give it the weakest role that does the job. Reading needs viewer.
- If your role is lowered, your tokens are lowered with it.
- A token always expires. An admin sets the longest lifetime, 365 days by default.
- You hold at most 20 tokens.
- **Revoke** stops a token at once. Disabling a user revokes all of theirs.

A leaked token cannot make another token, change a user or change a setting.

An address that keeps sending wrong tokens must wait: after 20 failures, 1 minute, then longer,
up to 15 minutes. Right tokens from that address wait too.

## What the tools do

Every tool reads. None creates, changes, pins or sends anything. Building a dashboard stays in
quanthea's own threads.

| Tool                   | What it returns                                               |
| ---------------------- | ------------------------------------------------------------- |
| `search_dashboards`    | The pinned dashboards that match words, tags or connectors.   |
| `get_dashboard`        | A dashboard's description, variables and panels.              |
| `get_panel`            | One panel as written: its queries and its view.               |
| `run_panel`            | A panel's data now, over a time range and variables.          |
| `get_variable_options` | The values a variable offers.                                 |
| `list_alerts`          | The active alerts and their conditions.                       |
| `get_alert`            | An alert's query and its state at the last evaluation.        |
| `list_reports`         | The active reports, their schedule and latest run.            |
| `get_report_run`       | A run's panels, and one panel's results as the run stored it. |
| `list_definitions`     | What the business terms mean here.                            |

The tools read what everyone signed in may see: pinned dashboards, active alerts and active
reports. Drafts and threads have no tool.

## What an assistant sees of the data

An assistant is a model, so each connector's access level applies, exactly as it does for
quanthea's own assistant ([data sources](data-sources.md)). No setting bypasses it, and a token
opens no other way to the data.

| Level | A result shows                          |
| ----- | --------------------------------------- |
| 1     | Whether the query ran.                  |
| 2     | The fields, their types and row counts. |
| 3     | A summary of each field.                |
| 4     | The rows, at most 500.                  |

Hidden fields never show. Each result names the query, the time range, the variables and the
access level it was made with, and a link that opens it in quanthea.

## Written queries

Two more tools are off by default:

- `describe_connector` lists the connectors and describes a connector's schema.
- `run_query` runs a query the assistant writes, in the connector's own language.

An admin turns them on in **Settings → MCP access → Allow written queries**. Only a token with the
editor role or above gets them. A written query only reads, stays inside the connector's scope and
limits, and its result follows the connector's access level.

## For admins

**Settings → MCP access** has three settings, one action and a record.

- **Allow MCP clients.** Turned off, the MCP address answers 403 and no token can be made. The
  tokens are kept and work again when it is turned on.

- **Allow written queries.** Adds the two tools above for editors.

- **Longest lifetime, in days.** Applies to new tokens.

- **Revoke every token.** Stops every token of every person at once. Use it when a token may
  have leaked and you do not know which. People make new ones from the account menu.

- **Activity.** Every tool call an assistant made: when, who, with which token, the tool, the
  arguments it sent, how the call ended and the address it came from. It shows the latest 200
  and keeps 90 days. A result is never kept.

Making and revoking a token is written to the audit log. Each tool call and each refused token
is also a line in the server log.
