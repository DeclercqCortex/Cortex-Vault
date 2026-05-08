// Cluster 21 v1.1 — interactive NodeViews for cortexTabsBlock and
// cortexCollapsible.
//
// Tabs (v1.1 — panel-per-tab model): real tab strip — click a title
// to switch panels, double-click to rename inline, click + to add
// a tab, click × to remove. Active index persists in the parent's
// `activeTab` attr (data-active-tab=<n>). Each tab's content lives
// in its own `cortexTabPanel` child node which can hold any block+
// content; titles live on each panel's `title` attr.
//
// Why panel-per-tab:
//   v1.0 used a `block+` content model with one child block per
//   tab title and the title strip rendered alongside in renderHTML.
//   Pressing Enter inside any tab made ProseMirror split into two
//   paragraphs in the body. The NodeView's children-count-sync
//   effect would then DELETE the second paragraph (mistaking it
//   for an extra tab without a title) — tabs could never hold
//   more than one paragraph. The fix: each tab is its own real
//   node (cortexTabPanel) holding `block+`, so Enter creates a
//   second paragraph INSIDE the same panel without disturbing
//   any sibling panel. The children-count-sync effect is gone.
//
// Collapsible: click-to-toggle summary header with chevron rotation.
// Open/closed state writes to the node's `open` attr. Double-click
// renames the summary inline.
//
// Visibility of non-active panels is driven PURELY from the
// wrapper's data-active-tab attribute via attribute-selector +
// nth-child CSS rules in index.css, so React/PM never touches the
// panel-display style and PM's MutationObserver stays quiet.

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal as ReactDOMCreatePortal } from "react-dom";

// ---- Tabs NodeView -------------------------------------------------------

