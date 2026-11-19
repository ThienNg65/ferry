# File Visibility Filters

**File Visibility Filters** let you show or hide files in Ferry's remote SFTP file explorer using standard filename glob patterns (`*`, `?`).

> [!NOTE]
> File Visibility Filters are a **non-destructive view filter**. Hiding files only omits them from the directory listing — Ferry never deletes, renames, moves, or modifies files on the remote server.

## How it works

Click the **Filter files** button (funnel icon) in the remote pane toolbar to configure rules for the current connection:

- **Show only matching (include):** When non-empty, only files matching at least one include pattern are shown.
- **Hide matching (exclude):** Files matching any exclude pattern are hidden, even if they also match an include pattern (**excludes win**).
- **One pattern per line:** Multiple patterns within the same box are combined with **OR** logic.
- **Basename & case-sensitive matching:** Patterns match against each file's basename (not its full remote path) and are case-sensitive to match standard Linux SFTP servers.
- **Directories always stay visible:** Folders remain visible and navigable regardless of include/exclude rules.
- **Independent of search, sort, and hidden files:**
  - `Ctrl+F` (**Search files**) remains a quick per-folder substring search.
  - `Ctrl+H` (**Show/hide hidden files**) and column sorting work alongside visibility filters.
- **Per-connection persistence:** Filters persist per saved site (site ID) or Quick Connect endpoint (case-sensitive username, normalized hostname, and SSH port) across directory navigation, tab switches, reconnects, and app restarts. Connections to different SSH ports do not share rules.

### Existing Quick Connect filters

Earlier Ferry versions stored Quick Connect filters under `username@host` without the port. When the same endpoint is next opened on **port 22**, Ferry copies that legacy filter to its new port-specific key and deletes the old shared key. Connections on other ports start with no inherited filter; configure them individually. If a port-specific filter already exists, it takes precedence over the legacy filter. Saved-site filters are not migrated or changed.

## Pattern syntax

| Wildcard | Meaning | Example | Matches |
|---|---|---|---|
| `*` | Zero or more characters | `*.log` | `app.log`, `service.log` |
| `?` | Exactly one character | `*.log.????-??-??` | `app.log.2026-06-17` |

## Pattern helper (paste a filename)

If you are unsure how to write a glob pattern, paste an example filename (or remote path) into the **Pattern helper** box inside the **Filter files** popover—for example:

```text
cob-address-verification-adapter-service.log.2026-06-17
```

Ferry suggests ready-to-use patterns such as `*.log.????-??-??` and `cob-address-verification-adapter-service.log.????-??-??` with one-click **+ Include** and **+ Exclude** buttons.

## Common patterns

### Rotated logs

- **Keep only active `.log` files (include):**
  ```text
  *.log
  ```
- **Hide ISO-dated rotated logs (exclude):**
  ```text
  *.log.????-??-??
  ```
- **Hide numbered or compressed log rotations (exclude):**
  ```text
  *.log.*
  *.log.gz
  *.gz
  ```

### Temporary files

- **Hide editor swap, partial, and temp files (exclude):**
  ```text
  *.tmp
  *.temp
  *.swp
  *.swo
  ~*
  *.part
  ```

### Backups

- **Hide backup and patch artifacts (exclude):**
  ```text
  *.bak
  *.orig
  *.old
  *~
  ```

## Clearing filters

Click **Clear filters** inside the **Filter files** popover, in the remote pane footer bar, or in the empty-state prompt when no files match. Clearing restores all otherwise-visible files without reloading or losing your current directory.
