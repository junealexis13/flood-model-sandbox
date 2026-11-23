import { useEffect, useState } from "react";
import katex from "katex";
import { X } from "lucide-react";
import "katex/dist/katex.min.css";

interface FlowTechDocProps {
  onClose: () => void;
}

type TabId = "equations" | "parameters" | "comparison" | "references";

const TABS: { id: TabId; label: string }[] = [
  { id: "equations", label: "Shallow water" },
  { id: "parameters", label: "Parameters" },
  { id: "comparison", label: "HAND vs 3D Flow" },
  { id: "references", label: "References" },
];

export function FlowTechDoc({ onClose }: FlowTechDocProps) {
  const [tab, setTab] = useState<TabId>("equations");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#121816]/75 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="flow-tech-doc-title"
        className="flex max-h-[min(860px,calc(100vh-1.5rem))] w-[min(920px,100%)] flex-col overflow-hidden border border-[#e4d8c4] bg-paper text-ink shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e4d8c4] px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-tide">Technical Documentation</p>
            <h2 id="flow-tech-doc-title" className="font-display text-3xl leading-none">
              2D Hydrodynamic Flow Simulation
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
              Unsteady shallow-water flood routing executed with the ANUGA finite-volume solver over an unstructured
              triangular terrain mesh and rendered interactively in WebGL.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-ink"
            onClick={onClose}
          >
            <X size={16} /> Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#e4d8c4] px-3 py-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r sm:px-2 sm:py-3"
            aria-label="Flow simulation documentation sections"
          >
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`shrink-0 px-3 py-2 text-left text-sm sm:w-full ${
                  tab === item.id ? "bg-white font-medium text-ink" : "text-stone-600 hover:bg-white/60"
                }`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:min-h-[28rem]">
            {tab === "equations" && <EquationsTab />}
            {tab === "parameters" && <ParametersTab />}
            {tab === "comparison" && <ComparisonTab />}
            {tab === "references" && <ReferencesTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function EquationsTab() {
  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <p>
        Unlike static stage-based mapping, the 3D Flow Simulation integrates the depth-averaged{" "}
        <strong>2D Shallow Water Equations (SWE)</strong> forward in time. Water enters as direct rainfall across the
        terrain surface, accelerates downslope under gravity, slows under bed friction, pools in depressions, and
        propagates dynamically along drainage channels.
      </p>

      <h3 className="font-display text-2xl text-ink">Governing Conservation Laws</h3>
      <p>
        In conservative form, ANUGA tracks water surface stage <span className="font-mono text-xs">w = z + h</span>{" "}
        (bed elevation plus depth) and horizontal momentum fluxes{" "}
        <span className="font-mono text-xs">(uh, vh)</span> across every triangular control volume:
      </p>
      <Formula tex="\begin{aligned} \frac{\partial h}{\partial t} + \frac{\partial (uh)}{\partial x} + \frac{\partial (vh)}{\partial y} &= R \\ \frac{\partial (uh)}{\partial t} + \frac{\partial}{\partial x}\!\left(u^2 h + \frac{1}{2}gh^2\right) + \frac{\partial (uvh)}{\partial y} &= -gh\left(\frac{\partial z}{\partial x} + S_{fx}\right) \\ \frac{\partial (vh)}{\partial t} + \frac{\partial (uvh)}{\partial x} + \frac{\partial}{\partial y}\!\left(v^2 h + \frac{1}{2}gh^2\right) &= -gh\left(\frac{\partial z}{\partial y} + S_{fy}\right) \end{aligned}" />
      <p>
        Here <em className="font-serif">R</em> is uniform rainfall rate (m/s),{" "}
        <em className="font-serif">g</em> is gravitational acceleration, and the bed friction slopes{" "}
        <span className="font-mono text-xs">S_fx, S_fy</span> are evaluated from Manning&apos;s resistance law:
      </p>
      <Formula tex="S_{fx} = \frac{n^2\, u\sqrt{u^2 + v^2}}{h^{4/3}}, \qquad S_{fy} = \frac{n^2\, v\sqrt{u^2 + v^2}}{h^{4/3}}" />

      <h3 className="font-display text-2xl text-ink">Projection, Meshing &amp; Rendering</h3>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>Automatic UTM reprojection:</strong> Geographic rasters (e.g. EPSG:4326) are reprojected to the
          centroid&apos;s metric UTM zone before constructing the unstructured triangular mesh so slopes, areas, and
          velocities are physically accurate.
        </li>
        <li>
          <strong>Float32 precision centering:</strong> Vertex coordinates are shifted to local meters around the
          mesh centroid for jitter-free WebGL rendering while preserving the exact UTM origin for point inspection.
        </li>
        <li>
          <strong>Sharp wet/dry shoreline:</strong> Water fragments shallower than{" "}
          <span className="font-mono text-xs">0.005 m</span> are clipped in the fragment shader so dry hillslopes show
          unobscured terrain elevation shading.
        </li>
      </ul>
    </article>
  );
}

function ParametersTab() {
  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <h3 className="font-display text-2xl text-ink">Rainfall Intensity &amp; Duration</h3>
      <p>
        A spatially uniform rainfall rate (mm/hr) is applied continuously as a mass source term over the chosen
        duration. Total cumulative rainfall depth equals{" "}
        <span className="font-mono text-xs">intensity × duration / 60</span>. The <strong>Frame step</strong> sets
        how frequently snapshots of stage, depth, and flow velocity are yielded to the 3D timeline.
      </p>

      <h3 className="font-display text-2xl text-ink">Manning&apos;s Roughness (n)</h3>
      <p>
        Manning&apos;s <em className="font-serif">n</em> parameterizes hydraulic drag from ground surfaces and
        vegetation. Lower values let runoff accelerate rapidly into valleys; higher values slow overland sheet flow
        and increase transient ponding depths on slopes.
      </p>
      <div className="overflow-x-auto border border-[#e4d8c4] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Preset</th>
              <th className="px-3 py-2 font-medium">Manning&apos;s n</th>
              <th className="px-3 py-2 font-medium">Typical surface</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 text-ink">Urban</td>
              <td className="px-3 py-2 font-mono">0.020</td>
              <td className="px-3 py-2">Paved streets, bare concrete, smooth channels</td>
            </tr>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 text-ink">Floodplain</td>
              <td className="px-3 py-2 font-mono">0.035</td>
              <td className="px-3 py-2">Agricultural fields, short pasture, earth channels</td>
            </tr>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 text-ink">Vegetated</td>
              <td className="px-3 py-2 font-mono">0.060</td>
              <td className="px-3 py-2">Dense brush, tree cover, irregular natural terrain</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="font-display text-2xl text-ink">Mesh Resolution &amp; Boundaries</h3>
      <p>
        <strong>Auto resolution</strong> sizes triangles to produce ~5,500 cells for fast turnaround. Specifying a
        smaller <strong>Custom max triangle area (m²)</strong> resolves narrow gullies and roads more sharply at the
        cost of longer solver runtimes (capped at 50,000 triangles).
      </p>
      <p>
        <strong>Open Outflow</strong> applies a free Dirichlet boundary so flood waves drain freely across the edges
        of the DEM. <strong>Closed Basin</strong> applies reflective walls along all edges, retaining 100% of rainfall
        inside the domain—useful for enclosed catchments or checking total volume conservation.
      </p>
    </article>
  );
}

