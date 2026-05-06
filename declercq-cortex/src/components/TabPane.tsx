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
import { Editor, equalizeTableColumnWidths } from "./Editor";
import { FrontmatterPanel } from "./FrontmatterPanel";
import { BacklinksPanel } from "./BacklinksPanel";
import { RelatedHierarchyPanel } from "./RelatedHierarchyPanel";
import { MarkQueueView } from "./MarkQueueView";
import { IdeaLog } from "./IdeaLog";
import { MethodsArsenal } from "./MethodsArsenal";
import { ProtocolsLog } from "./ProtocolsLog";
import { Calendar } from "./Calendar";
import { TimeTracking } from "./TimeTracking";
import { ImageViewer } from "./ImageViewer";
import { PDFReader } from "./PDFReader";
import { ShapeEditor } from "./ShapeEditor";
import {
  ShapeTemplateModal,
  type ShapeTemplateMode,
} from "./ShapeTemplateModal";
import { ParticleOverlay } from "./ParticleOverlay";
import { EMPTY_SHAPES_DOC, newShapeId, type ShapesDoc } from "../shapes/types";
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
  | "calendar"
  // Cluster 14 v1.0
  | "time-tracking"
  // Cluster 19 v1.0 — open image files directly in a tab slot.
  | "image-viewer";

/** Cluster 19 v1.0 — file extensions routed to ImageViewer. */
export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
] as const;

