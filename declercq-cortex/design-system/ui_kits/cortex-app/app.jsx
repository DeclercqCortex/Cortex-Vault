/* Cortex UI kit — root app */

const { useState } = React;

function App() {
  const [view, setView] = useState("app"); // app | welcome | modal | cmd | splash

  return (
    <>
      <div className="appShell" data-screen-label="Cortex desktop window">
        <EditorToolbar
          onOpenCmd={()=>setView("cmd")}
          onOpenModal={()=>setView("modal")}
        />
        <div className="layoutRow">
          <Sidebar/>
          <div className="mainCol">
            <div className="mainTopBar">
              <span className="crumbs">~/vault / <b>02-Daily Log</b> / <b>2026-05-10.md</b></span>
              <span className="ind" title="Unsaved changes"/>
              <span style={{marginLeft:"auto"}}>1 of 4 panes</span>
            </div>
            <div className="gridArea">
              <Editor/>
            </div>
            <StatusBar/>
          </div>
        </div>
      </div>

      {view==="welcome" && <Welcome onPick={()=>setView("app")}/>}
      {view==="modal" && <Modal onClose={()=>setView("app")}/>}
      {view==="cmd" && <CommandPalette onClose={()=>setView("app")}/>}
      {view==="splash" && <Splash onDone={()=>setView("app")}/>}

      <div className="kitTabs">
        {[
          ["app","Main window"],
          ["welcome","Welcome"],
          ["cmd","Command palette"],
          ["modal","Modal"],
          ["splash","Splash"],
        ].map(([k,l])=>
          <button key={k} className={view===k?"act":""} onClick={()=>setView(k)}>{l}</button>
        )}
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