export function CortexTabsNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;

  // Imperatively-updated ref to the wrapper element. Used in setActive
  // and addTab to write data-active-tab BEFORE PM dispatches the
  // selection-changing transaction. See the comment on
  // `revealPanelInDom` below for why this is load-bearing.
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Titles live on each cortexTabPanel child's `title` attr — read
  // them straight off the node tree on every render.
  const titles = useMemo(() => {
    const out: string[] = [];
    node.forEach((child) => {
      if (child.type.name === "cortexTabPanel") {
        out.push(String(child.attrs.title ?? "Tab"));
      }
    });
    return out;
  }, [node]);

  const rawActive = Number(node.attrs.activeTab ?? 0);
  const active = Math.min(
    Math.max(0, rawActive),
    Math.max(0, titles.length - 1),
  );

  // Position math:
  //   parentPos = getPos()                     — the cortexTabsBlock itself
  //   parentPos + 1                            — INSIDE the tabs block, at the
  //                                              start of child[0]
  //   panelPos  = parentPos + 1 + Σ child[<i].nodeSize
  //                                            — the cortexTabPanel for index i
  //   panelPos  + 1                            — INSIDE that panel, at the
  //                                              start of its first block
  // (so a `setTextSelection(panelPos + 2)` lands the cursor inside the
  // panel's first paragraph — +1 to enter the panel, +1 to enter the para).
  const getPanelPos = useCallback(
    (idx: number): number | null => {
      if (typeof getPos !== "function") return null;
      const pos = getPos();
      if (pos == null) return null;
      const safeIdx = Math.min(Math.max(0, idx), node.childCount - 1);
      let target = pos + 1;
      for (let i = 0; i < safeIdx; i++) {
        target += node.child(i).nodeSize;
      }
      return target;
    },
    [getPos, node],
  );

  const getPanelInnerStart = useCallback(
    (idx: number): number | null => {
      const panelPos = getPanelPos(idx);
      if (panelPos == null) return null;
      // panelPos is the position BEFORE the cortexTabPanel boundary.
      // panelPos + 1 puts the resolved position INSIDE the panel but
      // BEFORE its first child block — i.e., inside a node whose
      // content rule is `block+`, NOT inline. Calling
      // TextSelection.create at that exact pos throws RangeError
      // ("not a valid text selection"), the surrounding chain catches
      // and silently no-ops the cursor move, and the user's cursor
      // stays put in whatever panel they were just in. Subsequent
      // keystrokes go there — which presents as "tabs share the same
      // typed text" / "cursor stays in the line above".
      //
      // Selection.near walks forward from the given position to the
      // nearest valid text-cursor position, robustly handling whatever
      // block kind the panel's first child happens to be (paragraph,
      // heading, list-item, etc.).
      const $pos = editor.state.doc.resolve(panelPos + 1);
      try {
        const sel = Selection.near($pos, 1);
        return sel.from;
      } catch {
        return panelPos + 1;
      }
    },
    [editor, getPanelPos],
  );

  // Imperatively pull the target panel out of `display: none` BEFORE
  // PM dispatches the selection-changing transaction.
  //
  // Why this is load-bearing: PM's view update for a React NodeView
  // schedules a React state update, which is async (concurrent
  // rendering). PM's setSelection on the DOM, however, runs
  // synchronously inside dispatchTransaction. So in the natural
  // ordering — chain.updateAttributes(activeTab=N).setTextSelection(...) —
  // PM tries to put the cursor inside panel N while the wrapper's
  // data-active-tab attribute is still the OLD value, the new panel
  // is still resolving to `display: none`, and the browser refuses to
  // place a contenteditable selection inside a display:none element.
  // The selection snaps to the nearest visible editable position
  // (the line above the tabs block); the next keystroke lands there
  // instead of in the panel the user just clicked. This presents as
  // "writing one character into those tabs places the text cursor
  // in the line above" plus, indirectly, "the tabs share the same
  // typed text" (every escaped keystroke piles up at the same
  // destination outside the tabs block).
  //
  // Setting data-active-tab on the DOM imperatively is synchronous,
  // CSS recomputes synchronously, and by the time PM's setSelection
  // fires the new panel is `display: block`. The subsequent React
  // re-render produces the same data-active-tab value so there's no
  // overwrite or flicker.
  const revealPanelInDom = useCallback((idx: number) => {
    if (wrapperRef.current) {
      wrapperRef.current.setAttribute("data-active-tab", String(idx));
    }
  }, []);

  const setActive = useCallback(
    (idx: number) => {
      if (idx === active) return;
      revealPanelInDom(idx);
      const target = getPanelInnerStart(idx);
      try {
        const chain = editor.chain();
        chain.updateAttributes("cortexTabsBlock" as any, { activeTab: idx });
        if (target != null) chain.setTextSelection(target);
        chain.focus();
        chain.run();
      } catch {
        updateAttributes({ activeTab: idx });
      }
    },
    [active, editor, getPanelInnerStart, revealPanelInDom, updateAttributes],
  );

  const onTitleClick = useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActive(idx);
    },
    [setActive],
  );

  // ---- Title rename ------------------------------------------------------

  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const startRename = useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setRenamingIndex(idx);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    },
    [],
  );

  const commitRename = useCallback(
    (idx: number, next: string) => {
      const trimmed = next.trim() || `Tab ${idx + 1}`;
      setRenamingIndex(null);
      const panelPos = getPanelPos(idx);
      if (panelPos == null) return;
      const panelNode = node.child(idx);
      if (!panelNode || panelNode.type.name !== "cortexTabPanel") return;
      try {
        const tr = editor.state.tr.setNodeMarkup(panelPos, null, {
          ...panelNode.attrs,
          title: trimmed,
        });
        editor.view.dispatch(tr);
      } catch (err) {
        console.warn("[tabs] rename failed:", err);
      }
    },
    [editor, getPanelPos, node],
  );

  const cancelRename = useCallback(() => {
    setRenamingIndex(null);
  }, []);

  // ---- Add / remove ------------------------------------------------------

  // Add a brand-new cortexTabPanel (with a single empty paragraph) at
  // the end of the tabs block, then atomically focus it. The whole
  // thing is one transaction so PM never sees an intermediate state
  // where the new active panel exists but the cursor still points
  // inside a now-hidden sibling.
  //
  // Like setActive, this calls revealPanelInDom up front so PM's
  // setTextSelection lands inside a DOM that's already resolving to
  // `display: block` for the new panel — the panel itself doesn't
  // exist yet at the moment we set the attribute, but as soon as PM
  // appends it to .cortex-tab-body the existing rule
  // `.cortex-tabs[data-active-tab="N"] > .cortex-tab-body > *:nth-child(N+1)`
  // matches and the panel paints `display: block` synchronously
  // before PM tries to focus inside it.
  const addTab = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof getPos !== "function") return;
      const pos = getPos();
      if (pos == null) return;
      const para = editor.schema.nodes.paragraph;
      const panelType = editor.schema.nodes.cortexTabPanel;
      if (!para || !panelType) return;
      const newIdx = titles.length;
      revealPanelInDom(newIdx);
      const newPanel = panelType.create(
        { title: `Tab ${newIdx + 1}` },
        para.create(),
      );
      const insertAt = pos + node.nodeSize - 1;
      try {
        const tr = editor.state.tr
          .insert(insertAt, newPanel)
          .setNodeMarkup(pos, null, { ...node.attrs, activeTab: newIdx });
        // Cursor lands inside the new panel's first paragraph: insertAt
        // is the position WHERE the panel was inserted (i.e., the end of
        // the parent's content); +1 to enter the panel; +1 to enter the
        // paragraph.
        const cursorPos = insertAt + 2;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        editor.view.dispatch(tr);
        editor.commands.focus();
      } catch (err) {
        console.warn("[tabs] addTab failed:", err);
      }
    },
    [editor, getPos, node, revealPanelInDom, titles.length],
  );

  // Remove a panel (and its content). When removing the LAST panel,
  // the entire cortexTabsBlock is deleted from the doc so the user
  // doesn't get stuck with an empty tabs shell. Otherwise, new
  // active is clamped to the remaining range — removing the active
  // tab shifts active to the previous one; removing a non-active
  // tab before the active one decrements the active index by 1; a
  // non-active tab to the right of active leaves active unchanged.
  const removeTab = useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof getPos !== "function") return;
      const parentPos = getPos();
      if (parentPos == null) return;

      // Last tab → delete the entire block.
      if (titles.length <= 1) {
        try {
          const tr = editor.state.tr.delete(
            parentPos,
            parentPos + node.nodeSize,
          );
          editor.view.dispatch(tr);
          editor.commands.focus();
        } catch (err) {
          console.warn("[tabs] removeTab (last) failed:", err);
        }
        return;
      }

      const panelPos = getPanelPos(idx);
      if (panelPos == null) return;
      const panelNode = node.child(idx);
      if (!panelNode || panelNode.type.name !== "cortexTabPanel") return;

      const remaining = titles.length - 1;
      let newActive: number;
      if (idx === active) {
        newActive = Math.min(active, remaining - 1);
      } else if (idx < active) {
        newActive = active - 1;
      } else {
        newActive = active;
      }
      newActive = Math.max(0, Math.min(newActive, remaining - 1));

      // Same reasoning as setActive / addTab: write data-active-tab on
      // the wrapper synchronously so the new active panel resolves to
      // display:block before PM mutates the DOM and any subsequent
      // selection set fires.
      revealPanelInDom(newActive);

      try {
        const tr = editor.state.tr.delete(
          panelPos,
          panelPos + panelNode.nodeSize,
        );
        // Update activeTab on the parent in the SAME transaction so
        // there's no transient state where active points at the now-
        // deleted panel.
        const mappedParentPos = tr.mapping.map(parentPos);
        const parentAfter = tr.doc.nodeAt(mappedParentPos);
        if (parentAfter && parentAfter.type.name === "cortexTabsBlock") {
          tr.setNodeMarkup(mappedParentPos, null, {
            ...parentAfter.attrs,
            activeTab: newActive,
          });
        }
        editor.view.dispatch(tr);
      } catch (err) {
        console.warn("[tabs] removeTab failed:", err);
      }
    },
    [
      active,
      editor,
      getPanelPos,
      getPos,
      node,
      revealPanelInDom,
      titles.length,
    ],
  );

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="cortex-tabs cortex-tabs-nodeview"
      data-active-tab={active}
    >
      <div
        className="cortex-tabs-titles"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
      >
        {titles.length === 0 ? (
          <span className="cortex-tabs-empty">no tabs — click + to add</span>
        ) : (
          titles.map((t, i) => (
            <span
              key={i}
              className={"cortex-tab-title" + (i === active ? " active" : "")}
              role="tab"
              aria-selected={i === active}
            >
              {renamingIndex === i ? (
                <input
                  ref={renameInputRef}
                  className="cortex-tab-rename-input"
                  defaultValue={t}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(i, (e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={(e) => commitRename(i, e.target.value)}
                />
              ) : (
                <span
                  className="cortex-tab-title-text"
                  tabIndex={0}
                  onClick={onTitleClick(i)}
                  onDoubleClick={startRename(i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(i);
                    }
                  }}
                  title="Click to switch, double-click to rename"
                >
                  {t}
                </span>
              )}
              {renamingIndex !== i ? (
                <button
                  type="button"
                  className="cortex-tab-remove"
                  onClick={removeTab(i)}
                  // When this is the LAST remaining tab, clicking ×
                  // deletes the whole tabs block (see removeTab).
                  // Surface that in the tooltip so the user isn't
                  // surprised by the block disappearing.
                  title={
                    titles.length > 1
                      ? `Remove "${t}"`
                      : `Remove "${t}" and delete the tabs block`
                  }
                  aria-label={
                    titles.length > 1
                      ? `Remove tab ${t}`
                      : `Remove tab ${t} and delete the tabs block`
                  }
                >
                  ×
                </button>
              ) : null}
            </span>
          ))
        )}
        <button
          type="button"
          className="cortex-tab-add"
          onClick={addTab}
          title="Add tab"
          aria-label="Add tab"
        >
          +
        </button>
      </div>
      <NodeViewContent className="cortex-tab-body" />
    </NodeViewWrapper>
  );
}

