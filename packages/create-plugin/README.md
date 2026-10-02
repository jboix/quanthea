# @quanthea/create-plugin

Creates a [quanthea](https://github.com/jboix/quanthea) plugin project.

```sh
npm create @quanthea/plugin
```

It asks for the package name, the connector kind's identifier and display name, its query
language and, for SQL, the dialect and its styles, then writes a project that builds, passes the
kit's static checks and installs into quanthea. The connection answers with empty results until
you write it.

Every question has a flag, and `--yes` takes the defaults for the rest:

```sh
npm create @quanthea/plugin -- --name quanthea-plugin-duckdb --language sql --dialect ansi --yes
```

`--help` lists them. The generated project uses [Bun](https://bun.sh).

## Licence

MIT
