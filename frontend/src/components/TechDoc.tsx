import { useEffect, useState } from "react";
import katex from "katex";
import { X } from "lucide-react";
import { COVERS, cnForAmc, scsRunoffMm } from "../utils/hydrology";
import "katex/dist/katex.min.css";

interface TechDocProps {
  onClose: () => void;
}

type TabId = "theory" | "parameters" | "cover" | "limits" | "references";

const TABS: { id: TabId; label: string }[] = [
  { id: "theory", label: "Theory" },
  { id: "parameters", label: "Parameters" },
  { id: "cover", label: "Land cover" },
  { id: "limits", label: "Limits" },
  { id: "references", label: "References" },
];

const TR55: Record<string, string> = {
  woods: "Woods, good hydrologic condition",
  pasture: "Pasture, grassland, or range, fair condition",
  crops: "Row crops, straight row, good hydrologic condition",
  residential: "Residential, 1/8 acre lots or less",
  urban: "Commercial and business",
};

export function TechDoc({ onClose }: TechDocProps) {
  const [tab, setTab] = useState<TabId>("theory");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#121816]/75 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tech-doc-title"
        className="flex max-h-[min(860px,calc(100vh-1.5rem))] w-[min(920px,100%)] flex-col overflow-hidden border border-[#e4d8c4] bg-paper text-ink shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e4d8c4] px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-tide">Technical Documentation</p>
            <h2 id="tech-doc-title" className="font-display text-3xl leading-none">
              Flood Extent and Depth Computation
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600">
              Storm rainfall depth and a runoff curve number are resolved into a single water-surface stage. Terrain
              cells situated at or below this stage are shaded according to inundation depth. All literature cited is
              listed under References in APA 7th edition format.
            </p>
          </div>
          <button type="button" className="inline-flex items-center gap-1 text-sm text-stone-500" onClick={onClose}>
            <X size={16} /> Close
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#e4d8c4] px-3 py-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r sm:px-2 sm:py-3"
            aria-label="Note sections"
          >
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`shrink-0 px-3 py-2 text-left text-sm sm:w-full ${tab === item.id ? "bg-white text-ink" : "text-stone-600"}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:min-h-[28rem]">
            {tab === "theory" && <Theory />}
            {tab === "parameters" && <Parameters />}
            {tab === "cover" && <LandCover />}
            {tab === "limits" && <Limits />}
            {tab === "references" && <References />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Theory() {
  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <p>
        This modeling sandbox integrates terrain analysis with rainfall–runoff estimation. A user-specified storm
        rainfall depth is converted into an excess runoff volume, which is then matched against the pre-computed
        stage–storage curve of the scene to determine a single equilibrium water-surface stage. Every grid cell whose
        Height Above the Nearest Drainage (HAND) is less than or equal to this stage is rendered on the map, with its
        color indicating local inundation depth.
      </p>
      <HandSketch />
      <p>
        Cells situated above the computed water stage remain unshaded so that the underlying satellite imagery stays
        visible. The color scale below the map corresponds to water depth: pale teal represents shallow sheet flow of a
        few tens of centimeters, whereas deep navy indicates inundation several meters deep. Clicking any pixel on the
        map inspects its native HAND value and, where submerged, its corresponding water depth.
      </p>

      <h3 className="font-display text-2xl text-ink">Height Above the Nearest Drainage (HAND)</h3>
      <p>
        For any given terrain cell, HAND represents the vertical elevation drop from that cell down to the specific
        stream cell where its surface flow path terminates (Nobre et al., 2011; Rennó et al., 2008). Along the
        delineated channel network itself, HAND equals zero; any negative values resulting from terrain artifacts are
        clipped to zero.
      </p>
      <Formula tex="\begin{aligned} \mathrm{HAND}(c) &= Z(c) - Z(s(c)) \\ d(c) &= \max\bigl(h - \mathrm{HAND}(c),\, 0\bigr) \end{aligned}" />
      <p>
        Here, <em className="font-serif">Z</em> denotes the hydrologically conditioned elevation, and{" "}
        <em className="font-serif">s(c)</em> identifies the first stream cell encountered along the downstream drainage
        path from cell <em className="font-serif">c</em>. A cell is classified as inundated whenever its HAND value does
        not exceed the water stage <em className="font-serif">h</em>, with local water depth{" "}
        <em className="font-serif">d(c)</em> equal to their difference (Nobre et al., 2016; Zheng et al., 2018). While
        HAND serves as an efficient topographic proxy for flood extent, projecting a uniform horizontal water surface
        across a basin omits hydrodynamic effects such as backwater propagation, flow momentum, and hydraulic control
        structures accounted for in full shallow-water models (Garousi-Nejad et al., 2019; Nobre et al., 2016).
      </p>

      <h3 className="font-display text-2xl text-ink">Terrain Conditioning from a Raw DEM</h3>
      <p>
        When a raw Digital Elevation Model (DEM) is uploaded, it undergoes a seven-stage hydrological conditioning
        sequence implemented via <code className="text-xs">pysheds 0.5</code> (Bartos, 2025), following standard raster
        drainage extraction conventions (Jenson & Domingue, 1988):
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          <strong>Pit filling:</strong> Single-cell topographic pits are raised to the elevation of their lowest
          adjacent neighbor.
        </li>
        <li>
          <strong>Depression filling:</strong> Multi-cell sinks are filled up to their spill elevation using a
          priority-flood algorithm (Barnes et al., 2014) to ensure continuous surface drainage toward the scene
          boundary.
        </li>
        <li>
          <strong>Flat resolution:</strong> Zero-slope regions lacking a downhill neighbor are assigned an artificial
          gradient of 1 mm per cell toward a pour point so drainage directions remain well-defined, following the
          principles established by Garbrecht and Martz (1997).
        </li>
        <li>
          <strong>D8 flow direction:</strong> Surface flow from each cell is routed to the single neighbor exhibiting
          the steepest descent, weighting diagonal steps by <span className="font-mono text-xs">√2</span> (O’Callaghan &
          Mark, 1984).
        </li>
        <li>
          <strong>D8 flow accumulation:</strong> Upslope contributing area is quantified by counting all upstream cells
          draining into each cell, inclusive of the cell itself.
        </li>
        <li>
          <strong>Stream network delineation:</strong> Cells whose flow accumulation meets or exceeds the drainage
          threshold (1 km² by default) are designated as stream channels. This threshold governs channel initiation
          only; all valid terrain cells are retained in the domain.
        </li>
        <li>
          <strong>HAND derivation:</strong> Each cell’s HAND value is computed as the elevation difference between the
          conditioned cell and the first stream cell along its flow path.
        </li>
      </ol>
      <p>
        If a pre-computed HAND GeoTIFF is uploaded instead, these conditioning steps are bypassed. The supplied raster
        values are ingested directly (with negative values clipped to zero), and the stream accumulation threshold is
        not applied.
      </p>

      <h3 className="font-display text-2xl text-ink">Uniform Scene Stage and Hypsometric Integration</h3>
      <p>
        At any water stage <em className="font-serif">h</em>, total inundated area and cumulative storage volume are
        evaluated as discrete integrals across the HAND grid. Pixel dimensions{" "}
        <span className="font-mono text-xs">Δx</span> and <span className="font-mono text-xs">Δy</span> are measured in
        meters within the Universal Transverse Mercator (UTM) zone corresponding to the raster centroid. Because Web
        Mercator introduces substantial area distortion away from the equator (Battersby et al., 2014; Snyder, 1987),
        all volume calculations are executed on the native metric grid, while the Web Mercator layer serves strictly
        for map visualization.
      </p>
      <Formula tex="\begin{aligned} A(h) &= N(\mathrm{HAND} \le h)\cdot \Delta x \cdot \Delta y \\ V(h) &= \sum_i \max(h - \mathrm{HAND}_i,\, 0)\cdot \Delta x \cdot \Delta y \end{aligned}" />
      <p>
        Total contributing basin area encompasses all valid cells within the scene, including uplands. Storage volumes
        are tabulated from 0 m to 15 m at 0.05 m increments. At runtime, the browser locates the two tabulated rows
        bracketing the computed runoff volume and linearly interpolates both stage and flooded area across that 5 cm
        interval. This single equilibrium stage is applied uniformly across the scene. While advanced HAND implementations
        incorporate reach-by-reach stage routing via synthetic rating curves and Manning’s equation (Garousi-Nejad et
        al., 2019; Zheng et al., 2018), this sandbox adopts the lumped single-stage formulation for rapid scenario
        testing.
      </p>

      <h3 className="font-display text-2xl text-ink">Application to Philippine Agricultural Flood Assessment</h3>
      <p>
        In the Philippines, post-disaster flood and drought losses in rice production still rely heavily on ground-based
        administrative reports. While satellite Earth Observation can delineate flood extent, estimating inundation depth
        in near real time remains challenging (Araza & Alosnos, 2026). In their assessment of Typhoon Odette in Iloilo,
        Araza and Alosnos noted that discrepancies between remote-sensing estimates and provincial damage reports
        hinged largely on water depth and crop phenology—specifically, extensive areas of rice at the seedling stage
        submerged under less than 0.5 m of water. The 0.05 m vertical resolution of the stage–storage curve in this tool
        is designed to resolve shallow inundation within that critical agronomic range.
      </p>
      <p>
        This application generates the physical water-depth field that downstream agricultural impact models require,
        while deliberately excluding rice crop masks, phenological stages, damage functions, and economic valuation
        tables. The built-in sample dataset uses a clipped DEM of San Miguel, Bulacan. Across published evaluations,
        HAND-derived flood extents generally agree well with observed high-water marks and satellite flood maps in
        confined valleys, though accuracy decreases in low-relief floodplains; furthermore, the chosen stream network
        density influences predicted extent nearly as much as spatial grid resolution (Patel et al., 2026).
      </p>
    </article>
  );
}

function Parameters() {
  const exampleS = 25400 / 80 - 254;
  const exampleIa = 0.2 * exampleS;
  const exampleQ = scsRunoffMm(100, 80);
  const dry = cnForAmc(80, "I");
  const wet = cnForAmc(80, "III");

  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <p>
        Adjustments to storm rainfall, land cover, antecedent moisture, and the curve number execute locally within the
        browser without triggering server requests. Conversely, the stream accumulation threshold is saved for subsequent
        raw DEM uploads and is applied only during initial terrain preprocessing.
      </p>

      <h3 className="font-display text-2xl text-ink">Storm Rainfall (P)</h3>
      <p>
        Rainfall <em className="font-serif">P</em> represents cumulative storm depth in millimeters, adjustable from 0 to
        450 mm and applied uniformly across the scene. The control specifies total event rainfall without temporal
        hyetograph distribution or dynamic infiltration losses beyond those parameterized by the curve number.
      </p>

      <h3 className="font-display text-2xl text-ink">SCS Curve Number (CN) and Direct Runoff</h3>
      <p>
        Direct runoff depth is estimated using the Soil Conservation Service (SCS) Curve Number method, now maintained
        by the USDA Natural Resources Conservation Service (USDA, SCS, 1972; USDA, NRCS, 2004). Expressed in
        millimeters, potential maximum retention <em className="font-serif">S</em>, initial abstraction{" "}
        <em className="font-serif">Iₐ</em>, direct runoff depth <em className="font-serif">Q</em>, and total inflow
        volume <em className="font-serif">V</em> are governed by:
      </p>
      <Formula tex="\begin{aligned} S &= \frac{25400}{\mathrm{CN}} - 254 \\ I_a &= 0.2\,S \\ Q &= \frac{(P - I_a)^{2}}{P + 0.8\,S} && \text{when } P > I_a,\ \text{else } 0 \\ V &= \frac{Q}{1000}\times\text{basin area} \end{aligned}" />
      <p>
        For instance, at <span className="font-mono text-xs">CN = 80</span> and{" "}
        <span className="font-mono text-xs">P = 100 mm</span>, potential retention <em className="font-serif">S</em>{" "}
        equals {exampleS.toFixed(1)} mm and initial abstraction <em className="font-serif">Iₐ</em> equals{" "}
        {exampleIa.toFixed(1)} mm, yielding {exampleQ.toFixed(3)} mm of direct runoff. Converting this runoff depth to
        meters and multiplying by the contributing basin area gives the total water volume routed onto the HAND
        surface, which in turn determines the equilibrium flood stage on the stage–storage curve.
      </p>
      <p>
        The curve number slider spans 35 to 98. Higher curve numbers signify lower soil infiltration capacity, reduced
        initial abstraction, greater runoff volume, and consequently a higher flood stage and wider inundation extent.
        Whenever storm rainfall <em className="font-serif">P</em> remains at or below <em className="font-serif">Iₐ</em>,
        direct runoff is zero and the terrain remains unflooded.
      </p>
      <p>
        Initial abstraction is fixed at 20% of potential retention (<span className="font-mono text-xs">Iₐ = 0.2S</span>
        ), consistent with the standard SCS formulation under which published curve number tables were calibrated (USDA,
        SCS, 1972). Although subsequent empirical studies suggest <span className="font-mono text-xs">Iₐ = 0.05S</span>{" "}
        may better represent certain gauged catchments (Woodward et al., 2003), retaining the 0.2 ratio maintains
        compatibility with standard TR-55 curve number values (Hawkins et al., 2009).
      </p>

      <h3 className="font-display text-2xl text-ink">Antecedent Moisture Conditions (AMC)</h3>
      <p>
        Standard reference curve numbers correspond to average soil moisture conditions, designated as AMC II (Hawkins et
        al., 2009; USDA, NRCS, 2004). Dry antecedent conditions (AMC I) and wet or near-saturated conditions (AMC III)
        are derived using the continuous algebraic conversions of Chow et al. (1988):
      </p>
      <Formula tex="\begin{aligned} \mathrm{CN}_{\mathrm{I}} &= \frac{4.2\,\mathrm{CN}_{\mathrm{II}}}{10 - 0.058\,\mathrm{CN}_{\mathrm{II}}} \\ \mathrm{CN}_{\mathrm{III}} &= \frac{23\,\mathrm{CN}_{\mathrm{II}}}{10 + 0.13\,\mathrm{CN}_{\mathrm{II}}} \end{aligned}" />
      <p>
        Starting from a baseline <span className="font-mono text-xs">CN_II = 80</span>, switching to dry conditions
        reduces the curve number to {dry.toFixed(1)}, whereas wet conditions elevate it to {wet.toFixed(1)}. The
        interface sets the moisture state directly rather than relying on legacy five-day antecedent rainfall thresholds,
        which were derived from limited regional data and are no longer recommended in modern practice (Hawkins et al.,
        2009). Selecting a land-cover preset or moisture state populates the slider with the corresponding rounded
        curve number, which can then be fine-tuned manually.
      </p>

      <h3 className="font-display text-2xl text-ink">Drainage Accumulation Threshold</h3>
      <p>
        Any terrain cell whose upstream contributing count equals or exceeds <em className="font-serif">N</em> cells is
        classified as a stream channel, establishing the baseline elevation from which HAND is measured. This cell
        threshold relates directly to physical drainage area{" "}
        <span className="font-mono text-xs">A_km²</span> via:
      </p>
      <Formula tex="N = \max\left(1,\; \dfrac{A_{\mathrm{km}^{2}}\times 10^{6}}{\Delta x\,\Delta y}\right)" />
      <p>
        Here, <span className="font-mono text-xs">Δx</span> and <span className="font-mono text-xs">Δy</span> represent
        pixel dimensions in meters. Entering an explicit cell count overrides the area field. Specifying a larger
        threshold restricts stream initiation to major trunk channels, increasing HAND values along valley sides and
        yielding a narrower flood extent for a given stage. Conversely, a smaller threshold delineates dense headwater
        tributaries, lowering HAND values and expanding predicted inundation. Because drainage density affects HAND
        flood mapping on a scale comparable to DEM grid resolution (Patel et al., 2026), the 1 km² default should be
        treated as a baseline starting parameter.
      </p>
      <p>
        This threshold is evaluated strictly during raw DEM ingestion; an active scene retains its delineated stream
        network until a new DEM is uploaded. If the specified threshold exceeds the total number of pixels inside the
        processing window, no channels can be delineated and ingestion halts.
      </p>

      <h3 className="font-display text-2xl text-ink">Scene Windowing, Geodetic Pixel Area, and the 15 m Ceiling</h3>
      <p>
        To ensure smooth client-side rendering, scenes are bounded to a maximum of 2048 × 2048 cells. Rasters within
        this dimension are processed in full, whereas larger uploads present an interactive selection window (minimum
        16 × 16 cells) that can be dragged or defined numerically. The San Miguel, Bulacan sample measures 1,422 × 1,008
        pixels and therefore loads completely. When a larger DEM is cropped, flow accumulation and HAND are computed
        solely from terrain enclosed within the active window; runoff originating outside the window boundary is not
        routed inward, which can shift channel positions near the edges (Jenson & Domingue, 1988).
      </p>
      <p>
        Metric pixel dimensions are determined by projecting the raster centroid into its corresponding UTM zone,
        computed from centroid longitude <em className="font-serif">λ</em> as{" "}
        <span className="font-mono text-xs">⌊(λ + 180) / 6⌋ + 1</span>. For map display, the HAND grid is exported as a
        single-band Float32 Cloud-Optimized GeoTIFF (COG) reprojected into Web Mercator using nearest-neighbor
        resampling so cell values remain unaltered by spatial averaging (Cloud Optimized GeoTIFF contributors, n.d.).
        Map click queries sample this warped display layer and may differ from the native grid by at most one resampled
        pixel, whereas the stage–storage curve is always integrated directly on the native UTM grid.
      </p>
      <p>
        The pre-computed stage–storage table caps at an upper limit of 15 m. If extreme storm rainfall generates a runoff
        volume exceeding the basin’s 15 m storage capacity, the water stage clamps at 15 m and the readout panel flags
        that the ceiling has been reached.
      </p>
    </article>
  );
}

function LandCover() {
  const rows = COVERS.map((cover) => ({
    ...cover,
    tr55: TR55[cover.id] ?? cover.note,
    q: scsRunoffMm(100, cover.cn2),
    retention: 25400 / cover.cn2 - 254,
  }));
  const maxQ = Math.max(...rows.map((row) => row.q), 1);
  const woods = rows.find((row) => row.id === "woods") ?? rows[0];
  const urban = rows.find((row) => row.id === "urban") ?? rows[rows.length - 1];
  const crops = rows.find((row) => row.id === "crops") ?? rows[0];
  const ratio = woods.q > 0 ? urban.q / woods.q : 0;
  const woodsIa = 0.2 * woods.retention;
  const urbanIa = 0.2 * urban.retention;
  const cropsDry = cnForAmc(crops.cn2, "I");
  const cropsWet = cnForAmc(crops.cn2, "III");

  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-stone-700">
      <p>
        Selecting a land-cover preset assigns a uniform curve number across the entire active scene. Map colors continue
        to represent water depth, while the underlying HAND terrain grid and basemap remain unchanged.
      </p>
      <p>
        The five presets correspond to standard Hydrologic Soil Group B classifications published in Technical Release 55
        (USDA, SCS, 1986). Rather than serving as a spatially distributed land-use map, each preset parameterizes a
        lumped catchment response—applying a single representative curve number across channels, floodplains, and
        uplands alike. For heterogeneous watersheds containing mixed land uses, the curve number slider can be adjusted
        to reflect an area-weighted composite value (USDA, SCS, 1986).
      </p>

      <h3 className="font-display text-2xl text-ink">Runoff Response Across Land-Cover Presets</h3>
      <p>
        Under an identical 100 mm storm and average antecedent moisture (AMC II), direct runoff scales strongly with the
        curve number. The {urban.label.toLowerCase()} preset generates {ratio.toFixed(1)} times the runoff depth of the{" "}
        {woods.label.toLowerCase()} preset due to minimal surface retention. Because total runoff volume is the product
        of this depth and the fixed basin area, higher curve numbers drive the water level further up the stage–storage
        curve and expand the inundated footprint.
      </p>
      <div className="space-y-2 border border-[#e4d8c4] bg-white px-3 py-3">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-sm">
            <span className="text-ink">{row.label}</span>
            <span className="h-2 bg-[#e7f3f1]">
              <span className="block h-2 bg-tide" style={{ width: `${(row.q / maxQ) * 100}%` }} />
            </span>
            <span className="text-right font-mono text-xs text-ink">{row.q.toFixed(1)} mm</span>
          </div>
        ))}
        <p className="text-[11px] text-stone-500">
          Direct runoff depth at 100 mm rainfall, AMC II, Hydrologic Soil Group B (prior to manual slider adjustments).
        </p>
      </div>

      <h3 className="font-display text-2xl text-ink">Initial Abstraction and Runoff Thresholds</h3>
      <p>
        Land cover also governs the rainfall threshold required before surface runoff initiates, defined by initial
        abstraction (<span className="font-mono text-xs">Iₐ = 0.2S</span>). The {woods.label.toLowerCase()} preset (CN{" "}
        {woods.cn2}) absorbs the first {woodsIa.toFixed(0)} mm of rainfall; consequently, a 30 mm storm yields zero
        runoff and leaves the scene dry. By contrast, the {urban.label.toLowerCase()} preset (CN {urban.cn2}) has an
        initial abstraction of only {urbanIa.toFixed(0)} mm, so the same 30 mm rainfall already exceeds its retention
        threshold and generates measurable flooding.
      </p>

      <h3 className="font-display text-2xl text-ink">TR-55 Reference Classifications</h3>
      <div className="overflow-x-auto border border-[#e4d8c4] bg-white">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Preset</th>
              <th className="px-3 py-2 font-medium">TR-55 Cover Description</th>
              <th className="px-3 py-2 font-medium">CN II</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#e4d8c4]">
                <td className="px-3 py-2 text-ink">{row.label}</td>
                <td className="px-3 py-2">{row.tr55}</td>
                <td className="px-3 py-2 font-mono">{row.cn2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Hydrologic Soil Group B represents soils with moderate infiltration rates when thoroughly wetted. While soils
        belonging to Groups A, C, or D exhibit lower or higher runoff potential, any corresponding curve number from 35
        to 98 may be entered directly via the slider. For agricultural land, the {crops.label.toLowerCase()} preset
        uses CN {crops.cn2} (straight-row cultivation in good hydrologic condition on Soil Group B) rather than the
        contoured-row value of 75 so that the preset label aligns strictly with its TR-55 table entry.
      </p>

      <h3 className="font-display text-2xl text-ink">Sensitivity to Antecedent Moisture</h3>
      <p>
        Toggling between dry (AMC I) and wet (AMC III) moisture states preserves the selected land-cover class while
        adjusting its effective curve number. Under the {crops.label.toLowerCase()} preset (CN {crops.cn2}), dry soil
        conditions lower the curve number to CN {cropsDry.toFixed(0)}, whereas saturated ground raises it to CN{" "}
        {cropsWet.toFixed(0)}. Reduced soil storage under wet conditions converts a larger fraction of storm rainfall
        into runoff, elevating the equilibrium flood stage. The summary readout beside the map updates dynamically to
        reflect the resulting runoff depth, inflow volume, stage height, and inundated share of the scene.
      </p>
    </article>
  );
}

function Limits() {
  return (
    <article className="space-y-3 text-[15px] leading-relaxed text-stone-700">
      <p>The depth map is an input a loss calculation can use. Several things that would change a real flood are left out.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Rice loss, phenology, and damage curves (Araza & Alosnos, 2026) are not considered.
        </li>
        <li>
          One stage for the whole window leaves out reach-to-reach differences, bridges, and backwater (Garousi-Nejad et
          al., 2019; Zheng et al., 2018). There is no roughness and no discharge.
        </li>
        <li>A crop of a larger DEM drops the upstream area, so a channel that enters at the edge is too small (Jenson & Domingue, 1988).</li>
        <li>
          The stream threshold changes the map about as much as the cell size does (Patel et al., 2026). The default of 1
          km² is a starting value, and it should be chosen with the window.
        </li>
        <li>
          The curve number is lumped across the scene, soil group B unless the slider overrides it, and initial abstraction
          stays at 0.2 S (Hawkins et al., 2009; USDA, SCS, 1986).
        </li>
        <li>The storage table ends at 15 m. A larger inflow is held at that stage.</li>
      </ul>
    </article>
  );
}

function References() {
  return (
    <article className="space-y-4">
      <p className="text-[15px] leading-relaxed text-stone-700">
        This tool is not possible without the technical expertise and introduction to us by our DOST Balik Scientist 
        Dr. Arnan Araza and other papers mentioned below.
      </p>
      <ol className="list-decimal space-y-3 pl-5">
        {REFERENCES.map((item) => (
          <li key={item.body} className="text-[13px] leading-relaxed text-stone-700">
            <Rich text={item.body} />
            {item.href && (
              <>
                {" "}
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-tide underline decoration-tide/30 underline-offset-2"
                >
                  {item.href.replace(/^https:\/\//, "")}
                </a>
              </>
            )}
          </li>
        ))}
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

function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("*") && part.endsWith("*") ? <em key={index}>{part.slice(1, -1)}</em> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

function HandSketch() {
  return (
    <figure className="border border-[#e4d8c4] bg-white px-3 py-3">
      <svg viewBox="0 0 480 196" role="img" className="w-full" aria-label="Cross section of a valley. One horizontal water surface is the stage. HAND is the height of the ground above the channel. Depth is stage minus HAND.">
        <polygon points="16,44 96,88 168,136 304,136 386,84 464,36 464,168 16,168" fill="#e7e0d4" />
        <polygon points="108,96 168,136 304,136 367,96" fill="#0f766e" opacity="0.28" />
        <polyline
          points="16,44 96,88 168,136 304,136 386,84 464,36"
          fill="none"
          stroke="#1c1915"
          strokeWidth="2.25"
          strokeLinejoin="round"
        />
        <line x1="48" y1="96" x2="420" y2="96" stroke="#0f766e" strokeWidth="1.4" strokeDasharray="5 4" />
        <line x1="140" y1="136" x2="168" y2="136" stroke="#1c1915" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="140" y1="117" x2="140" y2="136" stroke="#1c1915" strokeWidth="1.4" />
        <polygon points="140,136 136,128 144,128" fill="#1c1915" />
        <line x1="140" y1="96" x2="140" y2="117" stroke="#0f766e" strokeWidth="1.4" />
        <polygon points="140,117 136,109 144,109" fill="#0f766e" />
        <line x1="236" y1="96" x2="236" y2="136" stroke="#9a3412" strokeWidth="1.4" />
        <polygon points="236,136 232,128 240,128" fill="#9a3412" />
        <text x="152" y="110" fill="#0f766e" fontSize="12" fontFamily="Outfit, sans-serif">
          depth
        </text>
        <text x="132" y="130" fill="#1c1915" fontSize="12" fontFamily="Outfit, sans-serif" textAnchor="end">
          HAND
        </text>
        <text x="244" y="120" fill="#9a3412" fontSize="12" fontFamily="Outfit, sans-serif">
          stage h
        </text>
        <text x="188" y="86" fill="#0f766e" fontSize="12" fontFamily="Outfit, sans-serif">
          water surface
        </text>
        <text x="236" y="158" fill="#57534e" fontSize="12" fontFamily="Outfit, sans-serif" textAnchor="middle">
          channel, HAND = 0
        </text>
        <text x="20" y="32" fill="#57534e" fontSize="12" fontFamily="Outfit, sans-serif">
          dry ground
        </text>
      </svg>
      <figcaption className="mt-1 text-xs leading-relaxed text-stone-500">
        A single horizontal water-surface stage governs the entire scene. Inundation depth at any submerged cell equals
        stage minus HAND, while terrain situated above the water line remains dry.
      </figcaption>
    </figure>
  );
}

const REFERENCES: { body: string; href?: string }[] = [
  {
    body: "Araza, A. B., & Alosnos, E. (2026). Advancing Earth Observation-based methods for rapid mapping and estimation of flood and drought impacts on rice production in the Philippines. *International Journal of Disaster Risk Reduction, 133*, Article 105979.",
    href: "https://doi.org/10.1016/j.ijdrr.2025.105979",
  },
  {
    body: "Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models. *Computers & Geosciences, 62*, 117–127.",
    href: "https://doi.org/10.1016/j.cageo.2013.04.024",
  },
  {
    body: "Bartos, M. (2025). *pysheds* (Version 0.5) [Computer software].",
    href: "https://github.com/mdbartos/pysheds",
  },
  {
    body: "Battersby, S. E., Finn, M. P., Usery, E. L., & Yamamoto, K. H. (2014). Implications of Web Mercator and its use in online mapping. *Cartographica, 49*(2), 85–101.",
    href: "https://doi.org/10.3138/carto.49.2.2313",
  },
  {
    body: "Chow, V. T., Maidment, D. R., & Mays, L. W. (1988). *Applied hydrology*. McGraw-Hill.",
  },
  {
    body: "Cloud Optimized GeoTIFF contributors. (n.d.). *Cloud Optimized GeoTIFF specification*.",
    href: "https://github.com/cogeotiff/cog-spec",
  },
  {
    body: "Garbrecht, J., & Martz, L. W. (1997). The assignment of drainage direction over flat surfaces in raster digital elevation models. *Journal of Hydrology, 193*(1–4), 204–213.",
    href: "https://doi.org/10.1016/S0022-1694(96)03138-1",
  },
  {
    body: "Garousi-Nejad, I., Tarboton, D. G., Aboutalebi, M., & Torres-Rua, A. F. (2019). Terrain analysis enhancements to the Height Above Nearest Drainage flood inundation mapping method. *Water Resources Research, 55*(10), 7983–8009.",
    href: "https://doi.org/10.1029/2019WR024837",
  },
  {
    body: "Hawkins, R. H., Ward, T. J., Woodward, D. E., & Van Mullem, J. A. (2009). *Curve number hydrology: State of the practice*. American Society of Civil Engineers.",
    href: "https://doi.org/10.1061/9780784410042",
  },
  {
    body: "Jenson, S. K., & Domingue, J. O. (1988). Extracting topographic structure from digital elevation data for geographic information system analysis. *Photogrammetric Engineering and Remote Sensing, 54*(11), 1593–1600.",
  },
  {
    body: "Nobre, A. D., Cuartas, L. A., Hodnett, M., Rennó, C. D., Rodrigues, G., Silveira, A., Waterloo, M., & Saleska, S. (2011). Height above the nearest drainage – A hydrologically relevant new terrain model. *Journal of Hydrology, 404*(1–2), 13–29.",
    href: "https://doi.org/10.1016/j.jhydrol.2011.03.051",
  },
  {
    body: "Nobre, A. D., Cuartas, L. A., Momo, M. R., Severo, D. L., Pinheiro, A., & Nobre, C. A. (2016). HAND contour: A new proxy predictor of inundation extent. *Hydrological Processes, 30*(2), 320–333.",
    href: "https://doi.org/10.1002/hyp.10581",
  },
  {
    body: "O’Callaghan, J. F., & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. *Computer Vision, Graphics, and Image Processing, 28*(3), 323–344.",
    href: "https://doi.org/10.1016/S0734-189X(84)80011-0",
  },
  {
    body: "Patel, K., Rajib, A., Biswas, N. K., Liu, Z., & Lofton, E. N. (2026). The HAND of flood mapping: Multi-dimensional evaluation across data-rich and data-poor basins using existing maps, ground observations, and remote sensing data. *Environmental Research Communications, 8*(5), Article 051008.",
    href: "https://doi.org/10.1088/2515-7620/ae6236",
  },
  {
    body: "Rennó, C. D., Nobre, A. D., Cuartas, L. A., Soares, J. V., Hodnett, M. G., Tomasella, J., & Waterloo, M. J. (2008). HAND, a new terrain descriptor using SRTM-DEM: Mapping terra-firme rainforest environments in Amazonia. *Remote Sensing of Environment, 112*(9), 3469–3481.",
    href: "https://doi.org/10.1016/j.rse.2008.03.018",
  },
  {
    body: "Snyder, J. P. (1987). *Map projections—A working manual* (Professional Paper No. 1395). U.S. Geological Survey.",
    href: "https://doi.org/10.3133/pp1395",
  },
  {
    body: "U.S. Department of Agriculture, Natural Resources Conservation Service. (2004). Estimation of direct runoff from storm rainfall. In *National engineering handbook* (Part 630, Chapter 10).",
  },
  {
    body: "U.S. Department of Agriculture, Soil Conservation Service. (1972). *National engineering handbook* (Section 4, Hydrology).",
  },
  {
    body: "U.S. Department of Agriculture, Soil Conservation Service. (1986). *Urban hydrology for small watersheds* (Technical Release No. 55, 2nd ed.).",
  },
  {
    body: "Woodward, D. E., Hawkins, R. H., Jiang, R., Hjelmfelt, A. T., Jr., Van Mullem, J. A., & Quan, Q. D. (2003). Runoff curve number method: Examination of the initial abstraction ratio. In P. Bizier & P. DeBarry (Eds.), *World Water & Environmental Resources Congress 2003*. American Society of Civil Engineers.",
    href: "https://doi.org/10.1061/40685(2003)308",
  },
  {
    body: "Zheng, X., Tarboton, D. G., Maidment, D. R., Liu, Y. Y., & Passalacqua, P. (2018). River channel geometry and rating curve estimation using height above the nearest drainage. *Journal of the American Water Resources Association, 54*(4), 785–806.",
    href: "https://doi.org/10.1111/1752-1688.12661",
  },
];