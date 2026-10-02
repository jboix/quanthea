/** How plugins and connector kinds are named, as the loader and the static checks read them. */

/** A plugin's npm package name: `quanthea-plugin-<name>` or `@scope/quanthea-plugin-<name>`. */
export const pluginNamePattern = /^(@[a-z0-9][a-z0-9._-]*\/)?quanthea-plugin-[a-z0-9][a-z0-9._-]*$/;

/** A connector kind identifier: lowercase letters, digits and dashes, up to 40 characters. */
export const kindPattern = /^[a-z][a-z0-9-]{0,39}$/;
