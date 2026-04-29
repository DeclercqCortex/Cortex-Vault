// TabPane — a single pane in the multi-tab layout.
//
// Owns all per-file state and effects: selectedPath, activeView,
// frontmatter, fileBody/editedBody, dirty, loadingFile, plus the
// TipTap editor instance ref. App.tsx keeps cross-cutting concerns:
// vaultPath, indexVersion, refresh key, modals.
//
// One useEffect chain is bound to this pane's state, so multiple
// panes coexist without sharing or racing each other's loads/saves.
//
// App routes file clicks into a specific slot via the imperative
// `openPath` method exposed on the pane's ref. Per-pane shortcuts
// (Ctrl+S, Ctrl+R) are dispatched by App against the currently-active
// slot's ref. Save-on-close fans out across all panes.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "./Editor";
import { FrontmatterPanel } from "./FrontmatterPanel";
import { BacklinksPanel } from "./BacklinksPanel";
import { RelatedHierarchyPanel } from "./RelatedHierarchyPanel";
import { MarkQueueView } from "./MarkQueueView";
import { IdeaLog } from "./IdeaLog";
import { MethodsArsenal } from "./MethodsArsenal";
import { ProtocolsLog } from "./ProtocolsLog";
import { Calendar } from "./Calendar";
import { PDFReader } from "./PDFReader";
import { parseFrontmatter, serializeFrontmatter } from "../utils/frontmatter";

// 5 minutes after last keystroke → autosave (per pane).
const AUTOSAVE_MS = 5 * 60 * 1000;
// 30 seconds after last save → git commit (per pane).
const COMMIT_MS = 30_000;

export type ActiveView =
  | "editor"
  | "queue-yellow"
  | "queue-green"
  | "idea-log"
  | "methods-arsenal"
  | "protocols-log"
  | "pdf-reader"
  | "calendar";

/** Imperative API the parent uses to drive this pane. */
export type TabPaneHandle = {
  /** Save the open file if dirty. Returns true on success or no-op. */
  saveIfDirty(): Promise<boolean>;
  /** Re-read the open file from disk (Ctrl+R in this pane). */
  reload(): Promise<void>;
  /** Insert an experiment-block scaffold at the cursor. */
  insertExperimentBlock(name: string, iter: number): void;
  /** Insert a table at the cursor. */
  insertTable(rows: number, cols: number, withHeaderRow: boolean): void;
  /**
   * Cluster 10 — insert a GitHub summary block at the cursor (slash-
   * command equivalent for `Ctrl+Shift+G`). Inserted as plain text
   * paragraphs containing markdown syntax; renders fully on the next
   * save+reload, the same way `::experiment` blocks behave.
   */
  insertGitHubMarkdown(markdown: string): void;
  /** Load a file into this pane (handles PDF vs markdown routing). */
  openPath(path: string | null): Promise<void>;
  /** Switch to a structured view (idea-log, methods-arsenal, etc.). */
  setActiveView(view: ActiveView): void;
  /** Read the current open path (for tree highlight + per-slot save). */
  getPath(): string | null;
  /** Read the current active view. */
  getActiveView(): ActiveView;
  /** Read the dirty flag (for save-before-close, save-on-blur). */
  getDirty(): boolean;
  /** Read the latest editedBody+frontmatter for save-before-close. */
  getDirtySnapshot(): {
    selectedPath: string | null;
    frontmatter: Record<string, unknown>;
    editedBody: string;
  };
  /** True if focus is inside this pane's TipTap editor. */
  isEditorFocused(): boolean;
};

export type TabPaneProps = {
  slotIndex: number;
  vaultPath: string;
  indexVersion: number;
  /**
   * Semantic "this slot is the active one" flag. True for the only
   * pane in a single-slot layout AND for the active pane in
   * multi-slot. Used by PDFReader to decide whether to respond to
   * window-level Ctrl+K. **Not** used directly for visual chrome —
   * see `multiSlot` for that.
   */
  isActive: boolean;
  /**
   * True when more than one slot is visible. Drives the active-slot
   * outline and the slot-number badge — both should hide when there's
   * only one pane to disambiguate. v1.6 of Cluster 6 used `isActive`
   * for this dual purpose, which broke single-slot Ctrl+K because the
   * gate became unreachable.
   */
  multiSlot: boolean;
  /** Bump indexVersion in App so backlinks et al. re-fetch. */
  bumpIndex: () => void;
  /** Surface a recoverable error to App's banner. */
  setError: (msg: string) => void;
  /** User clicked / focused into this pane → make it active. */
  onActivate: () => void;
  /** Per-pane state changes notified up so App can reflect highlight, etc. */
  onPathChange: (path: string | null) => void;
  onActiveViewChange: (view: ActiveView) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Wikilink follow — App resolves & routes (may switch panes). */
  onFollowWikilink: (target: string) => void;
  /** Editor right-click "Insert table…" — App opens the modal. */
  onRequestInsertTable: () => void;
  /** Open a file in this pane (used by backlinks / related panel). */
  onOpenFileInPane: (path: string, slotIndex: number) => Promise<void>;
};

