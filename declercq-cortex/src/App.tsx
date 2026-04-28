import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { FrontmatterPanel } from "./components/FrontmatterPanel";
import { BacklinksPanel } from "./components/BacklinksPanel";
import { CommandPalette } from "./components/CommandPalette";
import { RelatedHierarchyPanel } from "./components/RelatedHierarchyPanel";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { MarkQueueView } from "./components/MarkQueueView";
import { IdeaLog } from "./components/IdeaLog";
import { MethodsArsenal } from "./components/MethodsArsenal";
import { ProtocolsLog } from "./components/ProtocolsLog";
import { PDFReader } from "./components/PDFReader";
import { ReviewsMenu, type DestinationChoice } from "./components/ReviewsMenu";
import { ColorLegend } from "./components/ColorLegend";
import { ExperimentBlockModal } from "./components/ExperimentBlockModal";
import { InsertTableModal } from "./components/InsertTableModal";
import { ThemeToggle, useTheme } from "./components/ThemeToggle";
import {
  NewHierarchyModal,
  type HierarchyKind,
} from "./components/NewHierarchyModal";
import { parseFrontmatter, serializeFrontmatter } from "./utils/frontmatter";

/** Local YYYY-MM-DD — uses the user's timezone, never UTC. */
function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Strip `<mark class="mark-X">…</mark>` tags from a string. */
function stripMarkTags(s: string): string {
  return (s ?? "").replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "");
}

/**
 * True when keyboard focus is somewhere inside the TipTap editor.
 *
 * Used to gate the App-level hierarchy shortcuts (Ctrl+N, Ctrl+Shift+P/E/I)
 * so they don't fire while the user is typing. The editor binds its own
 * keymap to its DOM root via ProseMirror — when focus is in there, the
 * editor's shortcuts (text alignment Ctrl+Shift+L/E/R, marks, bold/italic,
 * etc.) win because ProseMirror's keymap plugin handles them locally.
 *
 * `.ProseMirror` is the class TipTap puts on the editable root.
 */
function isEditorFocused(): boolean {
  const ae = document.activeElement;
  if (!ae) return false;
  return !!(ae as Element).closest?.(".ProseMirror");
}

/**
 * Cluster 3: filenames at the vault root that are auto-generated
 * destination files. When the user navigates to one, we regenerate the
 * auto section before reading.
 */
const PERSISTENT_FILE_BASENAMES = new Set<string>([
  "Bottlenecks.md",
  "Anti-Hype.md",
  "citations-to-use.md",
  "Concept Inbox.md",
]);

// Cortex — local-first research notebook
//
// Phase 1, Week 1:
//   Day 1: vault picker + persistent config
//   Day 2: file tree sidebar
//   Day 3: expansion state + refresh button
//   Day 4: filesystem watcher
//
// Phase 1, Week 2:
//   Day 1–2: TipTap editor (read then editable)
//   Day 3:   save-to-disk (Ctrl+S + 5min autosave)
//   Day 4:   frontmatter parse / panel / round-trip
//   Day 5:   git auto-commit (30s debounce) + last-open file restore
//
// Phase 1, Week 3:
//   Day 1: daily log (Ctrl+D)
//   Day 2: SQLite FTS5 index
//   Day 3: wikilinks (plain text + Ctrl+Click follow + auto-create)
//   Day 4: backlinks panel
//   Day 5: command palette (Ctrl+K)

// 5 minutes after last keystroke → autosave.
const AUTOSAVE_MS = 5 * 60 * 1000;
// 30 seconds after last save → git commit.
const COMMIT_MS = 30_000;

interface NoteListItem {
  path: string;
  title: string;
}