// ---- Collapsible NodeView ------------------------------------------------

export function CortexCollapsibleNodeView(props: NodeViewProps) {
  const { node, updateAttributes } = props;
  const open = Boolean(node.attrs.open);
  const summary = String(node.attrs.summary ?? "Toggle");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);

  const toggleOpen = useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (editing) return;
      updateAttributes({ open: !open });
    },
    [editing, open, updateAttributes],
  );

  const startEditingSummary = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const commitEditing = useCallback(
    (next: string) => {
      setEditing(false);
      const trimmed = next.trim() || "Toggle";
      if (trimmed !== summary) updateAttributes({ summary: trimmed });
    },
    [summary, updateAttributes],
  );

  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  return (
    <NodeViewWrapper
      className={"cortex-toggle cortex-toggle-nodeview" + (open ? " open" : "")}
      data-open={open ? "true" : "false"}
      data-summary={summary}
    >
      <div
        className="cortex-toggle-summary"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className="cortex-toggle-chevron"
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path
              d="M3 4.5L6 7.5L9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {editing ? (
          <input
            ref={inputRef}
            className="cortex-toggle-summary-input"
            defaultValue={summary}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEditing((e.target as HTMLInputElement).value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
              }
            }}
            onBlur={(e) => commitEditing(e.target.value)}
          />
        ) : (
          <span
            className="cortex-toggle-summary-text"
            onClick={toggleOpen}
            onDoubleClick={startEditingSummary}
            title="Click to toggle, double-click to rename"
          >
            {summary}
          </span>
        )}
      </div>
      <NodeViewContent className="cortex-toggle-body" />
    </NodeViewWrapper>
  );
}

