# Definitions

A definition says once what your team means by a business term, such as "error rate". The agent
follows that meaning on every new dashboard, instead of reading the word literally.

## What a definition holds

- **A name and synonyms**, such as "Error rate", also "failure rate".
- **A meaning**: one or two sentences, at most 300 characters. "ERROR events, excluding business
  errors and blocked media, over START events." This alone stops the agent guessing.
- **Checked filters**, at most one set per query language. With them, the server copies the exact
  filters into the panel, so every dashboard means the same thing. A set is one of three shapes:
  - a **measure**: filters and what to measure (a count, a sum, a distinct count, a percentile);
  - a **ratio**: the filters of the part over those of the whole;
  - a **segment**: filters only, such as "production traffic", added to any panel's filters.

Checked filters apply to every connector of their language that has the same fields, such as a
production and a staging cluster. They can be limited to some connectors.

## Who does what

- Everyone opens **Definitions** in the rail and reads them.
- Editors and admins add, change and delete them. Each save is a new version; nothing is
  rewritten.
- A save is refused when the meaning or the filters name a field hidden from the model on a
  connector.
- Saving runs the checked filters once over the last day. It must run, and it says how many rows
  it found: zero rows usually means a field name is wrong.
- Definitions declared in the configuration file show the file's name and are read-only here.
  See [configuration](../configuration.md#definitions).

## Save a panel's filters

The easiest way to write checked filters is to build a panel first. In a thread, open a panel
built with a query builder and choose **Save as definition**. Pick a definition, or start a new
one with its id, name and meaning. The panel's filters become that definition's checked filters
for the panel's query language; how the panel splits and groups the data stays with the panel.

## On dashboards

- The plan says which definition each panel follows.
- A panel built from checked filters records the definition and its version. Changing the
  definition later never changes that panel, and never a pinned dashboard: ask the agent to
  rebuild the panel to take the new version.
- Where a definition has no checked filters for a source, the agent builds from the meaning and
  says so in the panel's description.
- If a panel's title names a defined term but its data was not built from the definition, the
  agent is told, and fixes it or explains why.