/** True if the path's extension is one we open in ImageViewer. */
export function isImagePath(path: string): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Imperative API the parent uses to drive this pane. */
export type TabPaneHandle = {
  /** Save the open file if dirty. Returns true on success or no-op. */
  saveIfDirty(): Promise<boolean>;
  /** Re-read the open file from disk (Ctrl+R in this pane). */
  reload(): Promise<void>;
  /** Insert a block scaffold at the cursor. v1.4 widened from
   *  experiment-only to four types (experiment / protocol / idea /
   *  method). For experiment, `iter` is the iteration number; for the
   *  other three it's ignored. The header line shape:
   *    type=experiment → `::experiment NAME / iter-N`
   *    type=protocol   → `::protocol NAME`
   *    type=idea       → `::idea NAME`
   *    type=method     → `::method NAME`
   *  All four share the `::end` closer. */
  insertExperimentBlock(
    type: "experiment" | "protocol" | "idea" | "method",
    name: string,
    iter?: number,
  ): void;
  /** Insert a table at the cursor. */
  insertTable(rows: number, cols: number, withHeaderRow: boolean): void;
  /**
   * Cluster 10 — insert a GitHub summary block at the cursor (slash-
   * command equivalent for `Ctrl+Shift+G`). Inserted as plain text
   * paragraphs containing markdown syntax; renders fully on the next
   * save+reload, the same way `::experiment` blocks behave.
   */
  insertGitHubMarkdown(markdown: string): void;
  /**
   * Cluster 16 — wikilink shortcut (`Ctrl+Shift+W`). If the editor
   * has a non-empty selection, wrap it with `[[...]]` and return
   * true. If the selection is empty, return false so App can open
   * the command palette in pick-mode and let the user choose a note
   * to wikilink to.
   */
  wrapSelectionInWikilink(): boolean;
  /**
   * Cluster 16 — insert `[[title]]` at the current cursor position.
   * Used by the palette pick-mode after the user clicks a result.
   */
  insertWikilinkAt(title: string): void;
  /** Load a file into this pane (handles PDF vs markdown routing). */
  openPath(path: string | null): Promise<void>;
  /** Switch to a structured view (idea-log, methods-arsenal, etc.). */
  setActiveView(view: ActiveView): void;
  /**
   * Cluster 19 v1.0 — copy an image from `sourceAbsolutePath` into
   * the open note's <basename>-attachments/ directory and insert a
   * cortexImage node at the cursor (or at the drop coordinates if
   * provided). Returns true on success. No-op (returns false) if no
   * markdown note is open in this slot.
   */
  insertImageFromPath(
    sourceAbsolutePath: string,
    dropClientX?: number,
    dropClientY?: number,
  ): Promise<boolean>;
  /** Cluster 19 v1.0 — open the OS file picker for image files,
   *  copy the chosen one in, and insert at the cursor. */
  insertImageDialog(): Promise<boolean>;
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
  /**
   * Cluster 20 v1.0 — toggle shape editor mode. When the active view
   * is `editor` and a markdown note is open, flips
   * `shapeEditorActive`. When leaving the mode, saves any dirty
   * shapes to the sidecar before disabling. No-op if the open file
   * isn't a markdown note (PDFs / images skip).
   */
  toggleShapeEditor(): Promise<void>;
  /** Cluster 20 v1.0 — true when this pane is currently in shape
   *  editor mode. Used by App for global key gating. */
  getShapeEditorActive(): boolean;
  /** Cluster 20 v1.0 — write the shapes sidecar if dirty. Returns
   *  true on success or no-op (already saved); false if the call
   *  errored. Triggered by Ctrl+S, by save-on-blur, by
   *  toggleShapeEditor when leaving the mode, and by the parent's
   *  save-before-close fan-out. */
  saveShapesIfDirty(): Promise<boolean>;
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
  /**
   * Cluster 17 v1.1 — Ctrl/Cmd+Click on a typedBlock title bar. App
   * resolves the reference (via the resolve_typed_block_target Tauri
   * command) and opens the resulting path in this slot.
   */
  onFollowTypedBlock: (attrs: {
    blockType: "experiment" | "protocol" | "idea" | "method";
    name: string;
    iterNumber: number | null;
  }) => void;
  /** Editor right-click "Insert table…" — App opens the modal. */
  onRequestInsertTable: () => void;
  /** Open a file in this pane (used by backlinks / related panel). */
  onOpenFileInPane: (path: string, slotIndex: number) => Promise<void>;
  /**
   * Cluster 21 v1.0.2 — universal-toolbar wiring. App tracks every
   * pane's editor instance so the single top-level EditorToolbar can
   * always operate on the currently-active pane. TabPane reports
   * its editor here as soon as it's mounted (and again with `null`
   * on unmount).
   */
  onEditorChange?: (editor: any | null) => void;
  /**
   * Cluster 21 v1.0.2 — `pause-animations` toolbar pref forwarded
   * down so the per-pane ParticleOverlay can pause/resume in sync.
   */
  particlesPaused?: boolean;
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
      onFollowTypedBlock,
      onRequestInsertTable,
      onOpenFileInPane,
      onEditorChange,
      particlesPaused,
    } = props;

    // --- per-pane state --------------------------------------------------
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [activeView, setActiveViewLocal] = useState<ActiveView>("editor");
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
    const [fileBody, setFileBody] = useState<string>("");
    const [editedBody, setEditedBody] = useState<string>("");
    const [dirty, setDirty] = useState(false);
    const [loadingFile, setLoadingFile] = useState(false);

    // --- Cluster 20 v1.0 — shape editor state ----------------------------
    const [shapeEditorActive, setShapeEditorActive] = useState(false);
    const [shapesDoc, setShapesDoc] = useState<ShapesDoc>(EMPTY_SHAPES_DOC);
    const [shapesDirty, setShapesDirty] = useState(false);
    // Cluster 20 v1.0.6 — snapshot-based undo / redo for shape edits.
    // Each entry is a deep-cloned ShapesDoc snapshot. pushShapesUndo
    // captures the CURRENT shapesDoc; the operation that follows
    // mutates shapesDoc freely (no further pushes for intermediate
    // pointermove updates), and Ctrl+Z reverts in one step. Capped
    // at SHAPES_HISTORY_LIMIT entries (oldest dropped beyond that).
    const [shapesUndoStack, setShapesUndoStack] = useState<ShapesDoc[]>([]);
    const [shapesRedoStack, setShapesRedoStack] = useState<ShapesDoc[]>([]);
    /** Most-recently-written shapes JSON, used to compare for the
     *  idempotent save (skip the Tauri write when in-memory matches
     *  what's on disk). */
    const lastWrittenShapesRef = useRef<string>(
      JSON.stringify(EMPTY_SHAPES_DOC),
    );
    /** Tracks the pane's scroll-area dimensions so the SVG overlay
     *  can size itself to cover the document content (including the
     *  parts below the fold). Updated by a ResizeObserver on the
     *  pane root. */
    const [shapeOverlayDims, setShapeOverlayDims] = useState<{
      width: number;
      height: number;
    }>({ width: 0, height: 0 });
    const [templateModal, setTemplateModal] =
      useState<ShapeTemplateMode | null>(null);
    // Cluster 21 v1.0.2 — toolbar prefs and the universal toolbar
    // mount have moved to App.tsx. Each pane only reports its
    // editor instance up via `onEditorChange` and tracks its own
    // particle-rescan key. The toolbar is mounted once at the top
    // of the app and operates on whichever pane is active.
    const [particleRescanKey, setParticleRescanKey] = useState(0);
    // Cluster 21 v1.0.2 — clear the App-level editor reference for
    // this slot when the pane unmounts (e.g., layout shrinks from
    // tri to single).
    useEffect(() => {
      return () => onEditorChange?.(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- timers ----------------------------------------------------------
    const commitTimerRef = useRef<number | null>(null);

    // --- editor instance ref --------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorInstanceRef = useRef<any | null>(null);

    // --- pane container ref (for "is editor focused inside this pane?") --
    const paneRootRef = useRef<HTMLDivElement | null>(null);
    // --- Cluster 20 v1.0 — editor-content wrapper ref (the SVG shape
    //     overlay positions itself absolutely inside this wrapper so it
    //     covers exactly the editor area and scrolls naturally with it).
    const editorWrapperRef = useRef<HTMLDivElement | null>(null);

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
      // Cluster 19 v1.0.1 — image files are rendered by ImageViewer, not
      // parsed as markdown. Short-circuit so we don't fire read_markdown_file
      // on a binary stream (which would error with "stream did not contain
      // valid UTF-8").
      if (isImagePath(selectedPath)) {
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

    // --- Cluster 20 v1.0 — load shapes sidecar after file load -----------
    // Only fetches when the open file is a markdown note. PDFs / images
    // skip; the sidecar isn't relevant to those views in v1.0.
    // v1.0.6 — also resets the shape-edit undo / redo stacks so the
    // history is per-file (otherwise undoing after a file switch would
    // try to apply the previous file's snapshots to the new file).
    useEffect(() => {
      setShapesUndoStack([]);
      setShapesRedoStack([]);
      if (!selectedPath) {
        setShapesDoc(EMPTY_SHAPES_DOC);
        setShapesDirty(false);
        setShapeEditorActive(false);
        lastWrittenShapesRef.current = JSON.stringify(EMPTY_SHAPES_DOC);
        return;
      }
      if (/\.pdf$/i.test(selectedPath) || isImagePath(selectedPath)) {
        setShapesDoc(EMPTY_SHAPES_DOC);
        setShapesDirty(false);
        setShapeEditorActive(false);
        return;
      }
      invoke<ShapesDoc | null>("read_shapes_sidecar", {
        notePath: selectedPath,
      })
        .then((doc) => {
          const next = doc ?? EMPTY_SHAPES_DOC;
          setShapesDoc(next);
          setShapesDirty(false);
          lastWrittenShapesRef.current = JSON.stringify(next);
        })
        .catch((e) => {
          console.warn(`[pane ${slotIndex}] read_shapes_sidecar failed:`, e);
          setShapesDoc(EMPTY_SHAPES_DOC);
          setShapesDirty(false);
          lastWrittenShapesRef.current = JSON.stringify(EMPTY_SHAPES_DOC);
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPath, reloadTick]);

    /** Cluster 20 v1.0 — write the shapes sidecar if dirty. Idempotent
     *  via JSON-string comparison against the last-written snapshot;
     *  the backend ALSO has its own idempotence check (file-content
     *  diff) so a redundant call here doesn't bump mtime. */
    async function saveShapesNow(): Promise<boolean> {
      if (!selectedPath) return false;
      if (!shapesDirty) return true;
      if (/\.pdf$/i.test(selectedPath) || isImagePath(selectedPath)) {
        return false;
      }
      const next = JSON.stringify(shapesDoc);
      if (next === lastWrittenShapesRef.current) {
        setShapesDirty(false);
        return true;
      }
      try {
        await invoke("write_shapes_sidecar", {
          notePath: selectedPath,
          doc: shapesDoc,
        });
        lastWrittenShapesRef.current = next;
        setShapesDirty(false);
        return true;
      } catch (e) {
        console.error(`[pane ${slotIndex}] write_shapes_sidecar failed:`, e);
        setError(`Could not save shapes: ${e}`);
        return false;
      }
    }

    // ---- Cluster 20 v1.0.6 — shape-edit undo / redo --------------------
    const SHAPES_HISTORY_LIMIT = 100;
    /** Capture the current shapesDoc onto the undo stack and clear
     *  the redo stack. Called by ShapeEditor at the start of every
     *  atomic operation, plus directly here for the template-load
     *  flow that lives in this component. Idempotent against the
     *  most recent stack entry — back-to-back identical pushes
     *  collapse into one to keep the stack tidy. */
    function pushShapesUndo() {
      const snapshot = JSON.stringify(shapesDoc);
      setShapesUndoStack((prev) => {
        const top = prev[prev.length - 1];
        if (top && JSON.stringify(top) === snapshot) return prev;
        const cloned = JSON.parse(snapshot) as ShapesDoc;
        const next = [...prev, cloned];
        if (next.length > SHAPES_HISTORY_LIMIT) next.shift();
        return next;
      });
      setShapesRedoStack([]);
    }
    /** Pop the latest undo snapshot, push the current state to redo,
     *  apply the popped snapshot. Recomputes shapesDirty against the
     *  last-saved snapshot so the unsaved indicator reflects the
     *  reverted state. No-op when the stack is empty. */
    function undoShapes() {
      if (shapesUndoStack.length === 0) return;
      const last = shapesUndoStack[shapesUndoStack.length - 1];
      const currentSnapshot = JSON.parse(
        JSON.stringify(shapesDoc),
      ) as ShapesDoc;
      setShapesUndoStack((u) => u.slice(0, -1));
      setShapesRedoStack((r) => {
        const next = [...r, currentSnapshot];
        if (next.length > SHAPES_HISTORY_LIMIT) next.shift();
        return next;
      });
      setShapesDoc(last);
      setShapesDirty(JSON.stringify(last) !== lastWrittenShapesRef.current);
    }
    /** Symmetric to undoShapes. */
    function redoShapes() {
      if (shapesRedoStack.length === 0) return;
      const last = shapesRedoStack[shapesRedoStack.length - 1];
      const currentSnapshot = JSON.parse(
        JSON.stringify(shapesDoc),
      ) as ShapesDoc;
      setShapesRedoStack((r) => r.slice(0, -1));
      setShapesUndoStack((u) => {
        const next = [...u, currentSnapshot];
        if (next.length > SHAPES_HISTORY_LIMIT) next.shift();
        return next;
      });
      setShapesDoc(last);
      setShapesDirty(JSON.stringify(last) !== lastWrittenShapesRef.current);
    }

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

          // Cluster 16 v1.1 — also route ::protocol / ::idea / ::method
          // blocks. Same shape as experiment routing but resolves into
          // a single document under 04-Ideas/ / 05-Methods/ / 06-Protocols/.
          // Independent failure path so an unmatched typed block doesn't
          // mask experiment routing warnings or vice versa.
          invoke<{ routed: number; warnings: string[] }>("route_typed_blocks", {
            vaultPath,
            dailyNotePath: selectedPath,
          })
            .then((res) => {
              console.info(
                `[cortex pane ${slotIndex}] typed routing: routed=${res.routed}, warnings=${res.warnings.length}`,
              );
              if (res.warnings.length > 0) setError(res.warnings[0]);
            })
            .catch((e) =>
              console.warn(`[pane ${slotIndex}] route_typed_blocks failed:`, e),
            );

          // Cluster 16 v1.1.1 — two-way sync, the document → daily-note
          // direction. Fires on EVERY save (Rust short-circuits if the
          // saved file has no typed-auto section). When the file IS a
          // protocol/idea/method document and its auto-section content
          // has been edited, the corresponding ::TYPE NAME / ::end
          // block in the source daily note is updated in place — no
          // new block is created.
          invoke<number>("propagate_typed_block_edits", {
            vaultPath,
            filePath: selectedPath,
          })
            .then((n) => {
              if (n > 0) {
                console.info(
                  `[cortex pane ${slotIndex}] typed propagate: ${n} block(s) propagated to source daily notes`,
                );
              }
            })
            .catch((e) =>
              console.warn(
                `[pane ${slotIndex}] propagate_typed_block_edits failed:`,
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

    // --- Cluster 20 v1.0 — track the editor-wrapper's pixel size so the
    //     shape overlay sizes its SVG to cover exactly the editor area.
    //     Uses a ResizeObserver so content-driven height changes (typing,
    //     loading a longer note, expanding panels) update live.
    useEffect(() => {
      const el = editorWrapperRef.current;
      if (!el) return;
      const update = () => {
        // offsetWidth / offsetHeight reflect the rendered box, which is
        // what we want for the SVG's coordinate space (1 SVG unit = 1
        // CSS pixel). scrollWidth/scrollHeight would over-shoot when
        // children have negative margins.
        setShapeOverlayDims({
          width: el.offsetWidth,
          height: el.offsetHeight,
        });
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      // Also catch content mutations that change height without
      // changing the wrapper's clientWidth (e.g. inserting many lines
      // of text). MutationObserver is cheap when subtree is small.
      const mo = new MutationObserver(update);
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      return () => {
        ro.disconnect();
        mo.disconnect();
      };
      // Re-bind when the file changes so a freshly-mounted wrapper is
      // observed.
    }, [selectedPath, activeView]);

    // --- imperative API --------------------------------------------------
    useImperativeHandle(
      ref,
      (): TabPaneHandle => ({
        async saveIfDirty() {
          // Cluster 20 v1.0 — fan out to shape sidecar too. Both are
          // independent dirty flags; a clean .md + dirty shapes still
          // writes the sidecar.
          const fileOk = await saveCurrentFile();
          const shapesOk = await saveShapesNow();
          return fileOk && shapesOk;
        },
        async reload() {
          // Re-read from disk via a state tick. Saves any dirty buffer
          // first so the user doesn't accidentally drop their typing.
          if (dirty) {
            await saveCurrentFile();
          }
          setReloadTick((t) => t + 1);
        },
        insertExperimentBlock(
          type: "experiment" | "protocol" | "idea" | "method",
          name: string,
          iter?: number,
        ) {
          const editor = editorInstanceRef.current;
          if (!editor) {
            console.warn(
              `[pane ${slotIndex}] editor not ready for block insert`,
            );
            return;
          }
          // Cluster 17 — insert a typedBlock node directly. Fresh
          // blocks are born as the new custom node; the post-setContent
          // lift transform handles the legacy plain-paragraph form on
          // load. The node's markdown serializer emits the same on-disk
          // text the v1.0/v1.1 inserter wrote (`::TYPE NAME / iter-N`
          // header + body + `::end` closer), so route_*_blocks on the
          // Rust side is unaffected.
          const $from = editor.state.selection.$from;
          const insertAt = $from.depth === 0 ? $from.pos : $from.after(1);
          editor
            .chain()
            .focus()
            .insertContentAt(insertAt, {
              type: "typedBlock",
              attrs: {
                blockType: type,
                name,
                iterNumber: type === "experiment" ? (iter ?? 1) : null,
              },
              content: [{ type: "paragraph" }],
            })
            .run();
          // Place the cursor inside the block's first body paragraph.
          // The typedBlock node opens at insertAt; its inner paragraph
          // starts at insertAt+1 and the paragraph's text begins at
          // insertAt+2.
          const cursorTarget = insertAt + 2;
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
          // Cluster 16 v1.1.4: immediately give every cell an explicit
          // colwidth via equalize. Without this, fresh tables have no
          // colwidths, which makes prosemirror-tables's
          // `updateColumnsOnResize` use the 100px-per-column fallback
          // and re-run on every hover-near-boundary, growing empty
          // cells visibly. With explicit widths set up-front, the
          // re-run is a no-op (style.width assignments are unchanged
          // and the browser skips layout). One frame's delay so the
          // insert transaction has fully committed before equalize
          // walks the doc.
          requestAnimationFrame(() => {
            const ed2 = editorInstanceRef.current;
            if (ed2) equalizeTableColumnWidths(ed2);
          });
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
        wrapSelectionInWikilink() {
          const editor = editorInstanceRef.current;
          if (!editor) return false;
          const { from, to, empty } = editor.state.selection;
          if (empty || from === to) return false;
          // Read the literal selected text (no marks). For a multi-
          // node selection this concatenates the text content.
          const text = editor.state.doc.textBetween(from, to, "\n", "\n");
          if (!text.trim()) return false;
          // Replace selection with [[text]]. insertContent at the
          // selection range automatically deletes + inserts.
          editor
            .chain()
            .focus()
            .insertContentAt({ from, to }, `[[${text.trim()}]]`)
            .run();
          return true;
        },
        insertWikilinkAt(title: string) {
          const editor = editorInstanceRef.current;
          if (!editor) return;
          const trimmed = title.trim();
          if (!trimmed) return;
          editor.chain().focus().insertContent(`[[${trimmed}]]`).run();
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
          // Cluster 19 v1.0 — image files open in ImageViewer.
          if (path && isImagePath(path)) {
            setSelectedPath(path);
            setActiveViewLocal("image-viewer");
            return;
          }
          setActiveViewLocal("editor");
          setSelectedPath(path);
        },
        async insertImageFromPath(
          sourceAbsolutePath,
          dropClientX,
          dropClientY,
        ) {
          if (!selectedPath || !sourceAbsolutePath) return false;
          // Only meaningful when an md file is open.
          if (!/\.md$/i.test(selectedPath)) return false;
          const ed = editorInstanceRef.current;
          if (!ed) return false;
          try {
            const relSrc = await invoke<string>("import_image_to_note", {
              vaultPath,
              notePath: selectedPath,
              sourcePath: sourceAbsolutePath,
            });
            // Compute insert position. If drop coords were provided,
            // map them to a doc position; otherwise fall through to
            // the current selection.
            let insertPos: number | null = null;
            if (
              typeof dropClientX === "number" &&
              typeof dropClientY === "number"
            ) {
              const coords = ed.view.posAtCoords({
                left: dropClientX,
                top: dropClientY,
              });
              if (coords) insertPos = coords.pos;
            }
            // Cluster 19 v1.0.2 — default new images to FREE wrap mode
            // so they're freely movable from the moment they land. We
            // seed (freeX, freeY) from the drop coordinates when given,
            // else from the cursor position; both are translated into
            // .ProseMirror-relative pixels (the editor content area is
            // the positioned ancestor of free-mode images).
            const proseMirror = ed.view.dom as HTMLElement;
            const pmRect = proseMirror.getBoundingClientRect();
            const pmScrollLeft = proseMirror.scrollLeft;
            const pmScrollTop = proseMirror.scrollTop;
            let seedClientX = dropClientX;
            let seedClientY = dropClientY;
            if (
              typeof seedClientX !== "number" ||
              typeof seedClientY !== "number"
            ) {
              try {
                const cursor = ed.view.coordsAtPos(ed.state.selection.from);
                seedClientX = cursor.left;
                seedClientY = cursor.top;
              } catch {
                seedClientX = pmRect.left + 16;
                seedClientY = pmRect.top + 16;
              }
            }
            const freeX = Math.round(seedClientX - pmRect.left + pmScrollLeft);
            const freeY = Math.round(seedClientY - pmRect.top + pmScrollTop);
            const node = {
              type: "cortexImage",
              attrs: {
                src: relSrc,
                wrapMode: "free",
                freeX,
                freeY,
                rotation: 0,
                width: null,
                annotation: "",
              },
            };
            // Use insertContentAt to land cleanly at a doc position even
            // when that position isn't inside a paragraph (block boundary).
            // Falls back to current selection when no drop pos was given.
            if (insertPos != null) {
              ed.chain().focus().insertContentAt(insertPos, node).run();
            } else {
              ed.chain().focus().insertContent(node).run();
            }
            return true;
          } catch (e) {
            console.warn("[TabPane] insertImageFromPath failed:", e);
            setError(`Image import failed: ${e}`);
            return false;
          }
        },
        async insertImageDialog() {
          if (!selectedPath || !/\.md$/i.test(selectedPath)) {
            return false;
          }
          try {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const picked = await open({
              multiple: false,
              filters: [
                {
                  name: "Images",
                  extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
                },
              ],
            });
            if (!picked) return false;
            const sourcePath = Array.isArray(picked) ? picked[0] : picked;
            if (!sourcePath) return false;
            return await (this as unknown as TabPaneHandle).insertImageFromPath(
              sourcePath as string,
            );
          } catch (e) {
            console.warn("[TabPane] insertImageDialog failed:", e);
            setError(`Image dialog failed: ${e}`);
            return false;
          }
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
        // Cluster 20 v1.0 — Shape Editor mode
        async toggleShapeEditor() {
          // No-op when no markdown file is open in this pane.
          if (!selectedPath) return;
          if (
            /\.pdf$/i.test(selectedPath) ||
            isImagePath(selectedPath) ||
            activeView !== "editor"
          ) {
            return;
          }
          if (shapeEditorActive) {
            // Leaving the mode → save dirty shapes first.
            await saveShapesNow();
            setShapeEditorActive(false);
          } else {
            setShapeEditorActive(true);
          }
        },
        getShapeEditorActive() {
          return shapeEditorActive;
        },
        async saveShapesIfDirty() {
          return saveShapesNow();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        selectedPath,
        activeView,
        dirty,
        editedBody,
        frontmatter,
        shapeEditorActive,
        shapesDoc,
        shapesDirty,
      ],
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
        ) : activeView === "time-tracking" ? (
          <TimeTracking
            vaultPath={vaultPath}
            refreshKey={indexVersion}
            onClose={closeStructuredView}
          />
        ) : activeView === "pdf-reader" && selectedPath ? (
          <PDFReader
            vaultPath={vaultPath}
            filePath={selectedPath}
            onClose={closeStructuredView}
            isActive={isActive}
          />
        ) : activeView === "image-viewer" && selectedPath ? (
          <ImageViewer filePath={selectedPath} onClose={closeStructuredView} />
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
          // Cluster 20 v1.0 — `position: relative` wrapper so the SVG
          // shape overlay (rendered last) can pin absolutely to this
          // box and scroll naturally with the editor content.
          <div
            ref={editorWrapperRef}
            className={
              shapeEditorActive ? "cortex-shape-editor-active" : undefined
            }
            style={{
              maxWidth: "780px",
              margin: "0 auto",
              position: "relative",
            }}
          >
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
              vaultPath={vaultPath}
              notePath={selectedPath}
              content={fileBody}
              editable={!shapeEditorActive}
              onChange={(md) => {
                setEditedBody(md);
                setDirty(md !== fileBody);
                // Bump the particle rescan key so ParticleOverlay
                // picks up new / removed particle hosts.
                setParticleRescanKey((k) => k + 1);
              }}
              onFollowWikilink={onFollowWikilink}
              onFollowTypedBlock={onFollowTypedBlock}
              onEditorReady={(e) => {
                editorInstanceRef.current = e;
                // Cluster 21 v1.0.2 — report the editor up to App so
                // the universal top-of-app toolbar binds to it when
                // this pane is active.
                onEditorChange?.(e);
                setParticleRescanKey((k) => k + 1);
              }}
              onRequestInsertTable={onRequestInsertTable}
              onError={(msg) => setError(msg)}
            />
            <ParticleOverlay
              rootRef={editorWrapperRef}
              rescanKey={particleRescanKey}
              paused={!!particlesPaused}
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
            {/* Cluster 20 v1.0 — Shape Editor SVG overlay. Always
                mounted for markdown notes so existing shapes are
                visible while reading; pointer-events flips on/off
                based on shapeEditorActive (handled inside the
                component). The overlay covers the whole editor
                wrapper, so freehand drag near the bottom of a long
                note still has canvas to land on. */}
            {selectedPath && /\.md$/i.test(selectedPath) && (
              <ShapeEditor
                active={shapeEditorActive}
                doc={shapesDoc}
                onDocChange={(next) => {
                  setShapesDoc(next);
                  // Mark dirty when the in-memory JSON differs from
                  // what's last on disk. The save path's idempotence
                  // check handles the no-op case too, but flagging
                  // dirty here lets the unsaved-indicator UI react.
                  const nextJson = JSON.stringify(next);
                  setShapesDirty(nextJson !== lastWrittenShapesRef.current);
                }}
                width={shapeOverlayDims.width}
                height={shapeOverlayDims.height}
                onPushUndo={pushShapesUndo}
                onUndo={undoShapes}
                onRedo={redoShapes}
                canUndo={shapesUndoStack.length > 0}
                canRedo={shapesRedoStack.length > 0}
                onExit={async () => {
                  await saveShapesNow();
                  setShapeEditorActive(false);
                }}
                onSaveTemplate={() => {
                  setTemplateModal({ kind: "save", doc: shapesDoc });
                }}
                onLoadTemplate={() => {
                  setTemplateModal({ kind: "load" });
                }}
              />
            )}
            {templateModal && (
              <ShapeTemplateModal
                vaultPath={vaultPath}
                mode={templateModal}
                onSave={async (name) => {
                  await invoke("save_shape_template", {
                    vaultPath,
                    name,
                    doc: shapesDoc,
                  });
                  setTemplateModal(null);
                }}
                onLoad={async (name) => {
                  // Read the template, then ADDITIVELY merge its
                  // shapes into the current doc with fresh ids so
                  // re-loads don't collide.
                  const tpl = await invoke<ShapesDoc>("read_shape_template", {
                    vaultPath,
                    name,
                  });
                  const reidShapes = tpl.shapes.map((s) => ({
                    ...s,
                    id: newShapeId(),
                  }));
                  const merged: ShapesDoc = {
                    version: shapesDoc.version || 1,
                    shapes: [...shapesDoc.shapes, ...reidShapes],
                  };
                  // Cluster 20 v1.0.6 — capture the pre-load state so
                  // the user can Ctrl+Z to revert a template merge.
                  pushShapesUndo();
                  setShapesDoc(merged);
                  setShapesDirty(
                    JSON.stringify(merged) !== lastWrittenShapesRef.current,
                  );
                  setTemplateModal(null);
                }}
                onClose={() => setTemplateModal(null)}
              />
            )}
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