function ComparisonTab() {
  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <p>
        Both tools inside this sandbox complement each other: use <strong>HAND Flood Extent</strong> for rapid
        scenario screening across rainfall and land-cover curve numbers, and switch to{" "}
        <strong>3D Flow Simulation</strong> when flow timing, overland pathways, velocities, or momentum matter.
      </p>

      <div className="overflow-x-auto border border-[#e4d8c4] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Aspect</th>
              <th className="px-3 py-2 font-medium">HAND Flood Extent</th>
              <th className="px-3 py-2 font-medium">3D Flow Simulation (ANUGA)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 font-medium text-ink">Physics</td>
              <td className="px-3 py-2">Static topographic stage–storage + SCS-CN runoff</td>
              <td className="px-3 py-2">Unsteady 2D Shallow Water Equations (mass + momentum)</td>
            </tr>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 font-medium text-ink">Time &amp; velocity</td>
              <td className="px-3 py-2">Equilibrium snapshot; no velocity field</td>
              <td className="px-3 py-2">Time-varying flood wave arrival, depth, and flow speed (m/s)</td>
            </tr>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 font-medium text-ink">Interactivity</td>
              <td className="px-3 py-2">Instant slider updates in browser (zero wait)</td>
              <td className="px-3 py-2">Server-side PDE solve (seconds–minutes), then interactive 3D playback</td>
            </tr>
            <tr className="border-t border-[#e4d8c4]">
              <td className="px-3 py-2 font-medium text-ink">Best for</td>
              <td className="px-3 py-2">Wide-area sensitivity scans, rapid damage screening</td>
              <td className="px-3 py-2">Drainage bottlenecks, flash-flood timing, flow hazard (depth × speed)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ReferencesTab() {
  return (
    <article className="space-y-4">
      <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-relaxed text-stone-700">
        <li>
          Roberts, S., Nielsen, O., Gray, D., Sexton, J., &amp; Davies, G. (2015).{" "}
          <em>ANUGA User Manual</em>. Geoscience Australia &amp; Australian National University.{" "}
          <a
            href="https://github.com/anuga-community/anuga_core"
            target="_blank"
            rel="noreferrer"
            className="text-tide underline decoration-tide/30 underline-offset-2"
          >
            github.com/anuga-community/anuga_core
          </a>
        </li>
        <li>
          Nielsen, O., Roberts, S., Gray, D., McPherson, A., &amp; Hitchman, A. (2005). Hydrodynamic modelling of
          coastal inundation. In <em>MODSIM 2005 International Congress on Modelling and Simulation</em> (pp.
          518–523).
        </li>
        <li>
          Kurganov, A., &amp; Petrova, G. (2007). A second-order well-balanced positivity preserving central-upwind
          scheme for the Saint-Venant system. <em>Communications in Mathematical Sciences, 5</em>(1), 133–160.
        </li>
        <li>
          Chow, V. T. (1959). <em>Open-channel hydraulics</em>. McGraw-Hill.
        </li>
      </ol>
    </article>
  );
}

function Formula({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, {
    displayMode: true,
    throwOnError: false,
    output: "html",
  });
  return (
    <div
      className="overflow-x-auto border border-[#e4d8c4] bg-white px-4 py-3 text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