function App() {
  // --- vault + selection ------------------------------------------------
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Bumped every time we re-index something — backlinks panel re-fetches.
  const [indexVersion, setIndexVersion] = useState(0);

  // --- file editing state ----------------------------------------------
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [fileBody, setFileBody] = useState<string>("");
  const [editedBody, setEditedBody] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);

  // --- timers ----------------------------------------------------------
  const commitTimerRef = useRef<number | null>(null);

  // --- modals ----------------------------------------------------------
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hierarchyKind, setHierarchyKind] = useState<HierarchyKind | null>(
    null,
  );

  // --- main pane mode --------------------------------------------------
  // 'editor'           — normal Editor view of selectedPath
  // 'queue-yellow' / 'queue-green' — virtual destination view
  // 'idea-log'         — Cluster 8 structured view over type:idea notes
  // 'methods-arsenal'  — Cluster 8 structured view over type:method notes
  // 'protocols-log'    — Cluster 8 catalogue over type:protocol notes
  // 'pdf-reader'       — Cluster 6 PDF viewer (selected when a .pdf file
  //                      is clicked in the file tree)
  type ActiveView =
    | "editor"
    | "queue-yellow"
    | "queue-green"
    | "idea-log"
    | "methods-arsenal"
    | "protocols-log"
    | "pdf-reader";
  const [activeView, setActiveView] = useState<ActiveView>("editor");

  // --- color legend ----------------------------------------------------
  // Session-only dismiss: each launch starts with the legend visible.
  // localStorage holds a one-time "I've seen it; don't auto-show on the
  // very first launch" flag in case we want it later, but for now we
  // just default to visible.
  const [legendVisible, setLegendVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cortex:legend-hidden") !== "true";
    } catch {
      return true;
    }
  });

  // --- experiment block modal (Cluster 4) ------------------------------
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  // --- insert-table modal (Cluster 8 v2.1.2) ---------------------------
  // Reachable via Ctrl+Shift+T or the editor's right-click "Insert table…".
  // Submit -> editor.chain().focus().insertTable({rows, cols, withHeaderRow}).run()
  const [tableModalOpen, setTableModalOpen] = useState(false);

  // --- focus-mode indicator (Cluster 8 v2.1.4) -------------------------
  // 'editor' when typing in a note; 'sidebar' when focus is anywhere else.
  // Drives a visual highlight on the sidebar so the user can see which
  // keymap is currently live (sidebar shortcuts vs editor text shortcuts).
  const [activeMode, setActiveMode] = useState<"editor" | "sidebar">("editor");

  // --- collapsible sidebar ---------------------------------------------
  // Persisted to localStorage so the user's pref survives a restart.
  // Available in every view, not just the PDF reader — the toggle
  // chevron stays visible at the top of the sidebar even when collapsed,
  // so there's always a way to bring it back without a keyboard shortcut.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cortex:sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("cortex:sidebar-collapsed", String(next));
      } catch {
        // ignore — same SecurityError caveat as elsewhere
      }
      return next;
    });
  }
  // We hold the TipTap editor instance so we can insert the block
  // scaffold at the cursor when the modal confirms.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorInstanceRef = useRef<any | null>(null);

  // --- theme -----------------------------------------------------------
  const { theme, setTheme } = useTheme();

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------
  useEffect(() => {
    invoke<string | null>("load_vault_config")
      .then((path) => {
        setVaultPath(path);
        setLoading(false);
      })
      .catch((err) => {
        console.error("load_vault_config failed:", err);
        setError(String(err));
        setLoading(false);
      });
  }, []);

  // Restore last-open file when vault resolves.
  useEffect(() => {
    if (!vaultPath) return;
    invoke<string | null>("load_last_open")
      .then((p) => {
        if (p) setSelectedPath(p);
      })
      .catch((e) => console.warn("load_last_open failed:", e));
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath) return;
    invoke("save_last_open", { filePath: selectedPath }).catch((e) =>
      console.warn("save_last_open failed:", e),
    );
  }, [selectedPath, vaultPath]);

  // Build the search index when vault loads. May take a few seconds for
  // large vaults; the user-visible app is fine in the meantime.
  useEffect(() => {
    if (!vaultPath) return;
    invoke<number>("rebuild_index", { vaultPath })
      .then((count) => {
        console.info(`Indexed ${count} notes`);
        setIndexVersion((v) => v + 1);
      })
      .catch((e) => console.warn("rebuild_index failed:", e));
  }, [vaultPath]);

  // -------------------------------------------------------------------------
  // Filesystem watcher
  //
  // On every external change we:
  //   1. Bump refreshKey so the FileTree re-fetches.
  //   2. Schedule a debounced rebuild_index. After it completes, bump
  //      indexVersion so backlinks / related-hierarchy / mark queues /
  //      persistent-file regeneration all re-fetch with fresh data.
  // The 1.5-second debounce keeps a `git pull` storm from thrashing the
  // index while still being fast enough to feel live.
  // -------------------------------------------------------------------------
  const reindexTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!vaultPath) return;
    invoke("start_vault_watcher", { vaultPath }).catch((e) =>
      console.warn("start_vault_watcher failed:", e),
    );
    const unlistenPromise = listen("vault-changed", () => {
      setRefreshKey((k) => k + 1);
      // Debounced reindex.
      if (reindexTimerRef.current !== null) {
        window.clearTimeout(reindexTimerRef.current);
      }
      reindexTimerRef.current = window.setTimeout(() => {
        invoke<number>("rebuild_index", { vaultPath })
          .then(() => setIndexVersion((v) => v + 1))
          .catch((e) => console.warn("rebuild_index after watcher failed:", e));
      }, 1500);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      if (reindexTimerRef.current !== null) {
        window.clearTimeout(reindexTimerRef.current);
      }
    };
  }, [vaultPath]);

  // -------------------------------------------------------------------------
  // Load the selected file
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedPath) {
      setFrontmatter({});
      setFileBody("");
      setEditedBody("");
      setDirty(false);
      return;
    }
    // Cluster 6: PDFs render via PDFReader, not the markdown pipeline. The
    // markdown editor state is reset so a stale body from a previously
    // open .md doesn't show under the PDF reader if the user toggles back.
    if (/\.pdf$/i.test(selectedPath)) {
      setFrontmatter({});
      setFileBody("");
      setEditedBody("");
      setDirty(false);
      setLoadingFile(false);
      return;
    }
    setLoadingFile(true);
    invoke<string>("read_markdown_file", { path: selectedPath })
      .then((raw) => {
        const { frontmatter, body } = parseFrontmatter(raw);
        setFrontmatter(frontmatter);
        setFileBody(body);
        setEditedBody(body);
        setDirty(false);
        setLoadingFile(false);
      })
      .catch((e) => {
        console.error("read_markdown_file failed:", e);
        setError(`Could not open file: ${e}`);
        setFileBody("");
        setEditedBody("");
        setLoadingFile(false);
      });
  }, [selectedPath]);

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------
  async function saveCurrentFile(): Promise<boolean> {
    if (!selectedPath || !dirty) return false;
    const raw = serializeFrontmatter(frontmatter, editedBody);
    try {
      await invoke("write_markdown_file", {
        path: selectedPath,
        content: raw,
      });
      setFileBody(editedBody);
      setDirty(false);

      // Refresh the search/link index for this file so the next backlink
      // lookup or palette query reflects the latest body.
      if (vaultPath) {
        invoke("index_single_file", {
          vaultPath,
          filePath: selectedPath,
        })
          .then(() => setIndexVersion((v) => v + 1))
          .catch((e) => console.warn("index_single_file failed:", e));

        // Cluster 4: route any `::experiment ... ::end` blocks to the
        // appropriate iteration files. Best-effort; warnings (e.g.,
        // experiment not found) surface in the console for now. Pass
        // today's date so the Rust side can stamp any iteration it
        // auto-creates.
        invoke<{ routed: number; warnings: string[] }>(
          "route_experiment_blocks",
          {
            vaultPath,
            dailyNotePath: selectedPath,
            dateIso: todayLocal(),
          },
        )
          .then((res) => {
            // Always log so we can diagnose silent zero-routing.
            console.info(
              `[cortex] experiment routing: routed=${res.routed}, warnings=${res.warnings.length}`,
            );
            if (res.warnings.length > 0) {
              console.warn("[cortex] experiment-block warnings:", res.warnings);
              setError(res.warnings[0]);
            }
          })
          .catch((e) =>
            console.warn("[cortex] route_experiment_blocks failed:", e),
          );
      }

      scheduleCommit();
      return true;
    } catch (e) {
      console.error("write_markdown_file failed:", e);
      setError(`Save failed: ${e}`);
      return false;
    }
  }

  function scheduleCommit() {
    if (!vaultPath || !selectedPath) return;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }
    const pathAtSchedule = selectedPath;
    const vaultAtSchedule = vaultPath;
    commitTimerRef.current = window.setTimeout(() => {
      invoke("git_auto_commit", {
        vaultPath: vaultAtSchedule,
        filePath: pathAtSchedule,
      }).catch((e) => console.warn("git_auto_commit failed:", e));
    }, COMMIT_MS);
  }

  // -------------------------------------------------------------------------
  // File switching — save current file first. Also intercepts persistent
  // destination files (Cluster 3) so their auto section gets regenerated
  // before we read.
  // -------------------------------------------------------------------------
  async function selectFile(path: string | null) {
    if (selectedPath && dirty && selectedPath !== path) {
      await saveCurrentFile();
    }

    // Cluster 6: PDFs route to the PDFReader view instead of the markdown
    // editor. We set selectedPath so the file tree highlights stay in sync,
    // but the editor's read_markdown_file pipeline is skipped.
    if (path && /\.pdf$/i.test(path)) {
      setSelectedPath(path);
      setActiveView("pdf-reader");
      return;
    }

    setActiveView("editor");

    if (path && vaultPath) {
      // Detect a persistent destination file at the vault root and
      // regenerate before opening.
      const sep = path.includes("\\") ? "\\" : "/";
      const basename = path.split(sep).pop() ?? "";
      const isAtVaultRoot =
        path.startsWith(vaultPath + sep) &&
        path.slice(vaultPath.length + 1) === basename;
      if (isAtVaultRoot && PERSISTENT_FILE_BASENAMES.has(basename)) {
        try {
          await invoke("regenerate_persistent_file", {
            vaultPath,
            filePath: path,
          });
        } catch (e) {
          console.warn("regenerate_persistent_file failed:", e);
        }
      }

      // Cluster 8: if opening a Method file, regenerate its
      // Reagents/Parts table from the protocols listed in its body.
      // Cheap and idempotent; no-op for files outside 05-Methods/.
      const methodsPrefix = `${vaultPath}${sep}05-Methods${sep}`;
      if (path.startsWith(methodsPrefix)) {
        try {
          await invoke("regenerate_method_reagents", {
            vaultPath,
            filePath: path,
          });
        } catch (e) {
          console.warn("regenerate_method_reagents failed:", e);
        }
      }

      // Cluster 6 / Pass 8: if opening a daily-log file, populate any
      // ::reading DATE ::end blocks from PDF annotation sidecars. The
      // command is idempotent — no-op for daily logs without blocks.
      const dailyLogPrefix = `${vaultPath}${sep}02-Daily Log${sep}`;
      if (path.startsWith(dailyLogPrefix)) {
        try {
          await invoke("populate_reading_log", {
            vaultPath,
            dailyNotePath: path,
          });
        } catch (e) {
          console.warn("populate_reading_log failed:", e);
        }
      }
    }

    setSelectedPath(path);
  }

  /**
   * Cluster 4: insert an `::experiment NAME / iter-N` … `::end` block
   * at the document level, just after whatever block (paragraph,
   * heading, blockquote, list item, …) currently contains the cursor.
   *
   * Why "after the top-level ancestor" instead of "at the cursor":
   *   ProseMirror's insertContent puts new nodes inside the cursor's
   *   parent. If the parent is a blockquote (e.g., the user has the
   *   cursor on a `> quoted line` they wrote earlier), the four
   *   paragraphs we insert end up nested inside that blockquote — and
   *   tiptap-markdown then serializes the entire thing as a blockquote,
   *   which the Rust parser then has to special-case.
   *
   *   By inserting at `$from.after(1)` (the doc-level position just
   *   after the depth-1 ancestor of the cursor), we guarantee the four
   *   new paragraphs are direct children of the doc — never inheriting
   *   any wrapper structure.
   *
   * Cursor lands inside the second empty paragraph between header and
   * closer, so the user can immediately start typing block content.
   */
  function insertExperimentBlock(experimentName: string, iterNumber: number) {
    const editor = editorInstanceRef.current;
    if (!editor) {
      console.warn("editor not ready for block insert");
      return;
    }

    const header = `::experiment ${experimentName} / iter-${iterNumber}`;
    const closer = "::end";

    // Compute a doc-level position to insert at. depth=0 means the
    // selection is in the doc root itself (rare); depth>=1 means we're
    // inside at least one ancestor block.
    const $from = editor.state.selection.$from;
    const insertAt = $from.depth === 0 ? $from.pos : $from.after(1);

    editor
      .chain()
      .focus()
      .insertContentAt(insertAt, [
        { type: "paragraph", content: [{ type: "text", text: header }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: closer }] },
      ])
      .run();

    // Position arithmetic for landing the cursor inside the second
    // empty paragraph (P3):
    //   insertAt          → outside P1, before open
    //   +1                → inside P1, before text
    //   +header.length    → inside P1, after text
    //   +1                → outside P1
    //   +1                → inside P2 (empty)
    //   +1                → outside P2
    //   +1                → inside P3  ← target
    const cursorTarget = insertAt + header.length + 5;
    editor.chain().setTextSelection(cursorTarget).run();
  }

  /** Handler for the ReviewsMenu — routes destinations to either a
   *  virtual queue view or a regenerated persistent file. */
  async function pickDestination(choice: DestinationChoice) {
    if (!vaultPath) return;
    if (choice.kind === "queue") {
      setActiveView(
        choice.queueKind === "yellow" ? "queue-yellow" : "queue-green",
      );
      return;
    }
    // Persistent: ensure exists + regenerate, then open as a file.
    try {
      const path = await invoke<string>("ensure_persistent_file", {
        vaultPath,
        kind: choice.persistentKind,
      });
      await selectFile(path);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("ensure_persistent_file failed:", e);
      setError(`Could not open destination: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // Daily log (Ctrl+D)
  //
  // Cluster 3: before creating today's daily note (if it doesn't exist
  // yet), pull all unresolved + un-injected pink marks. Format them as
  // a "Carried over from earlier" section. After successful creation,
  // stamp those marks as injected so they don't recur tomorrow.
  // -------------------------------------------------------------------------
  async function openTodayDailyLog() {
    if (!vaultPath) return;
    const today = todayLocal();
    try {
      // Probe for pink marks that should carry over. Empty string means
      // the file already exists (we'll skip injection) or there's
      // nothing to carry — both fine.
      let carryOverMd: string | null = null;
      let pinkIds: number[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pinks: any[] = await invoke("query_marks", {
          vaultPath,
          kind: "pink",
          maxAgeDays: 30,
          includeResolved: false,
          onlyUninjected: true,
        });
        if (Array.isArray(pinks) && pinks.length > 0) {
          carryOverMd = pinks
            .map(
              (m) =>
                `- **[[${m.source_title}]]** (line ${m.line_number}): ${stripMarkTags(m.context).trim()}`,
            )
            .join("\n");
          pinkIds = pinks.map((m) => m.id);
        }
      } catch (e) {
        console.warn("query_marks (pink) failed:", e);
      }

      const path = await invoke<string>("ensure_daily_log", {
        vaultPath,
        dateIso: today,
        carryOverMd,
      });
      await selectFile(path);
      setRefreshKey((k) => k + 1);

      // Stamp the marks as injected. We do this regardless of whether
      // the file was actually new — if the file already existed,
      // ensure_daily_log silently ignored carry_over, so the user just
      // sees the existing daily note. The marks would still be valid
      // candidates tomorrow, but the doc says "consumed once injected
      // anywhere"; we honor that by stamping them only when the file
      // didn't exist. Practically: the daily-log creation is gated by
      // file-existence on the Rust side, but we don't know that here.
      // For simplicity, only stamp if there were any to begin with —
      // and accept that re-running today won't double-inject anyway
      // (because pinkIds will be empty next time since they're stamped).
      if (pinkIds.length > 0) {
        invoke("mark_marks_injected", {
          vaultPath,
          markIds: pinkIds,
        }).catch((e) => console.warn("mark_marks_injected failed:", e));
      }
    } catch (e) {
      console.error("ensure_daily_log failed:", e);
      setError(`Could not open daily log: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // Wikilinks
  // -------------------------------------------------------------------------
  //
  // Resolution order (most specific first):
  //   1. Exact filename match — `[[2026-04-25]]` finds `2026-04-25.md`
  //      anywhere in the vault. This is what makes daily-log links work
  //      (their H1 is "2026-04-25 — Friday", not just the date).
  //   2. Case-insensitive H1 title match.
  // If neither hits, we *ask* (Tauri's native confirm — window.confirm
  // can be unreliable in WebView2) and on yes, create the note in the
  // VAULT ROOT (not the current dir, which makes a mess if you're
  // editing inside 02-Daily Log).
  // Critically, if a file already exists at the target path, we just
  // open it instead of writing — never overwrite with a fresh template.
  async function openWikilink(target: string) {
    if (!vaultPath) return;
    try {
      const all = await invoke<NoteListItem[]>("list_all_notes", {
        vaultPath,
      });

      // 1. Filename match (basename without `.md`).
      const sep = vaultPath.includes("\\") ? "\\" : "/";
      const targetLower = target.toLowerCase();
      const fileMatch = all.find((n) => {
        const base = n.path.split(sep).pop() ?? n.path;
        const stem = base.endsWith(".md") ? base.slice(0, -3) : base;
        return stem.toLowerCase() === targetLower;
      });
      if (fileMatch) {
        await selectFile(fileMatch.path);
        return;
      }

      // 2. H1 title match.
      const titleMatch = all.find((n) => n.title.toLowerCase() === targetLower);
      if (titleMatch) {
        await selectFile(titleMatch.path);
        return;
      }

      // Not found — ask via the Tauri dialog plugin.
      const ok = await confirm(
        `No note titled "${target}" exists. Create one in the vault root?`,
        { title: "Create note?", kind: "info" },
      );
      if (!ok) return;

      // Build target path. Sanitise filename (Windows-illegal chars).
      const safeName = target
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      if (safeName.length === 0) {
        setError(`"${target}" is not a valid filename.`);
        return;
      }
      const newPath = `${vaultPath}${sep}${safeName}.md`;

      // Safety net: if a file is somehow already at that path (maybe
      // it has a different H1 than its filename), just open it.
      const existsAlready = await invoke<string | null>("read_markdown_file", {
        path: newPath,
      }).then(
        () => true,
        () => false,
      );
      if (existsAlready) {
        await selectFile(newPath);
        return;
      }

      const today = todayLocal();
      const idSlug = target
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      // Quote the date so YAML doesn't auto-parse it as a Date object
      // (which would render as "...T00:00:00.000Z" in the panel).
      const template = `---\nid: note-${today}-${idSlug}\ntype: note\ndate: "${today}"\n---\n\n# ${target}\n\n`;

      await invoke("write_markdown_file", {
        path: newPath,
        content: template,
      });
      await invoke("index_single_file", {
        vaultPath,
        filePath: newPath,
      });
      setIndexVersion((v) => v + 1);
      await selectFile(newPath);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("openWikilink failed:", e);
      setError(`Could not follow link: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // Identifiers for the currently-open note (used for backlinks lookup).
  //   - currentTitle:    H1 of the body (e.g., "Cortex — Project Notes")
  //   - currentFilename: basename without `.md` (e.g., "NOTES")
  // We pass both because wikilinks can point at either form.
  // -------------------------------------------------------------------------
  function basename(path: string): string {
    const sep = path.includes("\\") ? "\\" : "/";
    const name = path.split(sep).pop() ?? path;
    return name.endsWith(".md") ? name.slice(0, -3) : name;
  }
  function deriveCurrentTitle(): string {
    if (!selectedPath) return "";
    for (const line of fileBody.split("\n")) {
      const t = line.trim();
      if (t.startsWith("# ")) return t.slice(2).trim();
    }
    return basename(selectedPath);
  }
  const currentTitle = deriveCurrentTitle();
  const currentFilename = selectedPath ? basename(selectedPath) : "";

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrentFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        openTodayDailyLog();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        // Cluster 6 v1.3: in PDF reader, Ctrl+K opens the in-pane PDF
        // search bubble (handled inside PDFReader). Don't intercept here.
        if (activeView === "pdf-reader") return;
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setHelpOpen((open) => !open);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === "l" || e.key === "L")
      ) {
        e.preventDefault();
        setLegendVisible((v) => {
          const next = !v;
          try {
            localStorage.setItem(
              "cortex:legend-hidden",
              next ? "false" : "true",
            );
          } catch {
            // ignore — see Week 1 notes on localStorage SecurityError
          }
          return next;
        });
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === "n" || e.key === "N") &&
        !isEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("note");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "P" || e.key === "p") &&
        !isEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("project");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "E" || e.key === "e") &&
        !isEditorFocused()
      ) {
        // Cluster 8 v2.1.3: Ctrl+Shift+E is "new experiment" only when
        // the editor isn't focused. When the editor IS focused, TipTap's
        // TextAlign keymap takes the same chord and aligns the current
        // paragraph centred. Same gating for the rest of the hierarchy
        // shortcuts (note/project/iteration) so the editor's typing
        // experience never silently triggers a hierarchy modal.
        e.preventDefault();
        setHierarchyKind("experiment");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "I" || e.key === "i") &&
        !isEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("iteration");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "B" || e.key === "b")
      ) {
        e.preventDefault();
        setBlockModalOpen(true);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "T" || e.key === "t")
      ) {
        e.preventDefault();
        setTableModalOpen(true);
      } else if (e.key === "Escape") {
        // Centralised escape — modals also handle their own, but this
        // covers the case where focus is somewhere outside them.
        setPaletteOpen(false);
        setHelpOpen(false);
        setHierarchyKind(null);
        setTableModalOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, dirty, editedBody, frontmatter, vaultPath, activeView]);

  // Autosave 5 minutes after last edit.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      saveCurrentFile();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, editedBody]);

  // Save dirty work before the window closes. Critical because autosave
  // is on a 5-minute timer — without this, hitting the X button could
  // throw away the last few minutes of typing.
  //
  // Two things matter here:
  //   1. preventDefault() must be called SYNCHRONOUSLY in the handler.
  //      Tauri checks the prevented flag the moment the listener returns;
  //      an `async` handler returns a Promise immediately and Tauri's
  //      behaviour becomes undefined (in some Tauri 2 builds the window
  //      gets stuck non-closeable).
  //   2. We register the listener exactly ONCE. If we put state in the
  //      effect's deps, every keystroke re-registers and we accumulate
  //      stale handlers. We use refs to access the latest state instead.
  const closingRef = useRef(false);
  const closeStateRef = useRef({
    dirty,
    editedBody,
    frontmatter,
    selectedPath,
  });
  // Keep the ref current.
  closeStateRef.current = {
    dirty,
    editedBody,
    frontmatter,
    selectedPath,
  };

  useEffect(() => {
    const win = getCurrentWindow();
    console.info("[cortex] registering close handler");
    const unlistenPromise = win.onCloseRequested((event) => {
      const s = closeStateRef.current;
      console.info(
        "[cortex] close requested. closing=" +
          closingRef.current +
          ", dirty=" +
          s.dirty +
          ", selectedPath=" +
          s.selectedPath,
      );

      // Second pass: we just called win.destroy() ourselves after saving.
      // Let it through.
      if (closingRef.current) {
        console.info("[cortex] second pass — letting close proceed");
        return;
      }

      if (!s.dirty || !s.selectedPath) {
        console.info("[cortex] no dirty work — close proceeds");
        return;
      }

      // SYNCHRONOUS preventDefault, then kick off the save in an IIFE
      // so the listener returns immediately. preventDefault MUST happen
      // before the listener returns; Tauri checks the prevented flag at
      // that moment.
      console.info("[cortex] dirty — preventDefault, saving, then closing");
      event.preventDefault();
      (async () => {
        try {
          const raw = serializeFrontmatter(s.frontmatter, s.editedBody);
          await invoke("write_markdown_file", {
            path: s.selectedPath,
            content: raw,
          });
          console.info("[cortex] save done");
        } catch (e) {
          console.warn("[cortex] save before close failed:", e);
          // Best-effort — close anyway. Better to risk a few seconds of
          // text than a permanently undismissable window.
        }
        closingRef.current = true;
        // destroy() forcibly closes without re-firing onCloseRequested.
        // (close() would re-fire it; the closingRef would short-circuit,
        //  but destroy is the cleaner force-close path.)
        try {
          await win.destroy();
        } catch (e) {
          console.warn("[cortex] destroy failed, falling back to close():", e);
          await win.close();
        }
      })();
    });
    return () => {
      console.info("[cortex] unregistering close handler");
      unlistenPromise
        .then((unlisten) => unlisten())
        .catch((e) => console.warn("[cortex] unlisten failed:", e));
    };
  }, []);

  // Save dirty work when the user steps away — alt-tab, minimize, lock screen,
  // close the laptop lid, system sleep. The 5-minute autosave is too long a
  // window to risk; these reactive triggers cover the gap.
  useEffect(() => {
    let unlistenFocus: (() => void) | null = null;

    const trySave = () => {
      const s = closeStateRef.current;
      if (!s.dirty || !s.selectedPath) return;
      const raw = serializeFrontmatter(s.frontmatter, s.editedBody);
      // Fire-and-forget. We don't care about the result here — if it fails,
      // a subsequent Ctrl+S or save-on-close will retry.
      invoke("write_markdown_file", {
        path: s.selectedPath,
        content: raw,
      })
        .then(() => {
          // We can't easily flip the React `dirty` flag from outside the
          // component lifecycle without scheduling a render, so we leave
          // it. The next render or Ctrl+S will re-sync.
        })
        .catch((e) => console.warn("[cortex] focus-save failed:", e));
    };

    const onVisibility = () => {
      if (document.hidden) trySave();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Tauri window focus event — fires on alt-tab, lid close, etc.
    const win = getCurrentWindow();
    win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) trySave();
      })
      .then((unlisten) => {
        unlistenFocus = unlisten;
      })
      .catch((e) => console.warn("[cortex] onFocusChanged setup failed:", e));

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (unlistenFocus) unlistenFocus();
    };
  }, []);

  // Cluster 8 v2.1.4: keep `activeMode` in sync with focus.
  //
  // First attempt used `document.activeElement` inside a mousedown
  // listener, which raced: mousedown fires BEFORE focus moves, so the
  // active element was still the editor at the moment the listener ran,
  // and clicks on non-focusable sidebar elements (file-tree rows, divs)
  // never triggered a follow-up focusin to correct it. About half the
  // sidebar clicks therefore stayed in "editor" mode visually.
  //
  // Fix: read the EVENT TARGET, not activeElement. The target is the
  // element the user actually clicked / focused, no matter how the
  // browser has scheduled the focus transition. `target.closest(...)`
  // tells us whether the click landed inside the editor.
  useEffect(() => {
    const updateFromEvent = (e: Event) => {
      const t = e.target as Element | null;
      const isEditor =
        !!t && typeof t.closest === "function" && !!t.closest(".ProseMirror");
      setActiveMode(isEditor ? "editor" : "sidebar");
    };
    document.addEventListener("focusin", updateFromEvent);
    document.addEventListener("mousedown", updateFromEvent);
    // Initial paint: we have no event yet, so fall back to activeElement.
    // The race only matters once user input is in flight.
    setActiveMode(isEditorFocused() ? "editor" : "sidebar");
    return () => {
      document.removeEventListener("focusin", updateFromEvent);
      document.removeEventListener("mousedown", updateFromEvent);
    };
  }, []);

  // Toggle a body class while Ctrl/Meta is held — used by index.css to
  // give wikilinks a pointer cursor and stronger underline on hover.
  useEffect(() => {
    const cls = "cortex-mod-pressed";
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        document.body.classList.add(cls);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") {
        document.body.classList.remove(cls);
      }
    };
    // Window blur drops modifier state in the OS but we don't get a
    // keyup — clear defensively.
    const onBlur = () => document.body.classList.remove(cls);

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.body.classList.remove(cls);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Vault picker
  // -------------------------------------------------------------------------
  async function pickVault() {
    setError(null);
    if (dirty) await saveCurrentFile();
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose your Cortex vault folder",
      });
      if (typeof selected === "string") {
        await invoke("save_vault_config", { vaultPath: selected });
        setVaultPath(selected);
        setSelectedPath(null);
      }
    } catch (err) {
      console.error("pickVault failed:", err);
      setError(String(err));
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <main style={baseStyles.shell}>
        <div style={baseStyles.muted}>Loading…</div>
      </main>
    );
  }

  if (!vaultPath) {
    return (
      <main style={baseStyles.shell}>
        <div style={baseStyles.welcomeCard}>
          <h1 style={baseStyles.h1}>Welcome to Cortex</h1>
          <p style={baseStyles.lead}>
            Cortex is your research notebook. Pick a folder on disk to be your{" "}
            <em>vault</em> — every note, experiment, and concept will live there
            as a markdown file you fully own.
          </p>
          <p style={baseStyles.hint}>
            Tip: avoid OneDrive or other syncing folders. A plain local folder
            (e.g., <code>C:\Cortex</code>) is best.
          </p>
          <button onClick={pickVault} style={baseStyles.primaryBtn}>
            Choose vault folder
          </button>
          {error && (
            <p style={baseStyles.errorText}>Could not open picker: {error}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <div style={baseStyles.appShell}>
      <aside
        style={{
          ...baseStyles.sidebar,
          // Width swap on collapse. We narrow to a thin strip (~32px)
          // rather than a full-zero width so the toggle chevron stays
          // visible — there's always a way back without a shortcut.
          width: sidebarCollapsed ? "32px" : "300px",
          minWidth: sidebarCollapsed ? "32px" : "260px",
          // Sidebar-mode banner: accent border when sidebar shortcuts are
          // the active keymap. Suppressed while the PDF reader holds the
          // main pane — the PDF reader has its own Ctrl+K (in-pane
          // search) and showing the "sidebar mode" banner alongside that
          // is misleading. Also suppressed while collapsed (no point
          // signalling sidebar mode when the sidebar isn't really there).
          borderRight:
            activeMode === "sidebar" &&
            activeView !== "pdf-reader" &&
            !sidebarCollapsed
              ? "2px solid var(--accent)"
              : "1px solid var(--border)",
          boxShadow:
            activeMode === "sidebar" &&
            activeView !== "pdf-reader" &&
            !sidebarCollapsed
              ? "inset -1px 0 0 var(--accent)"
              : "none",
        }}
      >
        {sidebarCollapsed ? (
          <div style={baseStyles.sidebarCollapsedStrip}>
            <button
              onClick={toggleSidebar}
              style={baseStyles.sidebarToggleBtn}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              ▶
            </button>
          </div>
        ) : (
          <>
            <header style={baseStyles.sidebarHeader}>
              <div style={baseStyles.sidebarTitleRow}>
                <button
                  onClick={toggleSidebar}
                  style={baseStyles.sidebarToggleBtn}
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  ◀
                </button>
                <strong style={baseStyles.sidebarTitle}>Cortex</strong>
                <div style={baseStyles.sidebarActions}>
                  <button
                    onClick={openTodayDailyLog}
                    style={baseStyles.changeBtn}
                    title="Open today's daily log (Ctrl+D)"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setPaletteOpen(true)}
                    style={baseStyles.changeBtn}
                    title="Search notes (Ctrl+K)"
                  >
                    Search
                  </button>
                  <button
                    onClick={() => setHierarchyKind("note")}
                    style={baseStyles.changeBtn}
                    title="New note (Ctrl+N)"
                  >
                    + Note
                  </button>
                  <button
                    onClick={() => setHierarchyKind("idea")}
                    style={baseStyles.changeBtn}
                    title="New idea (saved in 04-Ideas/)"
                  >
                    + Idea
                  </button>
                  <button
                    onClick={() => setActiveView("idea-log")}
                    style={baseStyles.changeBtn}
                    title="Open Idea Log"
                  >
                    Ideas
                  </button>
                  <button
                    onClick={() => setHierarchyKind("method")}
                    style={baseStyles.changeBtn}
                    title="New method (saved in 05-Methods/)"
                  >
                    + Method
                  </button>
                  <button
                    onClick={() => setActiveView("methods-arsenal")}
                    style={baseStyles.changeBtn}
                    title="Open Methods Arsenal"
                  >
                    Methods
                  </button>
                  <button
                    onClick={() => setHierarchyKind("protocol")}
                    style={baseStyles.changeBtn}
                    title="New protocol (saved in 06-Protocols/)"
                  >
                    + Protocol
                  </button>
                  <button
                    onClick={() => setActiveView("protocols-log")}
                    style={baseStyles.changeBtn}
                    title="Open Protocols Log"
                  >
                    Protocols
                  </button>
                  <button
                    onClick={() => setHierarchyKind("project")}
                    style={baseStyles.changeBtn}
                    title="New project (Ctrl+Shift+P)"
                  >
                    + Proj
                  </button>
                  <button
                    onClick={() => setHierarchyKind("experiment")}
                    style={baseStyles.changeBtn}
                    title="New experiment (Ctrl+Shift+E)"
                  >
                    + Exp
                  </button>
                  <button
                    onClick={() => setHierarchyKind("iteration")}
                    style={baseStyles.changeBtn}
                    title="New iteration (Ctrl+Shift+I)"
                  >
                    + Iter
                  </button>
                  <button
                    onClick={() => setBlockModalOpen(true)}
                    style={baseStyles.changeBtn}
                    title="Insert experiment block (Ctrl+Shift+B)"
                  >
                    + Block
                  </button>
                  <ReviewsMenu onPick={pickDestination} />
                  <button
                    onClick={() => setRefreshKey((k) => k + 1)}
                    style={baseStyles.iconBtn}
                    title="Refresh file tree"
                    aria-label="Refresh file tree"
                  >
                    ↻
                  </button>
                  <button
                    onClick={pickVault}
                    style={baseStyles.changeBtn}
                    title="Choose a different vault"
                  >
                    Change…
                  </button>
                </div>
              </div>
              <div style={baseStyles.sidebarPath} title={vaultPath}>
                {vaultPath}
              </div>
            </header>
            <div style={baseStyles.sidebarBody}>
              <FileTree
                vaultPath={vaultPath}
                onSelectFile={selectFile}
                selectedPath={selectedPath}
                refreshKey={refreshKey}
              />
            </div>
            <footer style={baseStyles.sidebarFooter}>
              <button
                onClick={() => setHelpOpen(true)}
                style={baseStyles.iconBtn}
                title="Keyboard shortcuts (Ctrl+/)"
                aria-label="Keyboard shortcuts"
              >
                ?
              </button>
              <div style={{ flex: 1 }} />
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </footer>
          </>
        )}
      </aside>

      <main style={baseStyles.mainPane}>
        {activeView === "queue-yellow" ? (
          <MarkQueueView
            vaultPath={vaultPath}
            kind="yellow"
            ageDays={7}
            title="Weekly review"
            blurb="Yellow-marked content from the last 7 days, grouped by source note. Strike through (Ctrl+Shift+X) items inside the source to mark them resolved."
            refreshKey={indexVersion}
            onOpenFile={selectFile}
            onClose={() => setActiveView("editor")}
          />
        ) : activeView === "queue-green" ? (
          <MarkQueueView
            vaultPath={vaultPath}
            kind="green"
            ageDays={30}
            title="Monthly review"
            blurb="Green-marked content from the last 30 days, grouped by source note."
            refreshKey={indexVersion}
            onOpenFile={selectFile}
            onClose={() => setActiveView("editor")}
          />
        ) : activeView === "idea-log" ? (
          <IdeaLog
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={selectFile}
            onClose={() => setActiveView("editor")}
            onNewIdea={() => setHierarchyKind("idea")}
          />
        ) : activeView === "methods-arsenal" ? (
          <MethodsArsenal
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={selectFile}
            onClose={() => setActiveView("editor")}
            onNewMethod={() => setHierarchyKind("method")}
          />
        ) : activeView === "protocols-log" ? (
          <ProtocolsLog
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={selectFile}
            onClose={() => setActiveView("editor")}
            onNewProtocol={() => setHierarchyKind("protocol")}
          />
        ) : activeView === "pdf-reader" && selectedPath ? (
          <PDFReader
            vaultPath={vaultPath}
            filePath={selectedPath}
            onClose={() => setActiveView("editor")}
          />
        ) : !selectedPath ? (
          <div style={baseStyles.muted}>
            Click a file in the sidebar, press Ctrl+D for today's log, or Ctrl+K
            to search.
          </div>
        ) : loadingFile ? (
          <div style={baseStyles.muted}>Loading file…</div>
        ) : (
          <div style={baseStyles.editorWrap}>
            <div style={baseStyles.fileHeader}>
              <code style={baseStyles.filePath}>{selectedPath}</code>
              <span style={baseStyles.saveStatus}>
                {dirty ? (
                  <span style={baseStyles.unsaved}>● unsaved</span>
                ) : (
                  <span style={baseStyles.saved}>saved</span>
                )}
              </span>
            </div>
            <FrontmatterPanel frontmatter={frontmatter} />
            <Editor
              content={fileBody}
              onChange={(md) => {
                setEditedBody(md);
                setDirty(md !== fileBody);
              }}
              onFollowWikilink={openWikilink}
              onEditorReady={(e) => {
                editorInstanceRef.current = e;
              }}
              onRequestInsertTable={() => setTableModalOpen(true)}
            />
            <RelatedHierarchyPanel
              vaultPath={vaultPath}
              currentPath={selectedPath}
              refreshKey={indexVersion}
              onOpenFile={selectFile}
            />
            <BacklinksPanel
              vaultPath={vaultPath}
              currentTitle={currentTitle}
              currentFilename={currentFilename}
              refreshKey={indexVersion}
              onOpenFile={selectFile}
            />
          </div>
        )}
        {error && (
          <p style={baseStyles.errorText}>
            {error}
            <button
              onClick={() => setError(null)}
              style={{ ...baseStyles.changeBtn, marginLeft: "0.75rem" }}
            >
              dismiss
            </button>
          </p>
        )}
      </main>

      <CommandPalette
        vaultPath={vaultPath}
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenFile={(p) => {
          selectFile(p);
          setPaletteOpen(false);
        }}
      />
      <ShortcutsHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <ColorLegend
        visible={legendVisible}
        onDismiss={() => {
          setLegendVisible(false);
          try {
            localStorage.setItem("cortex:legend-hidden", "true");
          } catch {
            // ignore
          }
        }}
        onPickDestination={pickDestination}
      />
      <NewHierarchyModal
        vaultPath={vaultPath}
        kind={hierarchyKind}
        onClose={() => setHierarchyKind(null)}
        onCreated={(path) => {
          setHierarchyKind(null);
          // Navigate to the new file and refresh the tree so it appears.
          selectFile(path);
          setRefreshKey((k) => k + 1);
        }}
      />
      <ExperimentBlockModal
        vaultPath={vaultPath}
        isOpen={blockModalOpen}
        onClose={() => setBlockModalOpen(false)}
        onConfirm={(name, iter) => {
          setBlockModalOpen(false);
          insertExperimentBlock(name, iter);
        }}
      />
      <InsertTableModal
        isOpen={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        onConfirm={(rows, cols, withHeaderRow) => {
          setTableModalOpen(false);
          const ed = editorInstanceRef.current;
          if (!ed) {
            console.warn("editor not ready for table insert");
            return;
          }
          ed.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
        }}
      />
    </div>
  );
}

const baseStyles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  welcomeCard: {
    maxWidth: "560px",
    width: "100%",
    padding: "2rem 2.25rem",
    borderRadius: "10px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow)",
  },
  appShell: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
  },
  sidebar: {
    // Width / minWidth are overridden inline based on collapse state.
    // Keeping them here as fallback defaults for the expanded case.
    width: "300px",
    minWidth: "260px",
    borderRight: "1px solid var(--border)",
    background: "var(--bg-deep)",
    display: "flex",
    flexDirection: "column",
    transition: "width 120ms ease, min-width 120ms ease",
  },
  sidebarCollapsedStrip: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: "0.5rem",
    height: "100%",
  },
  sidebarToggleBtn: {
    width: "22px",
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    padding: 0,
  },
  sidebarHeader: {
    padding: "0.75rem 0.85rem",
    borderBottom: "1px solid var(--border)",
  },
  sidebarTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.4rem",
    gap: "0.5rem",
  },
  sidebarTitle: { fontSize: "0.95rem" },
  sidebarActions: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexWrap: "wrap",
  },
  sidebarFooter: {
    padding: "0.5rem 0.85rem",
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  changeBtn: {
    fontSize: "0.7rem",
    padding: "2px 8px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  iconBtn: {
    width: "22px",
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.85rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    padding: 0,
  },
  sidebarPath: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    wordBreak: "break-all",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  sidebarBody: { flex: 1, overflowY: "auto", overflowX: "hidden" },
  mainPane: { flex: 1, padding: "2rem", overflow: "auto" },
  h1: { margin: "0 0 0.75rem", fontSize: "1.6rem", fontWeight: 600 },
  lead: {
    margin: "0 0 0.5rem",
    fontSize: "0.95rem",
    lineHeight: 1.5,
    color: "var(--text)",
  },
  hint: {
    marginTop: "1rem",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  editorWrap: {
    maxWidth: "780px",
    margin: "0 auto",
  },
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem",
    paddingBottom: "0.5rem",
    borderBottom: "1px solid var(--border)",
  },
  filePath: {
    flex: 1,
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    wordBreak: "break-all",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  saveStatus: { fontSize: "0.75rem" },
  unsaved: { color: "var(--warning)" },
  saved: { color: "var(--text-muted)" },
  primaryBtn: {
    marginTop: "1rem",
    padding: "0.7rem 1.4rem",
    fontSize: "0.95rem",
    cursor: "pointer",
    background: "var(--primary)",
    color: "white",
    border: "none",
    borderRadius: "6px",
  },
  errorText: {
    marginTop: "1rem",
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  muted: { color: "var(--text-muted)", fontSize: "0.9rem" },
};

export default App;
