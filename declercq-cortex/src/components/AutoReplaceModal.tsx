// Cluster 21 v1.1 polish — Auto-Replace pipeline manager.
//
// Modal launched from the editor toolbar (↔ button in the Utility
// group). Shows two columns:
//
//   - Built-in rules grouped by category. Every row has Edit and
//     Delete buttons. Editing a built-in writes a user override
//     with the same `before` (so the user version wins). Deleting
//     a built-in adds it to the disabled set so it stops firing.
//
//   - Custom rules — user rules + overrides. Same Edit / Delete
//     buttons. Add form at the bottom of the column.
//
// "Reset to defaults" in the footer clears both the user-rules and
// disabled-builtins keys, restoring the shipped pipeline.
//
// Centering: the modal is rendered via createPortal into document.
// body. We can't rely on `position: fixed` alone because the toolbar
// is a sticky element and many ancestors apply transform/contain in
// the editor view, both of which break out of the viewport-relative
// fixed-positioning context.
//
// Edit-in-place: the modal tracks one "currently editing" key (the
// original `before` of the rule being edited). While editing, the
// row renders inputs + Save/Cancel instead of the static cells. We
// allow at most one row in edit mode at a time to keep the keyboard
// flow predictable.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CORTEX_AUTOREPLACE_BUILTIN,
  readUserAutoReplaceRules,
  writeUserAutoReplaceRules,
  readDisabledBuiltins,
  writeDisabledBuiltins,
  resetAutoReplaceToDefaults,
  AUTOREPLACE_CHANGED_EVENT,
  type AutoReplaceRule,
} from "../editor/CortexAutoReplace";

interface AutoReplaceModalProps {
  onClose: () => void;
}