// ---- Math block NodeView (v1.2.2) ----------------------------------------
//
// Renders the cortexMathBlock's `latex` attribute as actual math via
// KaTeX (loaded from CDN in index.html). The rendered output replaces
// the textual LaTeX that the document used to show.
//
// KaTeX may not be on `window.katex` yet at first paint (the CDN
// script is `defer`-loaded). The effect retries on a short interval
// until KaTeX is available, then renders. If KaTeX never loads (e.g.
// offline), we fall back to plain text so the user at least sees
// their LaTeX rather than nothing.
//
// Editing: double-clicking the rendered block emits a window-level
// `cortex:edit-math-block` CustomEvent carrying the node position and
// current LaTeX. The toolbar listens for it and reopens the math
// modal pre-filled, then on Done updates the node's `latex` attr in
// place via `updateAttributes`.
//
// Single click selects the node (NodeSelection) so Backspace deletes
// the whole equation, matching the existing decorative-separator and
// page-break atoms.

export function CortexMathBlockNodeView(props: NodeViewProps) {
  const { node, getPos } = props;
  const latex = String(node.attrs.latex ?? "");
  const renderRef = useRef<HTMLDivElement | null>(null);
  // v1.2.3 — right-click context menu state. Stores the viewport
  // coordinates of the click so we can render the menu at that
  // position. `null` means menu closed.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = renderRef.current;
    if (!el) return;

    let cancelled = false;

    function attempt(): boolean {
      const k = (window as unknown as { katex?: KatexGlobal }).katex;
      if (!k || !el) return false;
      try {
        if (!latex) {
          el.textContent = "";
          return true;
        }
        k.render(latex, el, {
          displayMode: true,
          throwOnError: false,
          // KaTeX colours errors red by default. Keep the badge but
          // tone it to the theme so it doesn't scream against the
          // surrounding paper.
          errorColor: "#c0392b",
          strict: "ignore",
          trust: false,
        });
        return true;
      } catch {
        // Final fallback: show the LaTeX as plain text so the user
        // still knows what's there.
        el.textContent = latex;
        return true;
      }
    }

    if (attempt()) return;

    // Poll briefly while the deferred CDN script finishes loading.
    const interval = window.setInterval(() => {
      if (cancelled) return;
      if (attempt()) window.clearInterval(interval);
    }, 80);
    // Give up after 5s — at that point the user is offline / the CDN
    // is blocked, and the plain-text fallback is appropriate.
    const giveUp = window.setTimeout(() => {
      if (cancelled) return;
      window.clearInterval(interval);
      if (el) el.textContent = latex;
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(giveUp);
    };
  }, [latex]);

  const dispatchEdit = useCallback(() => {
    const pos = typeof getPos === "function" ? getPos() : null;
    try {
      window.dispatchEvent(
        new CustomEvent("cortex:edit-math-block", {
          detail: { pos, latex },
        }),
      );
    } catch {
      /* CustomEvent ctor missing in old engines — ignore */
    }
  }, [getPos, latex]);

  const dispatchDelete = useCallback(() => {
    const pos = typeof getPos === "function" ? getPos() : null;
    try {
      window.dispatchEvent(
        new CustomEvent("cortex:delete-math-block", {
          detail: { pos },
        }),
      );
    } catch {
      /* ignore */
    }
  }, [getPos]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dispatchEdit();
    },
    [dispatchEdit],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Replace the native browser context menu with our own. The
    // user gets Edit + Delete affordances tailored to math blocks
    // instead of the generic Copy / Paste options that aren't
    // useful for an atom node.
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenuPos(null), []);

  return (
    <NodeViewWrapper
      as="div"
      className="cortex-math-block"
      data-latex={latex}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title="Double-click to edit · right-click for more"
    >
      <div ref={renderRef} className="cortex-math-render" />
      {menuPos && (
        <MathBlockContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onEdit={() => {
            closeMenu();
            dispatchEdit();
          }}
          onDelete={() => {
            closeMenu();
            // No confirm here — the user explicitly chose Delete in
            // the context menu, so two-step would feel pestering.
            // The modal-Delete path (which can fire after the user
            // has typed an edit) does confirm.
            dispatchDelete();
          }}
          onClose={closeMenu}
        />
      )}
    </NodeViewWrapper>
  );
}

