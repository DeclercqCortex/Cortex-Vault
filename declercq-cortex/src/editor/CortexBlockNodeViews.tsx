// Cluster 21 v1.1 — interactive NodeViews for cortexTabsBlock and
// cortexCollapsible.
//
// Tabs: real tab strip — click a title to switch panels, double-
// click to rename inline, click + to add a tab, click × to remove.
// Active index persists in node attrs (data-active-tab=<n>). The
// tab body always carries N child blocks for N titles; the
// NodeView keeps panel count synced with title count.
//
// Collapsible: click-to-toggle summary header with chevron rotation.
// Open/closed state writes to the node's `open` attr. Double-click
// renames the summary inline.
//
// v1.1.1 fix — panel visibility is driven PURELY from the wrapper's
// data-active-tab attribute via attribute-selector + nth-child CSS
// rules. The earlier "JS toggles a class on the active child"
// approach mutated PM's owned DOM on every keystroke, and PM's
// MutationObserver treated that as an external write and forced a
// resync that disrupted the cursor.
//
// v1.1.2 fix — clicking a tab title now also moves PM's text
// selection into the start of the newly-active panel via a
// deferred setTextSelection. Initial pass had this split across
// two animation frames; the user's keystroke could arrive in
// between and land in the previous (now hidden) panel.
//
// v1.1.3 fix — both setActive AND addTab now perform their attr
// update + cursor placement (and addTab also its empty-paragraph
// insert) as ONE atomic chain / single transaction. With the
// earlier multi-step approach there was always a window where the
// new active panel was already display:block but PM's selection
// still pointed inside the now-hidden previous panel; a keystroke
// arriving in that window made PM "fix" the selection by jumping
// to the nearest editable position outside the tabs block — the
// caret-in-the-line-above bug.

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---- Tabs NodeView -------------------------------------------------------

export function CortexTabsNodeView(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  const titles = useMemo(() => {
    return String(node.attrs.tabs ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [node.attrs.tabs]);

  const rawActive = Number(node.attrs.activeTab ?? 0);
  const active = Math.min(
    Math.max(0, rawActive),
    Math.max(0, titles.length - 1),
  );

  // Children-count sync: pad / trim the body to match titles.length.
  // Defensive cleanup for v1.0 docs where the body was written with
  // a single paragraph for two titles.
  useEffect(() => {
    if (typeof getPos !== "function") return;
    const need = titles.length;
    const have = node.childCount;
    if (need === have || need < 1) return;
    const pos = getPos();
    if (pos == null) return;
    const start = pos + 1;
    if (need > have) {
      const insertAt = pos + node.nodeSize - 1;
      const para = editor.schema.nodes.paragraph;
      if (!para) return;
      const filler = Array.from({ length: need - have }, () => para.create());
      editor.view.dispatch(
        editor.view.state.tr
          .insert(insertAt, filler)
          .setMeta("addToHistory", false),
      );
    } else if (need < have) {
      let deleteFrom = start;
      for (let i = 0; i < need; i++) {
        deleteFrom += node.child(i).nodeSize;
      }
      const deleteTo = pos + node.nodeSize - 1;
      if (deleteTo > deleteFrom) {
        editor.view.dispatch(
          editor.view.state.tr
            .delete(deleteFrom, deleteTo)
            .setMeta("addToHistory", false),
        );
      }
    }
  }, [titles.length, node, getPos, editor]);

  // First position INSIDE child[idx] of the tabsBlock, computed
  // from the current node structure.
  const getChildInnerStart = useCallback(
    (idx: number): number | null => {
      if (typeof getPos !== "function") return null;
      const pos = getPos();
      if (pos == null) return null;
      const safeIdx = Math.min(Math.max(0, idx), node.childCount - 1);
      let target = pos + 1;
      for (let i = 0; i < safeIdx; i++) {
        target += node.child(i).nodeSize;
      }
      return target + 1;
    },
    [getPos, node],
  );

  const setActive = useCallback(
    (idx: number) => {
      if (idx === active) return;
      const target = getChildInnerStart(idx);
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
    [active, editor, getChildInnerStart, updateAttributes],
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
      const updated = titles.map((t, i) => (i === idx ? trimmed : t));
      updateAttributes({ tabs: updated.join("|") });
      setRenamingIndex(null);
    },
    [titles, updateAttributes],
  );

  const cancelRename = useCallback(() => {
    setRenamingIndex(null);
  }, []);

  // ---- Add / remove ------------------------------------------------------

  const addTab = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof getPos !== "function") return;
      const pos = getPos();
      if (pos == null) return;
      const para = editor.schema.nodes.paragraph;
      if (!para) return;
      const newIdx = titles.length;
      const next = [...titles, `Tab ${newIdx + 1}`].join("|");
      const oldNodeSize = node.nodeSize;
      const insertAt = pos + oldNodeSize - 1;
      try {
        const tr = editor.state.tr
          .insert(insertAt, para.create())
          .setNodeMarkup(pos, null, {
            ...node.attrs,
            tabs: next,
            activeTab: newIdx,
          });
        const cursorPos = insertAt + 1;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        editor.view.dispatch(tr);
        editor.commands.focus();
      } catch {
        updateAttributes({ tabs: next, activeTab: newIdx });
      }
    },
    [editor, getPos, node, titles, updateAttributes],
  );

  const removeTab = useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (titles.length <= 1) return;
      const updated = titles.filter((_, i) => i !== idx);
      const newActive =
        active >= updated.length ? Math.max(0, updated.length - 1) : active;
      updateAttributes({ tabs: updated.join("|"), activeTab: newActive });
    },
    [active, titles, updateAttributes],
  );

  return (
    <NodeViewWrapper
      className="cortex-tabs cortex-tabs-nodeview"
      data-tabs={node.attrs.tabs}
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
              {titles.length > 1 && renamingIndex !== i ? (
                <button
                  type="button"
                  className="cortex-tab-remove"
                  onClick={removeTab(i)}
                  title={`Remove "${t}"`}
                  aria-label={`Remove tab ${t}`}
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
