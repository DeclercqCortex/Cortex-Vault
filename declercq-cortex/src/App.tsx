import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./components/FileTree";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ReviewsMenu, type DestinationChoice } from "./components/ReviewsMenu";
import { ColorLegend } from "./components/ColorLegend";
import { ExperimentBlockModal } from "./components/ExperimentBlockModal";
import { InsertTableModal } from "./components/InsertTableModal";
import { IntegrationsSettings } from "./components/IntegrationsSettings";
import { ReminderOverlay } from "./components/ReminderOverlay";
import { OrphanAttachmentsModal } from "./components/OrphanAttachmentsModal";
import { NotificationBell } from "./components/NotificationBell";
import { ThemeToggle, useTheme } from "./components/ThemeToggle";
import {
  NewHierarchyModal,
  type HierarchyKind,
} from "./components/NewHierarchyModal";
import { serializeFrontmatter } from "./utils/frontmatter";
import {
  TabPane,
  type TabPaneHandle,
  type ActiveView,
} from "./components/TabPane";
import {
  LayoutPicker,
  slotCountForLayout,
  type LayoutMode,
} from "./components/LayoutPicker";
import { LayoutGrid } from "./components/LayoutGrid";
import { SlotPicker } from "./components/SlotPicker";
import {
  EditorToolbar,
  loadToolbarPrefs,
  saveToolbarPrefs,
  type ToolbarPrefs,
} from "./components/EditorToolbar";
// Cluster 22 v1.0 — Document Templates modal + helper that reads the
// current "templates enabled" flag so creation flows can pass it through.
import {
  TemplatesModal,
  readTemplatesEnabled,
} from "./components/TemplatesModal";
// Cluster 24 v1.0 — File operations (right-click in sidebar) + Reviews.
import {
  FileTreeContextMenu,
  type FileTreeAction,
} from "./components/FileTreeContextMenu";
import type { FileNode, PendingEdit } from "./components/FileTree";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";
import { ReviewSettingsModal } from "./components/ReviewSettingsModal";
// Cluster 26 — Cerebrum splash. Renders during loading + welcome states;
// fades out after vault is selected.
import { CerebrumSplash } from "./components/CerebrumSplash";
import {
  PlotterSidebar,
  type PlotterBinding,
} from "./components/PlotterSidebar";
import {
  FOCUS_PLOT_EVENT,
  type FocusPlotDetail,
} from "./components/CortexPlotNodeView";
import type { PlotData } from "./editor/CortexPlotNode";

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
 * True when keyboard focus is somewhere inside any TipTap editor.
 *
 * Used to gate the App-level hierarchy shortcuts (Ctrl+N, Ctrl+Shift+P/E/I)
 * so they don't fire while the user is typing.
 */