export function AutoReplaceModal({ onClose }: AutoReplaceModalProps) {
  const [userRules, setUserRules] = useState<AutoReplaceRule[]>(() =>
    readUserAutoReplaceRules(),
  );
  const [disabled, setDisabled] = useState<Set<string>>(() =>
    readDisabledBuiltins(),
  );

  // Add-form state.
  const [draftBefore, setDraftBefore] = useState("");
  const [draftAfter, setDraftAfter] = useState("");

  // Edit-in-place state. `editingKey` is the ORIGINAL `before` of
  // the rule being edited (so we can find the right row to update
  // when the user changes the `before` field).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraftBefore, setEditDraftBefore] = useState("");
  const [editDraftAfter, setEditDraftAfter] = useState("");

  const [error, setError] = useState<string | null>(null);

  // Stay in sync with external changes (e.g. another open instance,
  // localStorage events from other tabs).
  useEffect(() => {
    const handler = () => {
      setUserRules(readUserAutoReplaceRules());
      setDisabled(readDisabledBuiltins());
    };
    window.addEventListener(AUTOREPLACE_CHANGED_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(AUTOREPLACE_CHANGED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Built-ins shown in the left column = those not disabled and not
  // overridden by a user rule with the same `before`. Grouped by
  // category for visual organisation.
  const builtinByCategory = useMemo(() => {
    const userBefores = new Set(userRules.map((r) => r.before));
    const visible = CORTEX_AUTOREPLACE_BUILTIN.filter(
      (r) => !disabled.has(r.before) && !userBefores.has(r.before),
    );
    const map = new Map<string, AutoReplaceRule[]>();
    for (const r of visible) {
      const cat = r.category ?? "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    }
    return Array.from(map.entries());
  }, [userRules, disabled]);

  const startEdit = (rule: AutoReplaceRule) => {
    setEditingKey(rule.before);
    setEditDraftBefore(rule.before);
    setEditDraftAfter(rule.after);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraftBefore("");
    setEditDraftAfter("");
    setError(null);
  };

  // Save the in-progress edit. The original rule may be a built-in
  // OR a user rule; the result is always a user rule (which wins
  // over any built-in with the same `before`). If editing a built-in
  // and the user changed the `before`, we additionally disable the
  // original built-in so it doesn't continue firing on the old
  // pattern.
  const saveEdit = () => {
    if (editingKey === null) return;
    setError(null);

    if (!editDraftBefore) {
      setError("'Before' can't be empty.");
      return;
    }

    const isBuiltin = CORTEX_AUTOREPLACE_BUILTIN.some(
      (r) => r.before === editingKey,
    );

    // Conflict check: the new `before` can't collide with a different
    // existing rule (built-in or user) — only with itself or its own
    // original key.
    const collidesWithOtherUser = userRules.some(
      (r) => r.before === editDraftBefore && r.before !== editingKey,
    );
    const collidesWithOtherBuiltin =
      editDraftBefore !== editingKey &&
      CORTEX_AUTOREPLACE_BUILTIN.some((r) => r.before === editDraftBefore) &&
      !disabled.has(editDraftBefore);
    if (collidesWithOtherUser || collidesWithOtherBuiltin) {
      setError(
        `A rule with 'Before' = "${visualize(editDraftBefore)}" already exists.`,
      );
      return;
    }

    // Build the next user-rules list. Strategy:
    //   - drop any user rule whose `before` matches editingKey (the
    //     in-place update) or matches editDraftBefore (the new key,
    //     in case it pre-existed as a phantom).
    //   - append the edited rule.
    const cleaned = userRules.filter(
      (r) => r.before !== editingKey && r.before !== editDraftBefore,
    );
    const next: AutoReplaceRule[] = [
      ...cleaned,
      { before: editDraftBefore, after: editDraftAfter },
    ];
    writeUserAutoReplaceRules(next);
    setUserRules(next);

    // If editing a built-in and the `before` changed, the original
    // built-in's `before` is no longer represented by an override —
    // mark it disabled so it doesn't come back when the user re-
    // opens the modal.
    if (isBuiltin && editingKey !== editDraftBefore) {
      const nextDisabled = new Set(disabled);
      nextDisabled.add(editingKey);
      writeDisabledBuiltins(nextDisabled);
      setDisabled(nextDisabled);
    }

    cancelEdit();
  };

  // Delete a rule. Built-ins are added to the disabled set so the
  // engine stops applying them. User rules (including overrides)
  // are removed from the user-rules list.
  const deleteRule = (rule: AutoReplaceRule, isBuiltin: boolean) => {
    setError(null);
    // If we're currently editing this rule, exit edit mode first.
    if (editingKey === rule.before) cancelEdit();

    if (isBuiltin) {
      const nextDisabled = new Set(disabled);
      nextDisabled.add(rule.before);
      writeDisabledBuiltins(nextDisabled);
      setDisabled(nextDisabled);
    }
    // Always also remove any user-rule override with this `before`,
    // so deleting a built-in that had been overridden truly removes
    // it from the active set.
    const nextUser = userRules.filter((r) => r.before !== rule.before);
    if (nextUser.length !== userRules.length) {
      writeUserAutoReplaceRules(nextUser);
      setUserRules(nextUser);
    }
  };

  const handleAdd = () => {
    setError(null);
    if (!draftBefore) {
      setError("'Before' can't be empty.");
      return;
    }
    // Reject duplicates against built-ins (active) or existing user
    // rules.
    const userDup = userRules.some((r) => r.before === draftBefore);
    const builtinDup =
      CORTEX_AUTOREPLACE_BUILTIN.some((r) => r.before === draftBefore) &&
      !disabled.has(draftBefore);
    if (userDup || builtinDup) {
      setError(
        `A rule with 'Before' = "${visualize(draftBefore)}" already exists. Edit that one instead, or delete it first.`,
      );
      return;
    }
    const lastChar = draftBefore[draftBefore.length - 1];
    const isTriggerChar = /\s|[.,;:!?\-+/\\=<>(){}[\]]/.test(lastChar);
    const next: AutoReplaceRule[] = [
      ...userRules,
      { before: draftBefore, after: draftAfter },
    ];
    writeUserAutoReplaceRules(next);
    setUserRules(next);
    setDraftBefore("");
    setDraftAfter("");
    if (!isTriggerChar) {
      setError(
        "Heads up — 'Before' usually ends with a space or other trigger character. The rule was added, but it'll only fire when its trailing character is typed.",
      );
    }
  };

  const handleResetAll = () => {
    if (
      !window.confirm(
        "Reset to defaults? This deletes all custom rules and re-enables every built-in rule.",
      )
    ) {
      return;
    }
    resetAutoReplaceToDefaults();
    setUserRules([]);
    setDisabled(new Set());
    cancelEdit();
    setError(null);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (editingKey !== null) {
        cancelEdit();
      } else {
        onClose();
      }
    }
  };

  const node = (
    <div style={styles.scrim} onClick={onClose}>
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKey}
        role="dialog"
        aria-label="Auto-replace rules"
      >
        <div style={styles.headerRow}>
          <h2 style={styles.heading}>Auto-replace rules</h2>
          <span style={styles.headerCount}>
            {builtinByCategory.reduce((n, [, rs]) => n + rs.length, 0)}{" "}
            built-in active · {userRules.length} custom · {disabled.size}{" "}
            disabled
          </span>
        </div>
        <p style={styles.hint}>
          Type the <strong>Before</strong> string, ending with a trigger
          character (usually a space), to auto-insert <strong>After</strong>.
          Edit any rule to customise it; deleting a built-in disables it (use
          Reset to defaults to bring everything back).
        </p>

        <div style={styles.body}>
          {/* Built-in rules — left column, grouped by category */}
          <div style={styles.column}>
            <div style={styles.columnHeader}>Built-in</div>
            <div style={styles.scrollArea}>
              {builtinByCategory.length === 0 && (
                <div style={styles.emptyState}>
                  All built-in rules have been disabled or overridden.
                </div>
              )}
              {builtinByCategory.map(([cat, rules]) => (
                <div key={cat} style={styles.categoryBlock}>
                  <div style={styles.categoryLabel}>{cat}</div>
                  <div style={styles.ruleGrid}>
                    {rules.map((r) =>
                      editingKey === r.before ? (
                        <RuleEditRow
                          key={r.before}
                          before={editDraftBefore}
                          after={editDraftAfter}
                          onChangeBefore={setEditDraftBefore}
                          onChangeAfter={setEditDraftAfter}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <RuleDisplayRow
                          key={r.before}
                          rule={r}
                          editable
                          onEdit={() => startEdit(r)}
                          onDelete={() => deleteRule(r, true)}
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom rules — right column, with Add form below */}
          <div style={styles.column}>
            <div style={styles.columnHeader}>Custom</div>
            <div style={styles.scrollArea}>
              {userRules.length === 0 && (
                <div style={styles.emptyState}>
                  No custom rules yet. Add one below.
                </div>
              )}
              <div style={styles.ruleGrid}>
                {userRules.map((r, i) =>
                  editingKey === r.before ? (
                    <RuleEditRow
                      key={`${r.before}-${i}`}
                      before={editDraftBefore}
                      after={editDraftAfter}
                      onChangeBefore={setEditDraftBefore}
                      onChangeAfter={setEditDraftAfter}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <RuleDisplayRow
                      key={`${r.before}-${i}`}
                      rule={r}
                      editable
                      onEdit={() => startEdit(r)}
                      onDelete={() => deleteRule(r, false)}
                    />
                  ),
                )}
              </div>
            </div>

            <div style={styles.addForm}>
              <div style={styles.addFormRow}>
                <label style={styles.fieldLabel}>Before</label>
                <input
                  style={styles.fieldInput}
                  value={draftBefore}
                  onChange={(e) => setDraftBefore(e.target.value)}
                  placeholder="e.g. tldr "
                  spellCheck={false}
                />
              </div>
              <div style={styles.addFormRow}>
                <label style={styles.fieldLabel}>After</label>
                <input
                  style={styles.fieldInput}
                  value={draftAfter}
                  onChange={(e) => setDraftAfter(e.target.value)}
                  placeholder="e.g. Too long; didn't read: "
                  spellCheck={false}
                />
              </div>
              <div style={styles.addFormActions}>
                <button
                  onClick={handleAdd}
                  style={styles.btnPrimary}
                  disabled={!draftBefore}
                >
                  Add rule
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <button onClick={handleResetAll} style={styles.btnGhost}>
            Reset to defaults
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={styles.btnGhost}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  // Render via portal so the fixed-positioned scrim resolves against
  // the viewport, not the sticky toolbar ancestor that would otherwise
  // clip the modal at the top of the editor.
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}

// ---- Sub-components ------------------------------------------------------

function RuleDisplayRow({
  rule,
  editable,
  onEdit,
  onDelete,
}: {
  rule: AutoReplaceRule;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={styles.ruleRow}>
      <code style={styles.ruleCell}>{visualize(rule.before)}</code>
      <span style={styles.ruleArrow}>→</span>
      <code style={styles.ruleCell}>{visualize(rule.after)}</code>
      {editable && (
        <div style={styles.rowActions}>
          <button
            onClick={onEdit}
            style={styles.btnSmall}
            title="Edit this rule"
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            style={styles.btnDanger}
            title="Delete this rule"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function RuleEditRow({
  before,
  after,
  onChangeBefore,
  onChangeAfter,
  onSave,
  onCancel,
}: {
  before: string;
  after: string;
  onChangeBefore: (v: string) => void;
  onChangeAfter: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={styles.ruleRowEdit}>
      <input
        style={styles.editInput}
        value={before}
        onChange={(e) => onChangeBefore(e.target.value)}
        placeholder="Before"
        autoFocus
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <span style={styles.ruleArrow}>→</span>
      <input
        style={styles.editInput}
        value={after}
        onChange={(e) => onChangeAfter(e.target.value)}
        placeholder="After"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div style={styles.rowActions}>
        <button onClick={onSave} style={styles.btnSmall} title="Save changes">
          ✓
        </button>
        <button onClick={onCancel} style={styles.btnSmall} title="Cancel">
          ⨯
        </button>
      </div>
    </div>
  );
}

/** Render whitespace and other invisibles in a readable form so the
 *  modal doesn't display a misleading blank cell for a rule whose
 *  trigger is just a space. */
function visualize(s: string): string {
  return s
    .replace(/ /g, "␣")
    .replace(/\t/g, "→")
    .replace(/\n/g, "↵");
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    background: "var(--scrim, rgba(0,0,0,0.4))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  panel: {
    minWidth: "780px",
    maxWidth: "92vw",
    maxHeight: "84vh",
    display: "flex",
    flexDirection: "column",
    padding: "1.25rem 1.5rem 1rem",
    background: "var(--bg-card)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    boxShadow: "var(--shadow, 0 12px 40px rgba(0,0,0,0.35))",
    overflow: "hidden",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.5rem",
  },
  heading: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  headerCount: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
  },
  hint: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    lineHeight: 1.45,
    margin: "0 0 0.6rem",
  },
  body: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
    minHeight: 0,
    flex: 1,
    overflow: "hidden",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    border: "1px solid var(--border-2)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  columnHeader: {
    padding: "0.4rem 0.65rem",
    background: "var(--bg-deep)",
    borderBottom: "1px solid var(--border-2)",
    fontSize: "0.78rem",
    fontWeight: 600,
  },
  scrollArea: {
    flex: 1,
    overflowY: "auto",
    padding: "0.55rem 0.7rem",
    minHeight: 0,
  },
  categoryBlock: {
    marginBottom: "0.7rem",
  },
  categoryLabel: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: "0.25rem",
  },
  ruleGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  ruleRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "0.4rem",
    padding: "3px 6px",
    borderRadius: "3px",
    fontSize: "0.78rem",
  },
  ruleRowEdit: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "0.4rem",
    padding: "3px 6px",
    borderRadius: "3px",
    fontSize: "0.78rem",
    background: "var(--bg)",
    border: "1px solid var(--accent, var(--primary))",
  },
  ruleCell: {
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    fontSize: "0.78rem",
    background: "var(--code-bg, rgba(127,127,127,0.12))",
    padding: "1px 5px",
    borderRadius: "3px",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  ruleArrow: {
    color: "var(--text-muted)",
    fontSize: "0.85rem",
  },
  rowActions: {
    display: "flex",
    gap: "3px",
    flexShrink: 0,
  },
  emptyState: {
    fontSize: "0.78rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "0.4rem 0",
  },
  addForm: {
    borderTop: "1px solid var(--border-2)",
    padding: "0.55rem 0.7rem",
    background: "var(--bg-deep)",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  addFormRow: {
    display: "grid",
    gridTemplateColumns: "60px 1fr",
    alignItems: "center",
    gap: "0.4rem",
  },
  fieldLabel: {
    fontSize: "0.78rem",
    color: "var(--text-2)",
    fontWeight: 500,
  },
  fieldInput: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "4px 7px",
    fontSize: "0.82rem",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    color: "var(--text)",
    outline: "none",
  },
  editInput: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "3px",
    padding: "2px 5px",
    fontSize: "0.78rem",
    fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
    color: "var(--text)",
    outline: "none",
    minWidth: 0,
  },
  addFormActions: {
    display: "flex",
    justifyContent: "flex-end",
  },
  error: {
    margin: "0.5rem 0 0",
    color: "var(--danger)",
    fontSize: "0.82rem",
    lineHeight: 1.4,
  },
  footer: {
    marginTop: "0.85rem",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  btnGhost: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
  },
  btnPrimary: {
    padding: "4px 12px",
    fontSize: "0.82rem",
    cursor: "pointer",
    background: "var(--primary)",
    color: "var(--on-primary, #fff)",
    border: "1px solid var(--primary)",
    borderRadius: "4px",
    fontWeight: 600,
  },
  btnSmall: {
    padding: "0 6px",
    fontSize: "0.85rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--text-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "3px",
    minWidth: "22px",
    height: "22px",
  },
  btnDanger: {
    padding: "0 6px",
    fontSize: "0.95rem",
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
    color: "var(--danger)",
    border: "1px solid var(--border-2)",
    borderRadius: "3px",
    minWidth: "22px",
    height: "22px",
  },
};
