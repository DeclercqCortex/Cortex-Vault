// DEPRECATED — replaced by typedBlock node (Cluster 17). See:
//   - src/editor/TypedBlockNode.tsx
//   - src/editor/TypedBlockSerializer.ts
//   - src/editor/TypedBlockTransform.ts
// No live import path; this stub exists only so old build artefacts
// that referenced the symbol do not error during incremental rebuilds.

import { Extension } from "@tiptap/core";

/** @deprecated Use SerializingTypedBlockNode. */
export const ExperimentBlockDecoration = Extension.create({
  name: "experimentBlockDecoration_deprecated",
});
