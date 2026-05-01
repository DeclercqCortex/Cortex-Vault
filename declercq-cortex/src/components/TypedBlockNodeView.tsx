// TypedBlockNodeView — Cluster 17.
//
// React component rendered inside the editor for every typedBlock node.
// Renders:
//   - A non-editable title bar across the top with "Experiment · NAME ·
//     iter N" (or "Protocol · NAME" etc.). The bar holds an "Edit name"
//     pencil button and a "Delete block" trash button.
//   - The editable body via <NodeViewContent />. ProseMirror handles
//     this — bullet lists, ordered lists, code blocks, and tables can
//     all be inserted normally inside the body.
//
// Inline edit-name UX (chosen over a modal in the cluster doc): clicking
// the pencil swaps the title text for an <input>. Enter or blur commits
// via updateAttributes; Escape cancels. The input auto-focuses, and we
// stopPropagation on its keydown so editor shortcuts (Ctrl+S etc.) don't
// fire while the user is editing the name.
//
// Why the title bar uses contentEditable={false}: ProseMirror would
// otherwise try to put a caret in any DOM that isn't explicitly opted
// out of editing. Not setting this is the v1.0/v1.1 decoration's biggest
// usability problem — typing into the title silently breaks the parser.
//
// Cluster 17 v1.1: Ctrl/Cmd+Click on the title bar fires a
// `cortex:follow-typed-block` CustomEvent on editor.view.dom; Editor.tsx
// listens and routes through the host's onFollowTypedBlock prop, which
// resolves via the Rust resolve_typed_block_target command and opens
// the resulting path in the active pane.

