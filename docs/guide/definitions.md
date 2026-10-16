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

- Everyone opens **Definitions** in the rail, searches them and reads them.
- Editors and admins add, change and delete them. Each save is a new version; nothing is
  rewritten.
- A save is refused when the meaning or the filters name a field hidden from the model on a
  connector.
- Saving runs the checked filters once over the last day. It must run, and it says how many rows
  it found: zero rows usually means a field name is wrong.
- Definitions declared in the configuration file show the file's name and are read-only here.
  See [configuration](../configuration.md#definitions).

## Ask the assistant

The assistant sits beside the definitions, for editors and admins. Describe your terms in a
sentence each, or paste a whole glossary.

1. It reads your connectors and finds the tables, fields and values each term uses.
2. When more than one connector could hold the data, it asks which ones to check. Tick as many as
   apply, then **Send**.
3. It writes each definition and test-runs its filters over the last day, saving nothing.
4. A card lists the definitions: the meaning, the other words for it, and the filters in plain
   words, with how many rows they found. **Save** one, or **Save all**.

Reply in the same conversation to change a proposal. To change a definition you already have, open
it and choose **Ask the assistant**. Past conversations are listed under the assistant's box.

In a dashboard thread the agent offers a definition too, once a panel computes a term your team has
not defined. The same card shows in the conversation.

## Write one by hand

Choose **Write one by hand**, give the term a name and say what it means. Its id comes from the
name. To add checked filters, choose **Add checked filters**:

- **What it is**: a share (failed orders out of all orders), a number (revenue), or a set of rows
  (production traffic).
- **Data**: the query language and the table, index, collection or metric the rows come from.
- **Filters**: each a field, how it compares (is, is not, matches, does not match) and a value. A
  share has the whole, which may be every row, and the part.
- **In words** says what the filters mean as you write them.

Checked filters the form cannot show stay as their query builder request, in JSON.

## Save a panel's filters

In a thread, open a panel built with a query builder and choose **Save as definition**. Pick a
definition, or start a new one with its name and meaning. The panel's filters become that
definition's checked filters for the panel's query language; how the panel splits and groups the
data stays with the panel. On a panel built otherwise the button says why it cannot save.

## On dashboards

- The plan says which definition each panel follows.
- A panel built from checked filters records the definition and its version. Changing the
  definition later never changes that panel, and never a pinned dashboard: ask the agent to
  rebuild the panel to take the new version.
- Where a definition has no checked filters for a source, the agent builds from the meaning and
  says so in the panel's description.
- If a panel's title names a defined term but its data was not built from the definition, the
  agent is told, and fixes it or explains why.