function isAnyEditorFocused(): boolean {
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

const MAX_SLOTS = 4;

interface NoteListItem {
  path: string;
  title: string;
}

function App() {
  // --- vault + global state -------------------------------------------
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [indexVersion, setIndexVersion] = useState(0);

  // --- Cluster 26 splash --------------------------------------------------
  // Force-show the Cerebrum splash on every cold launch. The splash holds
  // visible for at least SPLASH_MIN_MS so the user actually sees the brain
  // rotate, regardless of how fast the vault resolves. Once that floor has
  // elapsed AND the vault is loaded (or the user is on the welcome screen),
  // we fade out.
  const SPLASH_MIN_MS = 2800;
  const [splashVisible, setSplashVisible] = useState<boolean>(true);
  const [splashFloorReached, setSplashFloorReached] = useState<boolean>(false);
  useEffect(() => {
    const id = window.setTimeout(
      () => setSplashFloorReached(true),
      SPLASH_MIN_MS,
    );
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    // Fade conditions:
    //   - the SPLASH_MIN_MS floor has elapsed, AND
    //   - the loading state has resolved (vaultPath set OR welcome shown)
    // We don't gate on vaultPath specifically because the welcome screen
    // is itself a place the user lingers; the splash should sit behind
    // the welcome card and fade once both are stable.
    if (!splashFloorReached) return;
    if (loading) return;
    setSplashVisible(false);
  }, [splashFloorReached, loading]);

  // --- multi-slot state ------------------------------------------------
  // We keep MAX_SLOTS pane components mounted always, hidden by the
  // grid layout when not active. This means each pane retains its own
  // state when the user switches layouts (e.g., from quad → dual the
  // slots that survive keep their open files).
  const paneRefs = useRef<(TabPaneHandle | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [slotPaths, setSlotPaths] = useState<(string | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const [slotViews, setSlotViews] = useState<ActiveView[]>(
    Array.from({ length: MAX_SLOTS }, () => "editor" as ActiveView),
  );
  const [slotDirty, setSlotDirty] = useState<boolean[]>(
    Array.from({ length: MAX_SLOTS }, () => false),
  );
  // Cluster 21 v1.0.2 — track each pane's editor instance so the
  // single universal toolbar at the top of the app can bind to
  // whichever pane is currently active.
  const [paneEditors, setPaneEditors] = useState<(any | null)[]>(
    Array.from({ length: MAX_SLOTS }, () => null),
  );
  const setPaneEditorAt = (idx: number, editor: any | null) => {
    setPaneEditors((prev) => {
      // Cluster 21 v1.0.3 — bail out early when the editor reference
      // for this slot hasn't changed. Without this, even a no-op
      // call to setPaneEditorAt would create a fresh array, trigger
      // an App re-render, re-create TabPane's inline onEditorReady,
      // re-fire onEditorReady, recurse → "Maximum update depth
      // exceeded" + OOM.
      if (prev[idx] === editor) return prev;
      const next = prev.slice();
      next[idx] = editor;
      return next;
    });
  };
  // Cluster 21 v1.0.2 — universal toolbar prefs (persisted in
  // localStorage). Moved from per-pane TabPane state.
  const [toolbarPrefs, setToolbarPrefs] = useState<ToolbarPrefs>(() =>
    loadToolbarPrefs(),
  );
  const handleToolbarPrefsChange = (next: ToolbarPrefs) => {
    setToolbarPrefs(next);
    saveToolbarPrefs(next);
  };
  // Reading-mode body class is applied at the App level so the user
  // can toggle it on/off without losing toolbar access. The toolbar
  // itself stays visible in reading mode.
  useEffect(() => {
    document.body.classList.toggle(
      "cortex-reading-mode",
      toolbarPrefs.readingMode,
    );
    return () => {
      document.body.classList.remove("cortex-reading-mode");
    };
  }, [toolbarPrefs.readingMode]);
  const [activeSlotIdx, setActiveSlotIdx] = useState(0);
  // Ref mirror of activeSlotIdx for handlers that need the latest
  // value synchronously (e.g., FileTree click immediately after a
  // pane click — React may not have committed the state update by
  // the time the click handler reads it). `activatePane` updates
  // both the ref and the state in one call.
  const activeSlotIdxRef = useRef(0);
  function activatePane(idx: number) {
    activeSlotIdxRef.current = idx;
    setActiveSlotIdx(idx);
  }
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      const v = localStorage.getItem("cortex:layout-mode");
      if (
        v === "single" ||
        v === "dual" ||
        v === "tri-bottom" ||
        v === "tri-top" ||
        v === "quad"
      ) {
        return v;
      }
    } catch {
      // ignore SecurityError in some sandboxed contexts
    }
    return "single";
  });
  const [colFrac, setColFrac] = useState<number>(() => {
    try {
      const v = parseFloat(
        localStorage.getItem("cortex:layout-col-frac") ?? "",
      );
      if (Number.isFinite(v) && v > 0.1 && v < 0.9) return v;
    } catch {
      // ignore
    }
    return 0.5;
  });
  const [rowFrac, setRowFrac] = useState<number>(() => {
    try {
      const v = parseFloat(
        localStorage.getItem("cortex:layout-row-frac") ?? "",
      );
      if (Number.isFinite(v) && v > 0.1 && v < 0.9) return v;
    } catch {
      // ignore
    }
    return 0.5;
  });

  // Persist layout preferences.
  useEffect(() => {
    try {
      localStorage.setItem("cortex:layout-mode", layoutMode);
    } catch {
      // ignore
    }
  }, [layoutMode]);
  useEffect(() => {
    try {
      localStorage.setItem("cortex:layout-col-frac", String(colFrac));
    } catch {
      // ignore
    }
  }, [colFrac]);
  useEffect(() => {
    try {
      localStorage.setItem("cortex:layout-row-frac", String(rowFrac));
    } catch {
      // ignore
    }
  }, [rowFrac]);

  const slotCount = slotCountForLayout(layoutMode);

  // If the user shrinks the layout to a smaller slot count and the
  // active index falls off the new range, snap back into range.
  useEffect(() => {
    if (activeSlotIdx >= slotCount) {
      activatePane(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotCount, activeSlotIdx]);

  // --- modals ----------------------------------------------------------
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hierarchyKind, setHierarchyKind] = useState<HierarchyKind | null>(
    null,
  );
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  // Cluster 10 — Integrations settings (currently GitHub-only).
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  // Cluster 19 v1.2 — Orphan attachments GC modal (Ctrl+Shift+O).
  const [orphanModalOpen, setOrphanModalOpen] = useState(false);
  // Cluster 15 — Reminders overlay (Ctrl+Shift+M) and a tick the
  // overlay bumps after every save so the NotificationBell refreshes
  // immediately rather than waiting for its 30s poll.
  const [reminderOverlayOpen, setReminderOverlayOpen] = useState(false);
  const [reminderRefreshTick, setReminderRefreshTick] = useState(0);
  // Cluster 16 — wikilink shortcut (Ctrl+Shift+W). When the editor
  // has no selection, we open the existing CommandPalette in this
  // pick-mode: clicking a result inserts `[[Title]]` at the cursor
  // instead of opening the file. The palette UI is unchanged.
  const [wikilinkPickMode, setWikilinkPickMode] = useState(false);
  // Cluster 22 — Document Templates modal.
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  // Cluster 24 v1.0 — Review schedule modal + FileTree right-click state.
  const [reviewSettingsOpen, setReviewSettingsOpen] = useState(false);
  const [fileTreeMenu, setFileTreeMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    path: string;
    name: string;
    nodeType: "file" | "folder";
    containedFileCount?: number;
  } | null>(null);

  // Cluster 12 — auto-sync Google Calendar on startup + every 5 min.
  // Re-fetches event rows from Google → upserts into the events
  // table → deletion sweep. The calendar UI re-fetches via its own
  // dateRange dep, so a sync that adds/removes rows surfaces in the
  // grid on the user's next interaction. No-op if Google Calendar
  // isn't connected.
  //
  // Cluster 24 v1.0.1 — permanent token failure detection. Google's
  // OAuth refresh tokens expire after 7 days for unverified test
  // apps, and can be revoked at any time from the user's Google
  // Account → "Third-party access" settings. Once revoked, every
  // 5-minute background sync would log the same error forever and
  // the user would never know. We now:
  //   - Detect "invalid_grant" / "expired" / "revoked" in the error
  //     string (token-refresh failures all surface that way).
  //   - Surface a visible banner via setError with a hint pointing
  //     the user at IntegrationsSettings so they can re-auth.
  //   - Stop the 5-minute interval so the console isn't spammed.
  //   - Keep polling for transient errors (network blips, 500s) —
  //     those resolve on their own.
  useEffect(() => {
    if (!vaultPath) return;
    let intervalHandle: number | null = null;
    let permanentlyFailed = false;
    const tick = () => {
      invoke("sync_google_calendar", { vaultPath }).catch((e) => {
        const msg = String(e);
        const isTokenFailure =
          msg.includes("invalid_grant") ||
          msg.includes("Token has been expired") ||
          msg.includes("revoked");
        if (isTokenFailure && !permanentlyFailed) {
          permanentlyFailed = true;
          console.warn("[google] refresh token expired or revoked:", e);
          setError(
            "Google Calendar connection expired. Open Integrations (GH button) to reconnect.",
          );
          if (intervalHandle != null) {
            window.clearInterval(intervalHandle);
            intervalHandle = null;
          }
        } else if (!isTokenFailure) {
          // Transient — keep retrying on the regular schedule, log
          // quietly so the console isn't noisy.
          console.warn("[google] background sync failed:", e);
        }
      });
    };
    // Run once on mount, then every 5 minutes.
    tick();
    intervalHandle = window.setInterval(tick, 5 * 60_000);
    return () => {
      if (intervalHandle != null) window.clearInterval(intervalHandle);
    };
  }, [vaultPath]);
  // Slot picker (used when a search-palette result needs routing in
  // multi-slot layouts).
  const [pendingSlotChoice, setPendingSlotChoice] = useState<{
    path: string;
  } | null>(null);

  // --- color legend ----------------------------------------------------
  const [legendVisible, setLegendVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cortex:legend-hidden") !== "true";
    } catch {
      return true;
    }
  });

  // --- focus-mode indicator (keymap signaling) -------------------------
  const [activeMode, setActiveMode] = useState<"editor" | "sidebar">("editor");

  // --- collapsible sidebar ---------------------------------------------
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
        // ignore
      }
      return next;
    });
  }

  // --- Cluster 27 v1.0 — Plotter sidebar state ---------------------------
  // Bound to whichever cortexPlot node was last clicked / focused.
  // Cleared when the user explicitly closes the sidebar.
  const [plotterBinding, setPlotterBinding] = useState<PlotterBinding | null>(
    null,
  );
  const [plotterSidebarWidth, setPlotterSidebarWidth] = useState<number>(() => {
    try {
      const v = parseInt(
        localStorage.getItem("cortex:plotter-sidebar-width") ?? "420",
        10,
      );
      if (Number.isFinite(v) && v >= 360 && v <= 640) return v;
    } catch {
      // ignore
    }
    return 420;
  });
  const persistPlotterSidebarWidth = useCallback((next: number) => {
    setPlotterSidebarWidth(next);
    try {
      localStorage.setItem("cortex:plotter-sidebar-width", String(next));
    } catch {
      // ignore
    }
  }, []);

  // --- Cluster 26 — draggable sidebar width ----------------------------
  // The sidebar's expanded width is now user-resizable via a vertical
  // drag handle on its right edge. Width persists in localStorage.
  // Min 240 (keeps the action button cluster legible); max 560 (avoids
  // squashing the main pane below useful proportions).
  const SIDEBAR_WIDTH_MIN = 240;
  const SIDEBAR_WIDTH_MAX = 560;
  const SIDEBAR_WIDTH_DEFAULT = 300;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const v = parseInt(
        localStorage.getItem("cortex:sidebar-width") ?? "",
        10,
      );
      if (
        Number.isFinite(v) &&
        v >= SIDEBAR_WIDTH_MIN &&
        v <= SIDEBAR_WIDTH_MAX
      ) {
        return v;
      }
    } catch {
      // localStorage may throw under privacy restrictions; fall through.
    }
    return SIDEBAR_WIDTH_DEFAULT;
  });
  const sidebarResizingRef = useRef<boolean>(false);
  function startSidebarResize(e: React.PointerEvent) {
    if (sidebarCollapsed) return;
    e.preventDefault();
    sidebarResizingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!sidebarResizingRef.current) return;
      const dx = ev.clientX - startX;
      const next = Math.max(
        SIDEBAR_WIDTH_MIN,
        Math.min(SIDEBAR_WIDTH_MAX, startW + dx),
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      sidebarResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // Persist the final width on release (not on every pointer
      // move; that would thrash localStorage).
      try {
        // Read current width from state at next tick (setSidebarWidth
        // is async). Easier: persist via setSidebarWidth callback.
        setSidebarWidth((w) => {
          try {
            localStorage.setItem("cortex:sidebar-width", String(w));
          } catch {
            // ignore
          }
          return w;
        });
      } catch {
        // ignore
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

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

  // Restore last-open file when vault resolves — into slot 0 of whatever
  // layout the user had on last close.
  useEffect(() => {
    if (!vaultPath) return;
    invoke<string | null>("load_last_open")
      .then((p) => {
        if (!p) return;
        // Pane refs may not be attached yet on the very first render;
        // guard and retry on the next animation frame. Cap attempts so
        // a missing pane doesn't lock the loop.
        let attempts = 0;
        const tryOpen = () => {
          attempts += 1;
          const handle = paneRefs.current[0];
          if (handle) {
            handle.openPath(p);
          } else if (attempts < 20) {
            requestAnimationFrame(tryOpen);
          } else {
            console.warn(
              "[cortex] gave up on last-open restore — slot 0 never mounted",
            );
          }
        };
        tryOpen();
      })
      .catch((e) => console.warn("load_last_open failed:", e));
  }, [vaultPath]);

  // Save the active slot's path as last-open whenever it changes.
  useEffect(() => {
    if (!vaultPath) return;
    invoke("save_last_open", {
      filePath: slotPaths[activeSlotIdx] ?? null,
    }).catch((e) => console.warn("save_last_open failed:", e));
  }, [slotPaths, activeSlotIdx, vaultPath]);

  // Build the search index when vault loads.
  useEffect(() => {
    if (!vaultPath) return;
    invoke<number>("rebuild_index", { vaultPath })
      .then((count) => {
        console.info(`Indexed ${count} notes`);
        setIndexVersion((v) => v + 1);
      })
      .catch((e) => console.warn("rebuild_index failed:", e));
  }, [vaultPath]);

  // Cluster 24 v1.0.1 — listen for `cortex:open-file` CustomEvents
  // dispatched by deeply-nested components (currently EventEditModal's
  // "Open review log" button) so they can request a file open in the
  // active pane without threading a callback prop through every parent.
  useEffect(() => {
    function onOpen(e: Event) {
      const ce = e as CustomEvent<{ path: string }>;
      const path = ce.detail?.path;
      if (typeof path === "string" && path.length > 0) {
        void selectFileInSlot(path, activeSlotIdx);
      }
    }
    document.addEventListener("cortex:open-file", onOpen);
    return () => document.removeEventListener("cortex:open-file", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotIdx, vaultPath]);

  // Cluster 27 v1.0 — Listen for cortex:focus-plot events bubbling
  // up from every TabPane's editor view.dom. The NodeView emits these
  // when the user clicks a plot; we bind the PlotterSidebar to the
  // clicked plot. The active slot's pane is the one we read attrs
  // through (updateAttrs walks the editor doc to find the cortexPlot
  // node at `pos` and patches it via a ProseMirror transaction).
  useEffect(() => {
    function onFocusPlot(e: Event) {
      const ce = e as CustomEvent<FocusPlotDetail>;
      const detail = ce.detail;
      if (!detail) return;
      const slotIdx = activeSlotIdxRef.current ?? activeSlotIdx;
      const pane = paneRefs.current[slotIdx];
      const notePath = pane?.getPath() ?? null;
      if (!vaultPath || !notePath) return;
      setPlotterBinding({
        vaultPath,
        notePath,
        plotId: detail.plotId,
        plotType: detail.plotType,
        width: detail.width,
        height: detail.height,
        configB64: detail.configB64,
        dataB64: detail.dataB64,
        updateAttrs: (patch) => {
          // Walk the pane's editor doc for a cortexPlot node whose
          // plotId matches, then dispatch a setNodeMarkup transaction.
          // The handle exposes the editor via a method we add below.
          const ed = pane?.getEditor?.();
          if (!ed) return;
          let targetPos: number | null = null;
          ed.state.doc.descendants((node, pos) => {
            if (
              node.type.name === "cortexPlot" &&
              node.attrs.plotId === detail.plotId
            ) {
              targetPos = pos;
              return false;
            }
            return true;
          });
          if (targetPos == null) return;
          const node = ed.state.doc.nodeAt(targetPos);
          if (!node) return;
          const nextAttrs = { ...node.attrs, ...patch };
          const tr = ed.state.tr.setNodeMarkup(targetPos, undefined, nextAttrs);
          ed.view.dispatch(tr);
        },
        warmDataCache: (data: PlotData) => {
          const ed = pane?.getEditor?.();
          if (!ed) return;
          const storage = ed.storage as Record<
            string,
            { dataCache?: Map<string, PlotData>; cacheVersion?: number }
          >;
          const slot = storage.cortexPlot;
          if (!slot) return;
          if (!slot.dataCache) slot.dataCache = new Map();
          slot.dataCache.set(detail.plotId, data);
          slot.cacheVersion = (slot.cacheVersion ?? 0) + 1;
        },
      });
    }
    document.addEventListener(FOCUS_PLOT_EVENT, onFocusPlot);
    return () => document.removeEventListener(FOCUS_PLOT_EVENT, onFocusPlot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotIdx, vaultPath]);

  // Cluster 24 v1.0.1 — Review schedule auto-init.
  //
  // Source of truth is the events table itself: call get_review_settings
  // first; if NEITHER weekly nor monthly currently exists, create both
  // (matches the "fresh vault" UX). If the user has explicitly disabled
  // one or both via the Reviews modal, at least one side will exist
  // (or both will be deliberately absent post-disable) and we won't
  // re-create.
  //
  // v1.0 used a localStorage gate, which silently kept reviews missing
  // when the v1.0 backend SQL bug caused the first-run auto-init to fail
  // (the localStorage flag was set before the .then handler verified
  // success — actually it WASN'T set on failure, but the localStorage
  // approach was fragile in other ways). v1.0.1 reads actual DB state
  // so a successful retry on next launch fixes itself.
  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    invoke<[boolean, boolean]>("get_review_settings", { vaultPath })
      .then(([weeklyExists, monthlyExists]) => {
        if (cancelled) return;
        if (weeklyExists || monthlyExists) {
          // User-managed state — leave it alone.
          return;
        }
        // Neither exists. Auto-init both ON (the spec's "fresh vault"
        // experience).
        return invoke("ensure_review_events", {
          vaultPath,
          weeklyEnabled: true,
          monthlyEnabled: true,
          tzOffsetMinutes: -new Date().getTimezoneOffset(),
        }).then(() => {
          if (cancelled) return;
          setIndexVersion((v) => v + 1);
        });
      })
      .catch((e) => {
        if (cancelled) return;
        // Surface to the user — silent failure is what made v1.0 hard
        // to debug.
        console.warn("Review-event auto-init failed:", e);
        setError(`Failed to set up review schedule: ${e}`);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  // -------------------------------------------------------------------------
  // Filesystem watcher
  // -------------------------------------------------------------------------
  const reindexTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!vaultPath) return;
    invoke("start_vault_watcher", { vaultPath }).catch((e) =>
      console.warn("start_vault_watcher failed:", e),
    );
    const unlistenPromise = listen("vault-changed", () => {
      setRefreshKey((k) => k + 1);
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
  // Open a file in a target slot. This is the multi-slot replacement
  // for the old single-pane `selectFile`. Cross-cutting regen
  // (persistent destinations, method reagents, daily-log reading
  // populator) runs once per open-call before we delegate to the
  // pane's openPath.
  //
  // Routing rules for the `slotIndex` parameter:
  //   - explicit number → use that slot
  //   - undefined + single layout → slot 0
  //   - undefined + dual + ctrlOnClick === true → slot 1
  //   - undefined + dual + ctrlOnClick === false → slot 0
  //   - undefined + tri/quad → return false (caller should ask the user)
  //
  // The "open in active slot" default is reserved for in-pane events
  // (backlinks, related, queue/log views).
  // -------------------------------------------------------------------------
  async function selectFileInSlot(
    path: string | null,
    slotIndex: number,
  ): Promise<void> {
    // PDF: skip persistent-regen / methods-regen / daily-log paths.
    // (PDFs aren't markdown, so none of those passes apply.)

    if (
      path &&
      vaultPath &&
      !/\.(pdf|jpg|jpeg|png|gif|webp|svg)$/i.test(path)
    ) {
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
        // Cluster 10 — GitHub auto-section. The Rust side is
        // gated to today's daily note only and to a populated
        // config; past daily notes and unconfigured users are
        // no-ops by design. tzOffsetMinutes makes the "today"
        // boundary AND the GitHub /commits ?since= window use
        // the user's local day rather than UTC.
        try {
          await invoke("regenerate_github_section", {
            vaultPath,
            filePath: path,
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
          });
        } catch (e) {
          console.warn("regenerate_github_section failed:", e);
        }
        // Cluster 11 — Calendar auto-section. Same today-only gate
        // as GitHub. No-op when no events exist for today (renders
        // an italic "(no events scheduled)" placeholder).
        // tzOffsetMinutes is signed minutes east of UTC; the Rust
        // side uses it to compute the local-day window and to
        // render HH:MM in local time (v1.2 fix).
        try {
          await invoke("regenerate_calendar_section", {
            vaultPath,
            filePath: path,
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
          });
        } catch (e) {
          console.warn("regenerate_calendar_section failed:", e);
        }
        // Cluster 14 v1.4 — Time-tracking auto-section. Same today-only
        // gate as Calendar/GitHub. Renders yesterday's per-category
        // planned/actual table; "(no events recorded yesterday)" when
        // empty. Compose-after-Calendar order so the time summary sits
        // below today's calendar in the rendered note.
        try {
          await invoke("regenerate_time_tracking_section", {
            vaultPath,
            filePath: path,
            tzOffsetMinutes: -new Date().getTimezoneOffset(),
          });
        } catch (e) {
          console.warn("regenerate_time_tracking_section failed:", e);
        }
      }
    }

    const handle = paneRefs.current[slotIndex];
    if (!handle) {
      console.warn(`[cortex] slot ${slotIndex} not mounted yet`);
      return;
    }
    await handle.openPath(path);
    activatePane(slotIndex);
  }

  /**
   * File-tree click router.
   *   - Plain click → currently active slot (the one the user last
   *     clicked into / focused).
   *   - Ctrl/Cmd+Click → next slot in slot order, wrapping. In dual
   *     this gives the "open in the other tab" behaviour the user
   *     asked for; in tri/quad it cycles, which is a useful
   *     keyboardless way to fan out a paper / note across slots.
   *   - Drag-and-drop on a specific slot remains the explicit
   *     "open here" affordance.
   *
   * Read activeSlotIdxRef.current (not the state) so the routing
   * uses the freshest active index even if the click fires before
   * React has committed the activate state update.
   */
  function handleTreeClick(path: string, ctrlClick: boolean) {
    if (slotCount === 1) {
      selectFileInSlot(path, 0);
      return;
    }
    const active = Math.min(activeSlotIdxRef.current, slotCount - 1);
    const target = ctrlClick ? (active + 1) % slotCount : active;
    selectFileInSlot(path, target);
  }

  /** Handler for the ReviewsMenu — routes destinations to a queue view
   *  (in the active slot) or a regenerated persistent file (also in the
   *  active slot). */
  async function pickDestination(choice: DestinationChoice) {
    if (!vaultPath) return;
    if (choice.kind === "queue") {
      const handle = paneRefs.current[activeSlotIdx];
      if (handle) {
        handle.setActiveView(
          choice.queueKind === "yellow" ? "queue-yellow" : "queue-green",
        );
      }
      return;
    }
    try {
      const path = await invoke<string>("ensure_persistent_file", {
        vaultPath,
        kind: choice.persistentKind,
      });
      await selectFileInSlot(path, activeSlotIdx);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("ensure_persistent_file failed:", e);
      setError(`Could not open destination: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // Daily log (Ctrl+D) — opens in the active slot.
  // -------------------------------------------------------------------------
  async function openTodayDailyLog() {
    if (!vaultPath) return;
    const today = todayLocal();
    try {
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
        useTemplate: readTemplatesEnabled(),
      });
      await selectFileInSlot(path, activeSlotIdx);
      setRefreshKey((k) => k + 1);

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
  // Wikilinks — opens target file in the active slot (the pane that
  // initiated the click).
  // -------------------------------------------------------------------------
  // Cluster 17 v1.1 — Ctrl/Cmd+Click on a typedBlock title bar.
  // Resolves the (blockType, name, iterNumber) tuple to a file path
  // via the resolve_typed_block_target Tauri command and opens it in
  // the active slot. Soft-fails with an error banner when nothing
  // matches (e.g. user typed a block name that doesn't correspond to
  // any experiment / idea / method / protocol on disk).
  async function openTypedBlockInActive(attrs: {
    blockType: "experiment" | "protocol" | "idea" | "method";
    name: string;
    iterNumber: number | null;
  }) {
    if (!vaultPath) return;
    try {
      const path = await invoke<string>("resolve_typed_block_target", {
        vaultPath,
        blockType: attrs.blockType,
        name: attrs.name,
        iterNumber: attrs.iterNumber ?? null,
      });
      if (path) {
        await selectFileInSlot(path, activeSlotIdx);
      }
    } catch (e) {
      setError(`Couldn't open ${attrs.blockType} \"${attrs.name}\": ${e}`);
    }
  }

  async function openWikilinkInActive(target: string) {
    if (!vaultPath) return;
    try {
      // Cluster 24 v1.0.1 — review-log routing.
      // Detect basename pattern "YYYY-MM-DD (Weekly|Monthly) Review" and
      // route through ensure_review_log_file so the file lands in the
      // dedicated Reviews/Weekly/ or Reviews/Monthly/ subfolder with
      // the review-log template, instead of going through the generic
      // "create at vault root?" prompt below. Idempotent — if the file
      // already exists, the command just returns its path.
      const reviewMatch = /^(\d{4}-\d{2}-\d{2}) (Weekly|Monthly) Review$/.exec(
        target.trim(),
      );
      if (reviewMatch) {
        try {
          const path = await invoke<string>("ensure_review_log_file", {
            vaultPath,
            kind: reviewMatch[2],
            dateIso: reviewMatch[1],
          });
          await selectFileInSlot(path, activeSlotIdx);
          // Bump indexVersion so search / backlinks / file tree pick up
          // the new file immediately on first click.
          setIndexVersion((v) => v + 1);
          setRefreshKey((k) => k + 1);
          return;
        } catch (e) {
          console.warn("ensure_review_log_file failed:", e);
          // Fall through to the generic resolver — at worst the user
          // sees the standard "create at vault root?" prompt.
        }
      }

      const all = await invoke<NoteListItem[]>("list_all_notes", {
        vaultPath,
      });

      const sep = vaultPath.includes("\\") ? "\\" : "/";
      const targetLower = target.toLowerCase();
      const fileMatch = all.find((n) => {
        const base = n.path.split(sep).pop() ?? n.path;
        const stem = base.endsWith(".md") ? base.slice(0, -3) : base;
        return stem.toLowerCase() === targetLower;
      });
      if (fileMatch) {
        await selectFileInSlot(fileMatch.path, activeSlotIdx);
        return;
      }

      const titleMatch = all.find((n) => n.title.toLowerCase() === targetLower);
      if (titleMatch) {
        await selectFileInSlot(titleMatch.path, activeSlotIdx);
        return;
      }

      const ok = await confirm(
        `No note titled "${target}" exists. Create one in the vault root?`,
        { title: "Create note?", kind: "info" },
      );
      if (!ok) return;

      const safeName = target
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
      if (safeName.length === 0) {
        setError(`"${target}" is not a valid filename.`);
        return;
      }
      const newPath = `${vaultPath}${sep}${safeName}.md`;

      const existsAlready = await invoke<string | null>("read_markdown_file", {
        path: newPath,
      }).then(
        () => true,
        () => false,
      );
      if (existsAlready) {
        await selectFileInSlot(newPath, activeSlotIdx);
        return;
      }

      const today = todayLocal();
      const idSlug = target
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
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
      await selectFileInSlot(newPath, activeSlotIdx);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("openWikilink failed:", e);
      setError(`Could not follow link: ${e}`);
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle) handle.saveIfDirty();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        // Ctrl+R: reload only the active slot's open file from disk.
        // Browsers normally use this to reload the whole page; we
        // intercept so the user can refresh just one pane.
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle) handle.reload();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        openTodayDailyLog();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        // PDF reader's Ctrl+K is in-pane search — only suppress if the
        // ACTIVE slot is a pdf-reader.
        if (slotViews[activeSlotIdx] === "pdf-reader") return;
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
            // ignore
          }
          return next;
        });
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === "n" || e.key === "N") &&
        !isAnyEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("note");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "P" || e.key === "p") &&
        !isAnyEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("project");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "E" || e.key === "e") &&
        !isAnyEditorFocused()
      ) {
        e.preventDefault();
        setHierarchyKind("experiment");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "I" || e.key === "i") &&
        !isAnyEditorFocused()
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
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "G" || e.key === "g")
      ) {
        // Cluster 10 — slash-command equivalent. Fetch a fresh
        // GitHub summary and insert it at the cursor in the active
        // pane. Mirrors Ctrl+Shift+B (insert experiment block).
        e.preventDefault();
        (async () => {
          try {
            const summary = await invoke<{
              markdown: string;
              last_fetch_iso: string;
              error: string;
            }>("fetch_github_summary", {
              tzOffsetMinutes: -new Date().getTimezoneOffset(),
            });
            const handle = paneRefs.current[activeSlotIdx];
            if (handle) {
              handle.insertGitHubMarkdown(summary.markdown);
            }
          } catch (err) {
            console.warn("[cortex] fetch_github_summary failed:", err);
            setError(`GitHub fetch failed: ${err}`);
          }
        })();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === ",") {
        // Cluster 10 — open Integrations settings modal.
        e.preventDefault();
        setIntegrationsOpen(true);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "C" || e.key === "c")
      ) {
        // Cluster 11 — switch the active slot to the Calendar view.
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle) handle.setActiveView("calendar");
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "M" || e.key === "m")
      ) {
        // Cluster 15 — open the Reminders overlay (modal, not a slot).
        e.preventDefault();
        setReminderOverlayOpen(true);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "O" || e.key === "o")
      ) {
        // Cluster 19 v1.2 — open the Orphan attachments GC modal.
        e.preventDefault();
        setOrphanModalOpen(true);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "W" || e.key === "w")
      ) {
        // Cluster 16 — wikilink shortcut. With editor focus + a
        // non-empty selection, wrap the selection with [[...]] in
        // place. Otherwise open the command palette in pick-mode so
        // the user can choose a note to wikilink to.
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        const wrapped = handle?.wrapSelectionInWikilink?.() ?? false;
        if (!wrapped) {
          setWikilinkPickMode(true);
          setPaletteOpen(true);
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "I" || e.key === "i")
      ) {
        // Cluster 19 v1.0 — open OS file picker for image files,
        // import the chosen one into the active note's
        // <basename>-attachments/ dir, and insert a cortexImage at
        // the cursor. No-op if the active slot has no md open.
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle?.insertImageDialog) {
          handle.insertImageDialog().then((ok) => {
            if (!ok) {
              // Soft hint — likely no md open in the active slot.
              console.info(
                "[cortex] Insert image: open a markdown note first.",
              );
            }
          });
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        (e.key === "P" || e.key === "p")
      ) {
        // Cluster 27 v1.0 — insert a fresh cortexPlot at the cursor in
        // the active slot, then open the PlotterSidebar bound to it.
        // No-op if the active slot has no md open (the pane handle's
        // method silently bails).
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle?.insertPlot) {
          handle.insertPlot().catch((err: unknown) => {
            console.warn("[cortex] insertPlot failed:", err);
          });
        } else {
          console.info("[cortex] Insert plot: open a markdown note first.");
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === "D" || e.key === "d")
      ) {
        // Cluster 20 v1.0 — toggle Shape Editor mode on the active
        // slot. The pane's `toggleShapeEditor` no-ops when the open
        // file isn't a markdown note (PDFs / images / structured
        // views) — `Ctrl+Shift+D` is a global shortcut, but it only
        // does anything when the active pane is on a markdown note
        // in the editor view.
        e.preventDefault();
        const handle = paneRefs.current[activeSlotIdx];
        if (handle?.toggleShapeEditor) {
          handle.toggleShapeEditor().catch((err) => {
            console.warn("[cortex] toggleShapeEditor failed:", err);
          });
        }
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setHierarchyKind(null);
        setTableModalOpen(false);
        setIntegrationsOpen(false);
        setReminderOverlayOpen(false);
        setWikilinkPickMode(false);
        setPendingSlotChoice(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotIdx, slotViews, vaultPath]);

  // Save dirty work across ALL panes before the window closes.
  const closingRef = useRef(false);
  useEffect(() => {
    const win = getCurrentWindow();
    console.info("[cortex] registering close handler");
    const unlistenPromise = win.onCloseRequested((event) => {
      if (closingRef.current) {
        console.info("[cortex] second pass — letting close proceed");
        return;
      }

      // Collect dirty snapshots from every mounted pane.
      const snapshots: {
        selectedPath: string | null;
        frontmatter: Record<string, unknown>;
        editedBody: string;
      }[] = [];
      for (const handle of paneRefs.current) {
        if (!handle) continue;
        if (!handle.getDirty()) continue;
        snapshots.push(handle.getDirtySnapshot());
      }

      if (snapshots.length === 0) {
        console.info("[cortex] no dirty panes — close proceeds");
        return;
      }

      console.info(
        `[cortex] ${snapshots.length} dirty panes — preventDefault, saving, then closing`,
      );
      event.preventDefault();
      (async () => {
        for (const s of snapshots) {
          if (!s.selectedPath) continue;
          try {
            const raw = serializeFrontmatter(s.frontmatter, s.editedBody);
            await invoke("write_markdown_file", {
              path: s.selectedPath,
              content: raw,
            });
            console.info(`[cortex] save done: ${s.selectedPath}`);
          } catch (e) {
            console.warn(
              `[cortex] save before close failed for ${s.selectedPath}:`,
              e,
            );
          }
        }
        closingRef.current = true;
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

  // Save dirty work across all panes when the window blurs / hides.
  useEffect(() => {
    let unlistenFocus: (() => void) | null = null;

    const trySaveAll = () => {
      for (const handle of paneRefs.current) {
        if (!handle) continue;
        if (!handle.getDirty()) continue;
        const s = handle.getDirtySnapshot();
        if (!s.selectedPath) continue;
        const raw = serializeFrontmatter(s.frontmatter, s.editedBody);
        invoke("write_markdown_file", {
          path: s.selectedPath,
          content: raw,
        }).catch((e) => console.warn("[cortex] focus-save failed:", e));
      }
    };

    const onVisibility = () => {
      if (document.hidden) trySaveAll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const win = getCurrentWindow();
    win
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) trySaveAll();
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

  // Track which keymap is live (sidebar vs editor) for the visual banner.
  // Cluster 21 v1.0.5 — clicks inside the universal EditorToolbar
  // count as "editor" context, not "sidebar". Without this exemption,
  // every toolbar click flips activeMode → "sidebar" because the
  // toolbar buttons aren't inside .ProseMirror, breaking the user's
  // mental model (they're still editing the doc, just via the
  // toolbar). Same exemption for any popover the toolbar opens
  // (.cortex-tb-popover) and the find/replace bar.
  useEffect(() => {
    const updateFromEvent = (e: Event) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== "function") {
        setActiveMode(isAnyEditorFocused() ? "editor" : "sidebar");
        return;
      }
      const inEditor = !!t.closest(".ProseMirror");
      const inToolbar =
        !!t.closest(".cortex-editor-toolbar") ||
        !!t.closest(".cortex-tb-popover") ||
        !!t.closest(".cortex-find-replace-bar");
      if (inEditor || inToolbar) {
        setActiveMode("editor");
      } else {
        setActiveMode(isAnyEditorFocused() ? "editor" : "sidebar");
      }
    };
    document.addEventListener("focusin", updateFromEvent);
    document.addEventListener("mousedown", updateFromEvent);
    setActiveMode(isAnyEditorFocused() ? "editor" : "sidebar");
    return () => {
      document.removeEventListener("focusin", updateFromEvent);
      document.removeEventListener("mousedown", updateFromEvent);
    };
  }, []);

  // Toggle a body class while Ctrl/Meta is held — used by index.css.
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
    // Save any dirty panes before swapping vaults.
    for (const handle of paneRefs.current) {
      if (handle && handle.getDirty()) await handle.saveIfDirty();
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose your Cortex vault folder",
      });
      if (typeof selected === "string") {
        await invoke("save_vault_config", { vaultPath: selected });
        setVaultPath(selected);
        // Clear panes — old paths point at the previous vault.
        for (const handle of paneRefs.current) {
          if (handle) await handle.openPath(null);
        }
      }
    } catch (err) {
      console.error("pickVault failed:", err);
      setError(String(err));
    }
  }

  // -------------------------------------------------------------------------
  // Cluster 24 v1.0 — FileTree right-click handlers (create / rename / delete)
  // -------------------------------------------------------------------------

  /** Recursively count .md and .pdf files inside a folder node — used by
   *  the delete-confirm modal so the user knows how much they'll lose. */
  function countFilesInNode(node: FileNode): number {
    if (node.type === "file") return 1;
    let total = 0;
    for (const c of node.children) total += countFilesInNode(c);
    return total;
  }

  function dispatchFileTreeAction(node: FileNode, kind: FileTreeAction) {
    if (kind === "newFile") {
      if (node.type !== "folder") return;
      setPendingEdit({ kind: "new-file", parentPath: node.path, draft: "" });
    } else if (kind === "newFolder") {
      if (node.type !== "folder") return;
      setPendingEdit({ kind: "new-folder", parentPath: node.path, draft: "" });
    } else if (kind === "rename") {
      setPendingEdit({
        kind: "rename",
        targetPath: node.path,
        nodeType: node.type,
        draft: node.name,
      });
    } else if (kind === "delete") {
      setDeleteConfirm({
        path: node.path,
        name: node.name,
        nodeType: node.type,
        containedFileCount:
          node.type === "folder" ? countFilesInNode(node) : undefined,
      });
    }
  }

  async function commitFileTreeEdit(edit: PendingEdit) {
    if (!vaultPath) return;
    const draft = edit.draft.trim();
    if (!draft) {
      setPendingEdit(null);
      return;
    }
    try {
      if (edit.kind === "rename") {
        // Save any dirty panes that reference the renamed path before the
        // rename so we don't write to a path that's about to disappear.
        for (const handle of paneRefs.current) {
          if (
            handle &&
            handle.getPath() === edit.targetPath &&
            handle.getDirty()
          ) {
            await handle.saveIfDirty();
          }
        }
        const newPath = await invoke<string>("rename_path", {
          vaultPath,
          oldPath: edit.targetPath,
          newName: draft,
          updateWikilinks: true,
        });
        // Re-aim any pane currently showing the renamed file to the new
        // path. For a folder rename, files inside changed paths too —
        // we walk paneRefs and check whether each pane's path is under
        // the renamed folder, then swap the prefix.
        for (let i = 0; i < paneRefs.current.length; i++) {
          const handle = paneRefs.current[i];
          if (!handle) continue;
          const cur = handle.getPath();
          if (!cur) continue;
          if (cur === edit.targetPath) {
            await handle.openPath(newPath);
          } else if (
            edit.nodeType === "folder" &&
            cur.startsWith(edit.targetPath + "\\")
          ) {
            const rel = cur.slice(edit.targetPath.length);
            await handle.openPath(newPath + rel);
          } else if (
            edit.nodeType === "folder" &&
            cur.startsWith(edit.targetPath + "/")
          ) {
            const rel = cur.slice(edit.targetPath.length);
            await handle.openPath(newPath + rel);
          }
        }
      } else if (edit.kind === "new-file") {
        await invoke<string>("create_file_in_folder", {
          vaultPath,
          parentDir: edit.parentPath,
          name: draft,
        });
      } else if (edit.kind === "new-folder") {
        await invoke<string>("create_folder_in_folder", {
          vaultPath,
          parentDir: edit.parentPath,
          name: draft,
        });
      }
      setPendingEdit(null);
      setRefreshKey((k) => k + 1);
      setIndexVersion((v) => v + 1);
    } catch (e) {
      console.error("FileTree op failed:", e);
      setError(String(e));
      setPendingEdit(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm || !vaultPath) return;
    const target = deleteConfirm;
    try {
      // Close any pane currently showing the deleted path or anything
      // beneath it (folder delete).
      for (const handle of paneRefs.current) {
        if (!handle) continue;
        const cur = handle.getPath();
        if (!cur) continue;
        const matches =
          cur === target.path ||
          (target.nodeType === "folder" &&
            (cur.startsWith(target.path + "\\") ||
              cur.startsWith(target.path + "/")));
        if (matches) {
          await handle.openPath(null);
        }
      }
      await invoke("trash_path", {
        vaultPath,
        path: target.path,
      });
      setDeleteConfirm(null);
      setRefreshKey((k) => k + 1);
      setIndexVersion((v) => v + 1);
    } catch (e) {
      console.error("trash_path failed:", e);
      setError(String(e));
      setDeleteConfirm(null);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  // Cluster 26 — the Cerebrum splash overlays every render branch (loading,
  // welcome, main app) at z-index: 1. It holds for SPLASH_MIN_MS minimum
  // and then fades. Each early-return wraps its content in a fragment
  // alongside the splash so the splash element is always present in the
  // tree until splashVisible flips false.
  if (loading) {
    return <CerebrumSplash visible={splashVisible} />;
  }

  if (!vaultPath) {
    return (
      <>
        <CerebrumSplash visible={splashVisible} />
        <main style={baseStyles.shell}>
          <div className="cortex-welcome-card" style={baseStyles.welcomeCard}>
            {/* Cluster 26 — brand mark + wordmark above the heading.
             *  Reads as a brand badge that anchors the card visually
             *  before the user even reads the copy. */}
            <div className="cortex-welcome-brand">
              <img
                src="/cortex-mark.svg"
                alt=""
                className="cortex-welcome-mark"
              />
              <img
                src="/cortex-wordmark.svg"
                alt="Cortex"
                className="cortex-welcome-wordmark"
              />
            </div>
            <h1 style={baseStyles.h1}>Welcome to Cortex</h1>
            <p style={baseStyles.lead}>
              Cortex is your research notebook. Pick a folder on disk to be your{" "}
              <em>vault</em> — every note, experiment, and concept will live
              there as a markdown file you fully own.
            </p>
            <p style={baseStyles.hint}>
              Tip: avoid OneDrive or other syncing folders. A plain local folder
              (e.g., <code>C:\Cortex</code>) is best.
            </p>
            <button onClick={pickVault} style={baseStyles.primaryBtn}>
              Choose vault folder
            </button>
            <div className="cortex-welcome-shortcuts">
              Ctrl+K to search · Ctrl+/ for shortcuts
            </div>
            {error && (
              <p style={baseStyles.errorText}>Could not open picker: {error}</p>
            )}
          </div>
        </main>
      </>
    );
  }

  // The active slot's view drives whether the sidebar accent banner shows.
  const activeView = slotViews[activeSlotIdx];

  // Render ALL MAX_SLOTS pane components every time, regardless of
  // layout. Visible ones go into the LayoutGrid; the rest are kept
  // mounted in a hidden div so their state, refs, and pending saves
  // survive layout swaps. This is what makes the close handler safe
  // even after a quad → single shrink: paneRefs are still populated
  // for every dirty pane.
  const panes: React.ReactNode[] = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    panes.push(
      <PaneWrapper
        key={i}
        slotIndex={i}
        onDropPath={(path) => selectFileInSlot(path, i)}
        onDropImage={async (sourceAbsolutePath, x, y) => {
          // Cluster 19 v1.0 — drop image cortex-path into editor area
          // → import + insert at drop position. If the slot has no md
          // open OR the drop didn't land in an editor, fall back to
          // opening the image as a tab.
          const handle = paneRefs.current[i];
          if (!handle) return;
          const ok = await handle.insertImageFromPath(sourceAbsolutePath, x, y);
          if (!ok) {
            await selectFileInSlot(sourceAbsolutePath, i);
          }
        }}
      >
        <TabPane
          ref={(h) => {
            paneRefs.current[i] = h;
          }}
          slotIndex={i}
          vaultPath={vaultPath}
          indexVersion={indexVersion}
          isActive={activeSlotIdx === i || slotCount === 1}
          multiSlot={slotCount > 1}
          bumpIndex={() => setIndexVersion((v) => v + 1)}
          setError={(msg) => setError(msg)}
          onActivate={() => activatePane(i)}
          onPathChange={(p) =>
            setSlotPaths((prev) => {
              const next = prev.slice();
              next[i] = p;
              return next;
            })
          }
          onActiveViewChange={(v) =>
            setSlotViews((prev) => {
              const next = prev.slice();
              next[i] = v;
              return next;
            })
          }
          onDirtyChange={(d) =>
            setSlotDirty((prev) => {
              const next = prev.slice();
              next[i] = d;
              return next;
            })
          }
          onFollowWikilink={(target) => {
            // Wikilink originated from this pane → make it active and
            // resolve from there.
            activatePane(i);
            openWikilinkInActive(target);
          }}
          onFollowTypedBlock={(attrs) => {
            // Cluster 17 v1.1 — Ctrl/Cmd+Click on a typedBlock title.
            // Same activation pattern as wikilink follow.
            activatePane(i);
            openTypedBlockInActive(attrs);
          }}
          onRequestInsertTable={() => {
            activatePane(i);
            setTableModalOpen(true);
          }}
          onOpenFileInPane={async (path, slotIndex) => {
            await selectFileInSlot(path, slotIndex);
          }}
          onEditorChange={(editor) => setPaneEditorAt(i, editor)}
          particlesPaused={
            toolbarPrefs.pauseAnimations || toolbarPrefs.reduceMotion
          }
        />
      </PaneWrapper>,
    );
  }

  // The set of paths we want highlighted in the file tree (any slot
  // showing a file). Pass the active one as the primary.
  const treeHighlight = slotPaths[activeSlotIdx] ?? null;

  // Cluster 26 — set of paths that are dirty in any slot. FileTree reads
  // this to render the gradient dirty dot on the right edge of each
  // matching row. Recomputed every render — cheap (≤ MAX_SLOTS entries).
  const dirtyPaths = (() => {
    const set = new Set<string>();
    for (let i = 0; i < MAX_SLOTS; i++) {
      const p = slotPaths[i];
      if (p && slotDirty[i]) set.add(p);
    }
    return set;
  })();

  return (
    <>
      {/* Cluster 26 — splash overlays the chrome on cold launch until the
          SPLASH_MIN_MS floor elapses + the vault has been loaded. After
          that, the splash fades and unmounts, revealing the main app. */}
      <CerebrumSplash visible={splashVisible} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          width: "100%",
        }}
      >
        {/* Cluster 21 v1.0.2 — single universal Editor Toolbar pinned
          flush to the very top of the app, above the document area
          and the sidebar. Operates on the currently-active pane's
          editor. Stays visible in reading mode (so the user can
          always toggle it back off) and can be collapsed to a thin
          bar via its own polish-group toggle. */}
        <EditorToolbar
          editor={paneEditors[activeSlotIdx] ?? null}
          notePath={slotPaths[activeSlotIdx] ?? null}
          prefs={toolbarPrefs}
          onPrefsChange={handleToolbarPrefsChange}
          rescanKey={0}
          onOpenBlockModal={() => {
            // Cluster 21 v1.0.4 — open the existing ExperimentBlockModal
            // (the same one Ctrl+Shift+B opens). The modal handles
            // type / name / iteration entry and inserts the typed
            // block at the cursor via paneRefs.insertExperimentBlock.
            // The preselectType arg is currently ignored by the
            // modal; v1.1 may wire it through.
            setBlockModalOpen(true);
          }}
          onInsertWikilink={() => {
            const handle = paneRefs.current[activeSlotIdx];
            const wrapped = handle?.wrapSelectionInWikilink?.() ?? false;
            if (!wrapped) {
              setWikilinkPickMode(true);
              setPaletteOpen(true);
            }
          }}
          onInsertPlot={() => {
            // Cluster 27 v1.0 — toolbar entry point. Same pathway as the
            // Ctrl+Alt+P shortcut: insert a fresh cortexPlot atom node
            // at the active pane's cursor. The PlotterSidebar opens
            // when the user clicks the inserted plot.
            const handle = paneRefs.current[activeSlotIdx];
            handle?.insertPlot?.().catch((err: unknown) => {
              console.warn("[cortex] insertPlot failed:", err);
            });
          }}
        />
        <div style={baseStyles.appShell} className="cortex-app-shell">
          <aside
            className="cortex-sidebar"
            style={{
              ...baseStyles.sidebar,
              width: sidebarCollapsed ? "32px" : `${sidebarWidth}px`,
              minWidth: sidebarCollapsed ? "32px" : `${SIDEBAR_WIDTH_MIN}px`,
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
                <header
                  className="cortex-sb-head"
                  style={baseStyles.sidebarHeader}
                >
                  {/* Cluster 26 — brand badge: animated brain mark +
                   *  wordmark side by side. Sized to fill the sidebar
                   *  width. The brand mark carries a slow pulse +
                   *  rotation animation matching the splash family. */}
                  <div className="cortex-sb-brand">
                    <button
                      onClick={toggleSidebar}
                      className="cortex-sb-collapse"
                      style={baseStyles.sidebarToggleBtn}
                      title="Collapse sidebar"
                      aria-label="Collapse sidebar"
                    >
                      ◀
                    </button>
                    {/* Cluster 26 — just the brain mark. No rectangular
                     *  frame, no aurora window, no drop-shadow halo —
                     *  the white brain stands on its own against the
                     *  sidebar's translucent glass. */}
                    <img
                      src="/cortex-mark.svg"
                      alt=""
                      className="cortex-sb-brand-mark"
                      aria-hidden="true"
                    />
                    <img
                      src="/cortex-wordmark.svg"
                      alt="Cortex"
                      className="cortex-sb-wordmark"
                    />
                  </div>
                  <div
                    className="cortex-sb-actions"
                    style={baseStyles.sidebarActions}
                  >
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
                      onClick={() => {
                        const handle = paneRefs.current[activeSlotIdx];
                        if (handle) handle.setActiveView("idea-log");
                      }}
                      style={baseStyles.changeBtn}
                      title="Open Idea Log (active slot)"
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
                      onClick={() => {
                        const handle = paneRefs.current[activeSlotIdx];
                        if (handle) handle.setActiveView("methods-arsenal");
                      }}
                      style={baseStyles.changeBtn}
                      title="Open Methods Arsenal (active slot)"
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
                      onClick={() => {
                        const handle = paneRefs.current[activeSlotIdx];
                        if (handle) handle.setActiveView("protocols-log");
                      }}
                      style={baseStyles.changeBtn}
                      title="Open Protocols Log (active slot)"
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
                      onClick={() => {
                        const handle = paneRefs.current[activeSlotIdx];
                        if (handle) handle.setActiveView("calendar");
                      }}
                      style={baseStyles.changeBtn}
                      title="Open calendar"
                    >
                      Cal
                    </button>
                    <button
                      onClick={() => {
                        const handle = paneRefs.current[activeSlotIdx];
                        if (handle) handle.setActiveView("time-tracking");
                      }}
                      style={baseStyles.changeBtn}
                      title="Time tracking — planned vs actual"
                    >
                      ⏱ Time
                    </button>
                    <button
                      onClick={() => setIntegrationsOpen(true)}
                      style={baseStyles.changeBtn}
                      title="Integrations settings (Ctrl+,)"
                    >
                      GH
                    </button>
                    <button
                      onClick={() => setTemplatesModalOpen(true)}
                      style={baseStyles.changeBtn}
                      title="Document templates — edit per-type defaults"
                    >
                      Templates
                    </button>
                    <button
                      onClick={() => setReviewSettingsOpen(true)}
                      style={baseStyles.changeBtn}
                      title="Review schedule — weekly + monthly all-day events"
                    >
                      Reviews
                    </button>
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
                  <div style={baseStyles.sidebarPath} title={vaultPath}>
                    {vaultPath}
                  </div>
                </header>
                <div className="cortex-sb-body" style={baseStyles.sidebarBody}>
                  <FileTree
                    vaultPath={vaultPath}
                    onSelectFile={(p, opts) =>
                      handleTreeClick(p, !!opts?.ctrlClick)
                    }
                    selectedPath={treeHighlight}
                    refreshKey={refreshKey}
                    onContextMenu={(e, node) => {
                      setFileTreeMenu({
                        x: e.clientX,
                        y: e.clientY,
                        node,
                      });
                    }}
                    pendingEdit={pendingEdit}
                    onPendingEditChange={setPendingEdit}
                    onCommitEdit={commitFileTreeEdit}
                    dirtyPaths={dirtyPaths}
                  />
                </div>
                <footer
                  className="cortex-sb-foot"
                  style={baseStyles.sidebarFooter}
                >
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
                {/* Cluster 26 — sidebar resize handle. A thin vertical
                 *  strip on the sidebar's right edge that captures
                 *  pointer-down and tracks the drag to update
                 *  sidebarWidth. Only rendered when the sidebar is not
                 *  collapsed (collapsed state has its own fixed width).
                 *  The handle is wider than its visible line (8 px hit
                 *  area, 1 px visible line via ::after) so it's easy to
                 *  grab without being obtrusive. */}
                <div
                  className="cortex-sidebar-resize"
                  onPointerDown={startSidebarResize}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize sidebar"
                  title="Drag to resize sidebar"
                />
              </>
            )}
          </aside>

          {/* Main pane area: top bar with layout picker, then layout grid. */}
          <div className="cortex-main-col" style={baseStyles.mainCol}>
            <div className="cortex-main-topbar" style={baseStyles.mainTopBar}>
              <div style={{ flex: 1 }} />
              <span style={baseStyles.activeSlotLabel}>
                {slotCount > 1 ? `Active: slot ${activeSlotIdx + 1}` : ""}
              </span>
              <NotificationBell
                vaultPath={vaultPath}
                refreshTick={reminderRefreshTick}
              />
              <LayoutPicker mode={layoutMode} onChange={setLayoutMode} />
            </div>

            <div style={baseStyles.gridArea}>
              <LayoutGrid
                mode={layoutMode}
                colFrac={colFrac}
                rowFrac={rowFrac}
                onColFracChange={setColFrac}
                onRowFracChange={setRowFrac}
              >
                {panes.slice(0, slotCount)}
              </LayoutGrid>
              {/* Hidden mount-keeper: panes beyond the current layout's
              slot count stay mounted here so their state survives a
              layout shrink (and the close handler still sees dirty
              work in any pane). */}
              <div style={baseStyles.hiddenPaneStash} aria-hidden="true">
                {panes.slice(slotCount)}
              </div>
            </div>

            {error && (
              <div style={baseStyles.errorBanner}>
                <p style={baseStyles.errorText}>
                  {error}
                  <button
                    onClick={() => setError(null)}
                    style={{ ...baseStyles.changeBtn, marginLeft: "0.75rem" }}
                  >
                    dismiss
                  </button>
                </p>
              </div>
            )}
          </div>

          <CommandPalette
            vaultPath={vaultPath}
            isOpen={paletteOpen}
            onClose={() => {
              setPaletteOpen(false);
              // Always clear wikilink pick-mode when the palette closes,
              // so a subsequent plain Ctrl+K isn't accidentally still in
              // pick-mode.
              setWikilinkPickMode(false);
            }}
            onOpenFile={(p) => {
              setPaletteOpen(false);
              // Multi-slot: ask the user which slot to open in. Single
              // slot: just route directly.
              if (slotCount > 1) {
                setPendingSlotChoice({ path: p });
              } else {
                selectFileInSlot(p, 0);
              }
            }}
            onPickResult={
              wikilinkPickMode
                ? (_path, title) => {
                    const handle = paneRefs.current[activeSlotIdx];
                    if (handle?.insertWikilinkAt) {
                      handle.insertWikilinkAt(title);
                    }
                    setWikilinkPickMode(false);
                    setPaletteOpen(false);
                  }
                : undefined
            }
          />
          <SlotPicker
            isOpen={!!pendingSlotChoice}
            layout={layoutMode}
            slotPaths={slotPaths.slice(0, slotCount)}
            pendingPath={pendingSlotChoice?.path ?? null}
            onPick={(slotIndex) => {
              if (pendingSlotChoice) {
                selectFileInSlot(pendingSlotChoice.path, slotIndex);
              }
              setPendingSlotChoice(null);
            }}
            onClose={() => setPendingSlotChoice(null)}
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
              // New file → open in active slot.
              selectFileInSlot(path, activeSlotIdx);
              setRefreshKey((k) => k + 1);
            }}
          />
          <ExperimentBlockModal
            vaultPath={vaultPath}
            isOpen={blockModalOpen}
            onClose={() => setBlockModalOpen(false)}
            onConfirm={(type, name, iter) => {
              setBlockModalOpen(false);
              const handle = paneRefs.current[activeSlotIdx];
              if (handle) handle.insertExperimentBlock(type, name, iter);
            }}
          />
          <InsertTableModal
            isOpen={tableModalOpen}
            onClose={() => setTableModalOpen(false)}
            onConfirm={(rows, cols, withHeaderRow) => {
              setTableModalOpen(false);
              const handle = paneRefs.current[activeSlotIdx];
              if (handle) handle.insertTable(rows, cols, withHeaderRow);
            }}
          />
          <IntegrationsSettings
            vaultPath={vaultPath}
            isOpen={integrationsOpen}
            onClose={() => setIntegrationsOpen(false)}
          />
          <ReminderOverlay
            vaultPath={vaultPath}
            isOpen={reminderOverlayOpen}
            onClose={() => setReminderOverlayOpen(false)}
            onChanged={() => setReminderRefreshTick((t) => t + 1)}
            onOpenInPane={(filePath) =>
              selectFileInSlot(filePath, activeSlotIdx)
            }
          />
          <OrphanAttachmentsModal
            vaultPath={vaultPath}
            isOpen={orphanModalOpen}
            onClose={() => setOrphanModalOpen(false)}
          />
          {/* Cluster 27 v1.0 — Plotter sidebar. Renders only when a
              plot is bound (click on any cortexPlot focuses + binds).
              Click the × in the header to close + clear the binding. */}
          <PlotterSidebar
            binding={plotterBinding}
            onClose={() => setPlotterBinding(null)}
            width={plotterSidebarWidth}
            onWidthChange={persistPlotterSidebarWidth}
          />
          {templatesModalOpen && (
            <TemplatesModal
              vaultPath={vaultPath}
              onEdit={(templatePath) => {
                // Templates are real .md files in the vault — opening one in
                // the active slot reuses every TipTap effect and the
                // EditorToolbar from Cluster 21 with no extra wiring.
                setTemplatesModalOpen(false);
                void selectFileInSlot(templatePath, activeSlotIdx);
              }}
              onClose={() => setTemplatesModalOpen(false)}
            />
          )}
          {/* Cluster 24 v1.0 — Review schedule modal. */}
          {reviewSettingsOpen && (
            <ReviewSettingsModal
              vaultPath={vaultPath}
              onSaved={() => {
                // Bump indexVersion so calendar / bell re-fetch after the
                // recurring events change.
                setIndexVersion((v) => v + 1);
              }}
              onClose={() => setReviewSettingsOpen(false)}
            />
          )}
          {/* Cluster 24 v1.0 — FileTree right-click menu. Position is
            captured at click time; menu closes on outside click / Esc. */}
          {fileTreeMenu && (
            <FileTreeContextMenu
              x={fileTreeMenu.x}
              y={fileTreeMenu.y}
              nodeType={fileTreeMenu.node.type}
              onAction={(kind) => {
                dispatchFileTreeAction(fileTreeMenu.node, kind);
              }}
              onClose={() => setFileTreeMenu(null)}
            />
          )}
          {/* Cluster 24 v1.0 — Delete confirmation modal. */}
          {deleteConfirm && (
            <DeleteConfirmModal
              path={deleteConfirm.path}
              name={deleteConfirm.name}
              nodeType={deleteConfirm.nodeType}
              containedFileCount={deleteConfirm.containedFileCount}
              onConfirm={confirmDelete}
              onClose={() => setDeleteConfirm(null)}
            />
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Wraps a TabPane with drag-and-drop file routing. Tri/quad layouts
 * use this as the primary way to drop a file into a non-active slot.
 *
 * IMPORTANT: handlers are CAPTURE phase — TipTap (ProseMirror) attaches
 * its own bubble-phase drop listener inside the editor and would
 * otherwise consume the event and try to insert the dragged data as
 * text. Capture phase fires before any descendant's bubble handler,
 * and `stopPropagation()` plus `preventDefault()` together stop the
 * drop from reaching ProseMirror at all.
 */
function PaneWrapper({
  slotIndex,
  onDropPath,
  onDropImage,
  children,
}: {
  slotIndex: number;
  onDropPath: (path: string) => void;
  /** Cluster 19 v1.0 — image cortex-path dropped over an editor. */
  onDropImage?: (sourceAbsolutePath: string, x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const [isOver, setIsOver] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        outline: isOver ? "2px dashed var(--accent)" : "none",
        outlineOffset: "-3px",
      }}
      onDragEnterCapture={(e) => {
        if (e.dataTransfer.types.includes("text/cortex-path")) {
          e.preventDefault();
          e.stopPropagation();
          if (!isOver) setIsOver(true);
        }
      }}
      onDragOverCapture={(e) => {
        if (e.dataTransfer.types.includes("text/cortex-path")) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          if (!isOver) setIsOver(true);
        }
      }}
      onDragLeaveCapture={(e) => {
        // Only clear when leaving this wrapper's bounds, not when
        // moving between its descendants.
        const wrapper = e.currentTarget as HTMLDivElement;
        const related = e.relatedTarget as Node | null;
        if (!related || !wrapper.contains(related)) {
          setIsOver(false);
        }
      }}
      onDropCapture={(e) => {
        const path = e.dataTransfer.getData("text/cortex-path");
        setIsOver(false);
        if (!path) return;
        e.preventDefault();
        e.stopPropagation();
        // Cluster 19 v1.0 — image drop inside an editor area inserts
        // at drop position; outside (or no callback) falls back.
        const isImagePath = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(path);
        if (onDropImage && isImagePath) {
          const dropTarget = e.target as HTMLElement | null;
          const inEditor = !!dropTarget?.closest?.(".ProseMirror");
          if (inEditor) {
            onDropImage(path, e.clientX, e.clientY);
            return;
          }
        }
        onDropPath(path);
      }}
      data-slot-index={slotIndex}
    >
      {children}
    </div>
  );
}

const baseStyles: Record<string, React.CSSProperties> = {
  shell: {
    // Cluster 26 — sits above the CerebrumSplash (z-index: 1). The
    // welcome card inside this shell floats over the rotating brain
    // through a glass panel. position: relative gives the shell its
    // own stacking context so the z-index applies.
    position: "relative",
    zIndex: 2,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  welcomeCard: {
    maxWidth: "560px",
    width: "100%",
    padding: "2.25rem 2.5rem",
    borderRadius: "var(--radius-3)",
    background: "var(--bg-card)",
    border: "1px solid var(--border-2)",
    boxShadow: "var(--shadow-3)",
    backdropFilter: "var(--blur-modal)",
    WebkitBackdropFilter: "var(--blur-modal)" as unknown as undefined,
  },
  appShell: {
    display: "flex",
    // Cluster 21 v1.0.2 — appShell is now nested inside a flex-
    // column wrapper that hosts the universal toolbar above it.
    // Use `flex: 1` so it takes the remaining vertical space, and
    // `minHeight: 0` so children can scroll inside it.
    flex: 1,
    minHeight: 0,
    width: "100vw",
    overflow: "hidden",
  },
  sidebar: {
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
    width: "24px",
    height: "24px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.72rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius-1)",
    padding: 0,
  },
  sidebarHeader: {
    // Cluster 26 — tighter padding so the brand badge + actions don't
    // float in dead space. Was 0.85rem 0.95rem.
    padding: "0.5rem 0.6rem 0.4rem",
    borderBottom: "1px solid var(--border)",
  },
  sidebarTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.25rem",
    gap: "0.5rem",
  },
  sidebarTitle: { fontSize: "0.95rem" },
  sidebarActions: {
    display: "flex",
    alignItems: "center",
    gap: "3px",
    flexWrap: "wrap",
    // Tighter top-margin so the actions sit just below the badge.
    marginTop: "0",
    rowGap: "3px",
  },
  sidebarFooter: {
    padding: "0.5rem 0.85rem",
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  changeBtn: {
    // Cluster 26 — tighter button: smaller padding, smaller font so
    // the dense action cluster fits more comfortably in the narrow
    // sidebar without forcing extra wrap-rows.
    fontSize: "0.68rem",
    padding: "2px 7px",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius-1)",
    whiteSpace: "nowrap",
  },
  iconBtn: {
    width: "22px",
    height: "22px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.78rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius-1)",
    padding: 0,
  },
  sidebarPath: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    wordBreak: "break-all",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
  },
  sidebarBody: { flex: 1, overflowY: "auto", overflowX: "hidden" },
  mainCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  mainTopBar: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.4rem 0.6rem",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-deep)",
  },
  activeSlotLabel: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    marginRight: "0.4rem",
    userSelect: "none",
  },
  gridArea: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
  },
  hiddenPaneStash: {
    position: "absolute",
    width: 0,
    height: 0,
    overflow: "hidden",
    pointerEvents: "none",
    visibility: "hidden",
  },
  errorBanner: {
    padding: "0.5rem 1rem",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-card)",
  },
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
  primaryBtn: {
    marginTop: "1.25rem",
    padding: "0.75rem 1.5rem",
    fontSize: "0.95rem",
    cursor: "pointer",
    background: "var(--accent-gradient)",
    color: "white",
    border: "none",
    borderRadius: "var(--radius-2)",
    fontWeight: 500,
    boxShadow: "0 6px 18px color-mix(in oklab, var(--accent) 30%, transparent)",
  },
  errorText: {
    margin: 0,
    color: "var(--danger)",
    fontSize: "0.85rem",
  },
  muted: { color: "var(--text-muted)", fontSize: "0.9rem" },
};

// Cluster 6 v1.5: multi-tab layout — single, dual, tri-bottom, tri-top, quad.
export default App;
