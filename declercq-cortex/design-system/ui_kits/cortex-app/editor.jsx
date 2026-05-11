/* Cortex editor body — demonstrates prose, code blocks, typed blocks, tables, marks */

function Editor() {
  return (
    <main className="editorPane">
      <div className="prose">
        <h1>2026-05-10 · Daily log</h1>
        <p>Spent the morning on <a className="wikilink" href="#">[[exp-014 yield optimization]]</a>. New primer set arrived; setting up the assay block now. <mark className="mark-y">weekly review</mark> material.</p>

        <h2>Plan</h2>
        <p>Run iter-3 with the new primers, then move on to the cofactor concentration sweep. Block the afternoon for write-up.</p>

        <h3>References</h3>
        <ul style={{marginTop:6,paddingLeft:20,fontSize:"0.95rem",lineHeight:1.65,color:"var(--text-2)"}}>
          <li><a className="wikilink" href="#">[[Methods/PCR · primer redesign]]</a></li>
          <li><a className="wikilink" href="#">[[Protocols/qPCR — block A baseline]]</a></li>
          <li>External: <a href="#">https://doi.org/10.xx/yyy</a></li>
        </ul>

        <div className="typed">
          <div className="h">Iteration · iter-3</div>
          <div className="b">
            Spiked qPCR with the new primer set. <mark className="mark-b">concept inbox</mark> note: cofactor saturation may explain the plateau in iter-2. <mark className="mark-r">bottleneck</mark> — block A reagents shipping next Monday.
          </div>
          <div className="end"/>
        </div>

        <h2>Yield comparison</h2>
        <table>
          <thead><tr><th>iter</th><th>condition</th><th>yield</th><th>note</th></tr></thead>
          <tbody>
            <tr><td>iter-1</td><td>baseline</td><td>1.0×</td><td>—</td></tr>
            <tr><td>iter-2</td><td>+ cofactor (5 mM)</td><td>1.2×</td><td>plateau at 25 cycles</td></tr>
            <tr><td>iter-3</td><td>new primer</td><td>1.4×</td><td><mark className="mark-y">weekly</mark></td></tr>
          </tbody>
        </table>

        <h2>Snippet</h2>
        <pre><span className="lang">python</span>{`# cluster 26 — splash entry
def render_brain(scene, t):
    scene.brain.rotation.y += 0.0021
    return scene`}</pre>

        <blockquote>
          The notebook is the scientist. — note to self, last quarter
        </blockquote>

        <h2>Tomorrow</h2>
        <p><mark className="mark-p">tomorrow's daily</mark>: write up iter-3 results · re-read <code>protocols/qPCR-block-A.md</code> · queue the cofactor sweep.</p>
      </div>
    </main>
  );
}

Object.assign(window, { Editor });