function isInsideEl(el: Element | null, root: HTMLElement | null): boolean {
  if (!root) return false;
  let cur: Element | null = el;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parentElement;
  }
  return false;
}

export const TabPane = forwardRef<TabPaneHandle, TabPaneProps>(
  function TabPane(props, ref) {
    const {
      slotIndex,
      vaultPath,
      indexVersion,
      isActive,
      multiSlot,
      bumpIndex,
      setError,
      onActivate,
      onPathChange,
      onActiveViewChange,
      onDirtyChange,
      onFollowWikilink,
      onRequestInsertTable,
      onOpenFileInPane,
    } = props;

    // --- per-pane state --------------------------------------------------
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [activeView, setActiveViewLocal] = useState<ActiveView>("editor");
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
    const [fileBody, setFileBody] = useState<string>("");
    const [editedBody, setEditedBody] = useState<string>("");
    const [dirty, setDirty] = useState(false);
    const [loadingFile, setLoadingFile] = useState(false);

    // --- timers ----------------------------------------------------------
    const commitTimerRef = useRef<number | null>(null);

    // --- editor instance ref --------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorInstanceRef = useRef<any | null>(null);

    // --- pane container ref (for "is editor focused inside this pane?") --
    const paneRootRef = useRef<HTMLDivElement | null>(null);

    // Notify App on state changes.
    useEffect(() => {
      onPathChange(selectedPath);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPath]);
    useEffect(() => {
      onActiveViewChange(activeView);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView]);
    useEffect(() => {
      onDirtyChange(dirty);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dirty]);

    // --- file load -------------------------------------------------------
    // Re-fires whenever selectedPath changes (or reload() bumps the tick).
    // Resets all editor state for the previous file before reading the
    // new one. PDFs short-circuit (handled by PDFReader), but the editor
    // state is still cleared so a stale .md body doesn't leak through if
    // the user toggles back.
    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
      if (!selectedPath) {
        setFrontmatter({});
        setFileBody("");
        setEditedBody("");
        setDirty(false);
        return;
      }
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
          console.error(`[pane ${slotIndex}] read_markdown_file failed:`, e);
          setError(`Could not open file: ${e}`);
          setFileBody("");
          setEditedBody("");
          setLoadingFile(false);
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPath, reloadTick]);

    // --- save ------------------------------------------------------------
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

        if (vaultPath) {
          invoke("index_single_file", {
            vaultPath,
            filePath: selectedPath,
          })
            .then(() => bumpIndex())
            .catch((e) =>
              console.warn(`[pane ${slotIndex}] index_single_file failed:`, e),
            );

          invoke<{ routed: number; warnings: string[] }>(
            "route_experiment_blocks",
            {
              vaultPath,
              dailyNotePath: selectedPath,
              dateIso: todayLocal(),
            },
          )
            .then((res) => {
              console.info(
                `[cortex pane ${slotIndex}] experiment routing: routed=${res.routed}, warnings=${res.warnings.length}`,
              );
              if (res.warnings.length > 0) setError(res.warnings[0]);
            })
            .catch((e) =>
              console.warn(
                `[pane ${slotIndex}] route_experiment_blocks failed:`,
                e,
              ),
            );
        }

        scheduleCommit();
        return true;
      } catch (e) {
        console.error(`[pane ${slotIndex}] write_markdown_file failed:`, e);
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
        }).catch((e) =>
          console.warn(`[pane ${slotIndex}] git_auto_commit failed:`, e),
        );
      }, COMMIT_MS);
    }

    // --- autosave --------------------------------------------------------
    useEffect(() => {
      if (!dirty) return;
      const t = window.setTimeout(() => {
        saveCurrentFile();
      }, AUTOSAVE_MS);
      return () => window.clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dirty, editedBody]);

    // --- imperative API --------------------------------------------------
    useImperativeHandle(
      ref,
      (): TabPaneHandle => ({
        async saveIfDirty() {
          return saveCurrentFile();
        },
        async reload() {
          // Re-read from disk via a state tick. Saves any dirty buffer
          // first so the user doesn't accidentally drop their typing.
          if (dirty) {
            await saveCurrentFile();
          }
          setReloadTick((t) => t + 1);
        },
        insertExperimentBlock(name: string, iter: number) {
          const editor = editorInstanceRef.current;
          if (!editor) {
            console.warn(
              `[pane ${slotIndex}] editor not ready for block insert`,
            );
            return;
          }
          const header = `::experiment ${name} / iter-${iter}`;
          const closer = "::end";
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
          const cursorTarget = insertAt + header.length + 5;
          editor.chain().setTextSelection(cursorTarget).run();
        },
        insertTable(rows: number, cols: number, withHeaderRow: boolean) {
          const ed = editorInstanceRef.current;
          if (!ed) {
            console.warn(
              `[pane ${slotIndex}] editor not ready for table insert`,
            );
            return;
          }
          ed.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
        },
        insertGitHubMarkdown(markdown: string) {
          const editor = editorInstanceRef.current;
          if (!editor) {
            console.warn(
              `[pane ${slotIndex}] editor not ready for github insert`,
            );
            return;
          }
          // Insert each line of the markdown as its own paragraph,
          // followed by an explicit blank paragraph for breathing
          // room. The user sees raw markdown briefly; saving and
          // re-opening parses **bold** / lists / `code` properly via
          // tiptap-markdown's html:true config. This mirrors how
          // `::experiment` blocks behave today.
          const heading = "## Today's GitHub activity";
          const lines = [heading, "", ...markdown.split("\n"), ""];
          const nodes = lines.map((line) =>
            line === ""
              ? { type: "paragraph" }
              : {
                  type: "paragraph",
                  content: [{ type: "text", text: line }],
                },
          );
          const $from = editor.state.selection.$from;
          const insertAt = $from.depth === 0 ? $from.pos : $from.after(1);
          editor.chain().focus().insertContentAt(insertAt, nodes).run();
        },
        async openPath(path: string | null) {
          // Save dirty state first so we don't lose anything.
          if (selectedPath && dirty && selectedPath !== path) {
            await saveCurrentFile();
          }
          if (path && /\.pdf$/i.test(path)) {
            setSelectedPath(path);
            setActiveViewLocal("pdf-reader");
            return;
          }
          setActiveViewLocal("editor");
          setSelectedPath(path);
        },
        setActiveView(view: ActiveView) {
          setActiveViewLocal(view);
        },
        getPath() {
          return selectedPath;
        },
        getActiveView() {
          return activeView;
        },
        getDirty() {
          return dirty;
        },
        getDirtySnapshot() {
          return { selectedPath, frontmatter, editedBody };
        },
        isEditorFocused() {
          const ae = document.activeElement as Element | null;
          if (!ae) return false;
          const inProseMirror = !!ae.closest?.(".ProseMirror");
          if (!inProseMirror) return false;
          // Make sure the focused .ProseMirror is *this* pane's, not a
          // different pane's.
          return isInsideEl(ae, paneRootRef.current);
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [selectedPath, activeView, dirty, editedBody, frontmatter],
    );

    // --- derive identifiers for backlinks --------------------------------
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

    // --- click-to-activate ----------------------------------------------
    function handlePaneClick() {
      onActivate();
    }

    // --- in-pane open helper for backlinks/related/queue/log views ------
    function openInThisPane(path: string) {
      return onOpenFileInPane(path, slotIndex);
    }

    // --- close helper for structured views ------------------------------
    function closeStructuredView() {
      setActiveViewLocal("editor");
    }

    // --- render ---------------------------------------------------------
    // PDF view drops the pane padding because zoomed-in pages need to
    // be able to scroll edge-to-edge. With padding the page would
    // bleed under the padding gutters, masking part of the highlight
    // overlay near the slot's left/right edges.
    const isPdf = activeView === "pdf-reader";
    return (
      <div
        ref={paneRootRef}
        onMouseDown={handlePaneClick}
        onFocusCapture={handlePaneClick}
        style={{
          position: "relative",
          height: "100%",
          width: "100%",
          // PDF view manages its own internal scroll container so the
          // in-PDF search bubble can pin to the visible area and so
          // search-hit navigation only moves the inner scrollbar.
          // Editor / structured-view paths still want the pane-level
          // scroll for long bodies.
          overflow: isPdf ? "hidden" : "auto",
          padding: isPdf ? 0 : "1.5rem 1.5rem",
          boxSizing: "border-box",
          background: "var(--bg)",
          // Outline and badge are visual disambiguators for multi-
          // slot layouts only — single-slot users have nothing to
          // disambiguate against, so we hide both. (Keyboard routing
          // uses the `isActive` prop directly; visuals use `multiSlot`.)
          outline: isActive && multiSlot ? "2px solid var(--accent)" : "none",
          outlineOffset: "-2px",
        }}
      >
        {multiSlot && <SlotBadge index={slotIndex} active={isActive} />}
        {activeView === "queue-yellow" ? (
          <MarkQueueView
            vaultPath={vaultPath}
            kind="yellow"
            ageDays={7}
            title="Weekly review"
            blurb="Yellow-marked content from the last 7 days, grouped by source note. Strike through (Ctrl+Shift+X) items inside the source to mark them resolved."
            refreshKey={indexVersion}
            onOpenFile={openInThisPane}
            onClose={closeStructuredView}
          />
        ) : activeView === "queue-green" ? (
          <MarkQueueView
            vaultPath={vaultPath}
            kind="green"
            ageDays={30}
            title="Monthly review"
            blurb="Green-marked content from the last 30 days, grouped by source note."
            refreshKey={indexVersion}
            onOpenFile={openInThisPane}
            onClose={closeStructuredView}
          />
        ) : activeView === "idea-log" ? (
          <IdeaLog
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={openInThisPane}
            onClose={closeStructuredView}
            onNewIdea={() => {
              /* App handles new-idea modal via its own button; this is a
               stub so the prop type is satisfied. */
            }}
          />
        ) : activeView === "methods-arsenal" ? (
          <MethodsArsenal
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={openInThisPane}
            onClose={closeStructuredView}
            onNewMethod={() => {
              /* see comment above */
            }}
          />
        ) : activeView === "protocols-log" ? (
          <ProtocolsLog
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onOpenFile={openInThisPane}
            onClose={closeStructuredView}
            onNewProtocol={() => {
              /* see comment above */
            }}
          />
        ) : activeView === "calendar" ? (
          <Calendar vaultPath={vaultPath} onClose={closeStructuredView} />
        ) : activeView === "pdf-reader" && selectedPath ? (
          <PDFReader
            vaultPath={vaultPath}
            filePath={selectedPath}
            onClose={closeStructuredView}
            isActive={isActive}
          />
        ) : !selectedPath ? (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "0.9rem",
              opacity: 0.85,
            }}
          >
            {slotIndex === 0
              ? "Click a file in the sidebar, press Ctrl+D for today's log, or Ctrl+K to search."
              : "Empty slot — click a file with Ctrl, drag a file here, or use Ctrl+K and pick this slot."}
          </div>
        ) : loadingFile ? (
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            Loading file…
          </div>
        ) : (
          <div style={{ maxWidth: "780px", margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                marginBottom: "1rem",
                paddingBottom: "0.5rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  wordBreak: "break-all",
                  fontFamily:
                    "ui-monospace, 'Cascadia Code', Consolas, monospace",
                }}
              >
                {selectedPath}
              </code>
              <span style={{ fontSize: "0.75rem" }}>
                {dirty ? (
                  <span style={{ color: "var(--warning)" }}>● unsaved</span>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>saved</span>
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
              onFollowWikilink={onFollowWikilink}
              onEditorReady={(e) => {
                editorInstanceRef.current = e;
              }}
              onRequestInsertTable={onRequestInsertTable}
            />
            <RelatedHierarchyPanel
              vaultPath={vaultPath}
              currentPath={selectedPath}
              refreshKey={indexVersion}
              onOpenFile={openInThisPane}
            />
            <BacklinksPanel
              vaultPath={vaultPath}
              currentTitle={currentTitle}
              currentFilename={currentFilename}
              refreshKey={indexVersion}
              onOpenFile={openInThisPane}
            />
          </div>
        )}
      </div>
    );
  },
);

function SlotBadge({ index, active }: { index: number; active: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "6px",
        left: "8px",
        fontSize: "0.65rem",
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: "var(--bg-card)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-2)"}`,
        borderRadius: "10px",
        padding: "1px 7px",
        userSelect: "none",
        pointerEvents: "none",
        opacity: 0.8,
        zIndex: 5,
      }}
      title={`Slot ${index + 1}`}
    >
      {index + 1}
    </div>
  );
}

function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