// ---- Context menu sub-component -----------------------------------------
//
// Tiny floating menu rendered via portal so it isn't clipped by the
// editor's overflow:hidden. Closes on outside-click or Esc. Uses
// fixed positioning at the click coordinates; clamped against the
// viewport so it stays on screen near the right/bottom edges.

function MathBlockContextMenu({
  x,
  y,
  onEdit,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onMouseDown = () => onClose();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Use mousedown (not click) so we close before a click can
    // re-trigger the same context menu we just opened.
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  // Clamp to viewport so a click near the right/bottom edge doesn't
  // push the menu off-screen. Approximate menu size: 140 wide × 70
  // tall — tighter clamping than that costs more measurement than
  // it's worth.
  const W = 140;
  const H = 76;
  const left = Math.min(x, window.innerWidth - W - 4);
  const top = Math.min(y, window.innerHeight - H - 4);

  return ReactDOMCreatePortal(
    <div
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "3px",
        boxShadow: "var(--shadow, 0 6px 20px rgba(0,0,0,0.25))",
        zIndex: 1100,
        minWidth: W,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}
    >
      <button
        type="button"
        onClick={onEdit}
        style={menuItemStyle()}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-elev)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        ✎ Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        style={{ ...menuItemStyle(), color: "var(--danger)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--bg-elev)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        × Delete
      </button>
    </div>,
    document.body,
  );
}

function menuItemStyle(): React.CSSProperties {
  return {
    cursor: "pointer",
    padding: "5px 10px",
    fontSize: "0.85rem",
    background: "transparent",
    border: "none",
    color: "var(--text)",
    textAlign: "left",
    borderRadius: "4px",
  };
}

// Minimal type for the global KaTeX object loaded from the CDN.
interface KatexGlobal {
  render(
    expression: string,
    element: HTMLElement,
    options?: {
      displayMode?: boolean;
      throwOnError?: boolean;
      errorColor?: string;
      strict?: "ignore" | "warn" | "error";
      trust?: boolean;
    },
  ): void;
}