import { useEffect, useRef, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import {
  formatTypedBlockTitle,
  type TypedBlockAttrs,
  type TypedBlockType,
} from "../editor/TypedBlockNode";

/**
 * Custom DOM event the BlockContextMenu's "Edit name" action dispatches
 * on the editor's ProseMirror root. Each mounted NodeView listens; the
 * one whose `getPos()` matches `event.detail.pos` flips into edit mode.
 */
export const EDIT_TYPED_BLOCK_EVENT = "cortex:edit-typed-block";

interface EditTypedBlockDetail {
  pos: number;
}

/**
 * Cluster 17 v1.1 — Ctrl/Cmd+Click on the title bar fires this event.
 * Editor.tsx listens and forwards detail through onFollowTypedBlock so
 * App can invoke the Rust resolver and route the result through
 * selectFileInSlot.
 */
export const FOLLOW_TYPED_BLOCK_EVENT = "cortex:follow-typed-block";

interface FollowTypedBlockDetail {
  blockType: TypedBlockType;
  name: string;
  iterNumber: number | null;
}

function asAttrs(raw: Record<string, unknown>): TypedBlockAttrs {
  return {
    blockType: (raw.blockType as TypedBlockType) ?? "experiment",
    name: typeof raw.name === "string" ? raw.name : "",
    iterNumber:
      typeof raw.iterNumber === "number"
        ? raw.iterNumber
        : raw.iterNumber == null
          ? null
          : Number(raw.iterNumber),
  };
}

export function TypedBlockNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  getPos,
}: NodeViewProps) {
  const attrs = asAttrs(node.attrs);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(attrs.name);
  const [draftIter, setDraftIter] = useState<string>(
    attrs.iterNumber == null ? "" : String(attrs.iterNumber),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const iterRef = useRef<HTMLInputElement | null>(null);

  // Keep draft state in sync when attrs change while we're not editing.
  useEffect(() => {
    if (!editing) {
      setDraftName(attrs.name);
      setDraftIter(attrs.iterNumber == null ? "" : String(attrs.iterNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.name, attrs.iterNumber, editing]);

  // Listen for the BlockContextMenu's "Edit name" trigger on view.dom.
  // The matching NodeView (getPos === detail.pos) flips into edit mode.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    function handler(e: Event) {
      const detail = (e as CustomEvent<EditTypedBlockDetail>).detail;
      if (!detail || typeof detail.pos !== "number") return;
      if (!editor || !editor.isEditable) return;
      let myPos: number | undefined;
      try {
        const p = getPos();
        myPos = typeof p === "number" ? p : undefined;
      } catch {
        myPos = undefined;
      }
      if (myPos == null) return;
      if (myPos === detail.pos) {
        setEditing(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    }
    dom.addEventListener(EDIT_TYPED_BLOCK_EVENT, handler);
    return () => dom.removeEventListener(EDIT_TYPED_BLOCK_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, getPos]);

  function commit() {
    const name = draftName.trim();
    if (!name) {
      setEditing(false);
      setDraftName(attrs.name);
      setDraftIter(attrs.iterNumber == null ? "" : String(attrs.iterNumber));
      return;
    }
    const updates: Partial<TypedBlockAttrs> = { name };
    if (attrs.blockType === "experiment") {
      const n = parseInt(draftIter, 10);
      updates.iterNumber =
        Number.isFinite(n) && n > 0 ? n : (attrs.iterNumber ?? 1);
    }
    updateAttributes(updates);
    setEditing(false);
  }

  function cancel() {
    setDraftName(attrs.name);
    setDraftIter(attrs.iterNumber == null ? "" : String(attrs.iterNumber));
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Tab") {
      if (attrs.blockType === "experiment") {
        if (e.target === inputRef.current && iterRef.current) {
          e.preventDefault();
          iterRef.current.focus();
        }
      }
    }
  }

  function startEdit() {
    if (!editor.isEditable) return;
    setDraftName(attrs.name);
    setDraftIter(attrs.iterNumber == null ? "" : String(attrs.iterNumber));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!editor.isEditable) return;
    deleteNode();
  }

  // Cluster 17 v1.1 — Ctrl/Cmd+Click on the title text navigates to the
  // referenced document. Dispatches a CustomEvent on view.dom; Editor.tsx
  // listens and forwards the detail to the host's onFollowTypedBlock.
  function handleTitleClick(e: React.MouseEvent) {
    if (!editor) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (editing) return;
    if (!attrs.name.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    const detail: FollowTypedBlockDetail = {
      blockType: attrs.blockType,
      name: attrs.name,
      iterNumber: attrs.iterNumber,
    };
    const event = new CustomEvent(FOLLOW_TYPED_BLOCK_EVENT, { detail });
    editor.view.dom.dispatchEvent(event);
  }

  const titleText = formatTypedBlockTitle(attrs);
  const kindLabel =
    attrs.blockType.charAt(0).toUpperCase() + attrs.blockType.slice(1);

  return (
    <NodeViewWrapper
      className="cortex-typed-block"
      data-block-type={attrs.blockType}
    >
      <div
        className="cortex-typed-block-title"
        contentEditable={false}
        onClick={handleTitleClick}
        title={
          editing ? undefined : "Ctrl/Cmd+Click to open the referenced document"
        }
      >
        <span className="cortex-typed-block-glyph" aria-hidden>
          ▸
        </span>
        {editing ? (
          <span className="cortex-typed-block-title-editing">
            <span className="cortex-typed-block-kind">{kindLabel} ·</span>
            <input
              ref={inputRef}
              className="cortex-typed-block-name-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => {
                requestAnimationFrame(() => {
                  const root = inputRef.current?.closest(
                    ".cortex-typed-block-title",
                  );
                  if (
                    root &&
                    !root.contains(document.activeElement as Node | null)
                  ) {
                    commit();
                  }
                });
              }}
              onKeyDown={handleKey}
              placeholder="block name"
              spellCheck={false}
              aria-label="Block name"
            />
            {attrs.blockType === "experiment" && (
              <>
                <span className="cortex-typed-block-iter-sep">/ iter-</span>
                <input
                  ref={iterRef}
                  className="cortex-typed-block-iter-input"
                  value={draftIter}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    setDraftIter(v);
                  }}
                  onBlur={() => {
                    requestAnimationFrame(() => {
                      const root = iterRef.current?.closest(
                        ".cortex-typed-block-title",
                      );
                      if (
                        root &&
                        !root.contains(document.activeElement as Node | null)
                      ) {
                        commit();
                      }
                    });
                  }}
                  onKeyDown={handleKey}
                  inputMode="numeric"
                  aria-label="Iteration number"
                />
              </>
            )}
          </span>
        ) : (
          <span className="cortex-typed-block-title-text">{titleText}</span>
        )}
        <span className="cortex-typed-block-actions">
          {!editing && (
            <button
              type="button"
              className="cortex-typed-block-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                startEdit();
              }}
              title="Edit name"
              aria-label="Edit block name"
              tabIndex={-1}
            >
              ✎
            </button>
          )}
          <button
            type="button"
            className="cortex-typed-block-btn cortex-typed-block-btn-danger"
            onClick={handleDelete}
            title="Delete block"
            aria-label="Delete block"
            tabIndex={-1}
          >
            ✕
          </button>
        </span>
      </div>
      <NodeViewContent className="cortex-typed-block-body" />
    </NodeViewWrapper>
  );
}
