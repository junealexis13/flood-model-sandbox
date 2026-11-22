# Methods

This note describes the calculations in the HAND flood-extent sandbox: how a digital elevation model becomes a height-above-nearest-drainage (HAND) surface, how a rainfall depth becomes a runoff volume, and how that volume becomes one water-surface stage and a depth map. References follow the seventh edition of the *Publication Manual of the American Psychological Association*.

The sandbox is a terrain and runoff calculator. It is not a hydrodynamic model, and it does not estimate crop loss.

## Why a depth map

Flood and drought losses to rice in the Philippines are still taken largely from administrative reports. Extents of flood and drought can be drawn quickly from Earth observation, but the severity of the hazard is harder: flood inundation depth, and the intensity of an extreme drought, are not yet mapped in near real time at provincial scale (Araza & Alosnos, 2026). Araza and Alosnos combined a probabilistic treatment of that severity with rice phenology and damage curves, then with production costs and baseline yields, and estimated loss and damage from field up to the municipality and the province. For flooding associated with Typhoon Odette (Rai) in Iloilo they estimated damage to 9.3% of the rice area and losses of PHP 270.9 ± 0.8 million, against a provincial report of PHP 692 million. Much of that difference sits in the depth and the growth stage: 59% of the rice was at seedling stage and inundated by less than 0.5 m (Araza & Alosnos, 2026).

This application does not repeat that loss calculation. It does not ingest a rice mask, a phenology layer, a damage curve, or a cost table, and it does not reconstruct Typhoon Odette or the 2024 Iloilo drought. What it does compute is the depth field those damage curves consume. Given a digital elevation model, it builds HAND, turns a rainfall depth into a volume of excess rain with the curve-number method, and reads a single stage from the stage–storage curve of the scene. Depth in a cell is that stage minus HAND wherever HAND is between zero and the stage. The stage–storage table is sampled every 0.05 m, so depths of a few tens of centimetres are resolved, which is the range that mattered in the Odette rice estimate (Araza & Alosnos, 2026). The stage itself is one number for the whole scene. A forecast that varies by reach, which is what continental HAND flood mapping uses (Garousi-Nejad et al., 2019; Zheng et al., 2018), is a weaker assumption than the one made here.

HAND is used as a rapid substitute for a hydrodynamic model, not as a replacement for one. Across data-rich and data-poor basins, HAND extents agree reasonably with existing flood maps, high-water marks, and remote-sensing extents, and they are weaker in low-relief terrain. The density of the stream network changes those extents about as much as the resolution of the elevation model and the roughness of the channel (Patel et al., 2026). A uniform water surface laid on HAND also omits backwater, momentum, and structures that a shallow-water model would carry (Garousi-Nejad et al., 2019; Nobre et al., 2016).

## Height above the nearest drainage

HAND at a cell is the drop from that cell down to the channel cell its flow path reaches (Nobre et al., 2011; Rennó et al., 2008):

HAND(*c*) = *Z*(*c*) − *Z*(*s*(*c*))

where *Z* is elevation after the conditioning described below, and *s*(*c*) is the first stream cell on the downstream path from *c*. On the stream itself the value is zero. Negative values are clipped to zero. A cell is treated as inundated when its HAND is less than or equal to the stage, and its depth is the difference (Nobre et al., 2016; Zheng et al., 2018):

*d*(*c*) = max(*h* − HAND(*c*), 0)

That comparison is a proxy for inundation extent. It is not a solution of the shallow-water equations.

### Conditioning a raw elevation model

A raw DEM is processed in the order used by pysheds 0.5 (Bartos, 2025), which follows the usual raster-hydrology sequence (Jenson & Domingue, 1988):

1. One-cell pits are raised to the elevation of their lowest neighbour.
2. Larger depressions are filled to the spill elevation by a priority-flood (Barnes et al., 2014). Water can then leave every interior cell.
3. Flats, cells with no downhill neighbour, are given a slope of 1 mm per cell toward a pour point so that a flow direction is defined. This is an imposed gradient. It is not the two-phase flat-routing of Garbrecht and Martz (1997), which remains the reference method for assigning directions across flats.
4. Flow direction is D8: each cell drains to the neighbour with the steepest descent, and diagonal steps are longer by √2 (O'Callaghan & Mark, 1984).
5. Flow accumulation counts the cells upstream, including the cell itself (O'Callaghan & Mark, 1984).
6. Stream cells are those whose accumulation is at least a threshold. The default threshold is 1 km² of drainage area. The count of cells is

*N* = max(1, *A*km² × 10⁶ / (Δ*x* Δ*y*))

with Δ*x* and Δ*y* in metres. A cell count typed by the user replaces the area. The threshold decides which cells are channels. It does not skip cells in the scene. Every valid pixel is still assigned a HAND value.
7. HAND is the elevation drop along the D8 path to the first stream cell.

pysheds runs those steps when it imports. NumPy 2 removed `numpy.in1d`, which pysheds 0.5 still calls, so the process aliases that function to `numpy.isin` before import. If pysheds cannot be imported, the same seven steps run in NumPy. A HAND raster that the user uploads is not recomputed; the stream threshold is ignored and the supplied values are used, with negatives clipped to zero.

### What the 512-pixel limit is

The scene is at most 512 × 512 cells. A raster that is already that size or smaller is used in full. A larger raster must be cropped to a window no bigger than 512 × 512; the window can be smaller, down to 16 cells on a side. The cap is there so the browser can hold the grid. It is not a hydrologic length scale.

Cropping changes the hydrology. Accumulation and HAND are computed from the cells inside the window only. Area that drains into the window from outside it is missing, so a channel that enters through the edge is too small, and the streams move (Jenson & Domingue, 1988). The drainage-area threshold has to be read with that in mind. A threshold larger than the window’s own area finds no stream, and the API refuses the job. Stream density is a first-order control on a HAND flood map (Patel et al., 2026), so the threshold and the crop should be chosen together, not left at the default on a fragment of a basin.

### Pixel area

Volumes are not measured on the map. Web Mercator (EPSG:3857) does not preserve area, and the distortion grows with distance from the equator (Battersby et al., 2014; Snyder, 1987). The ground size of a pixel is taken from the Universal Transverse Mercator zone of the raster centroid. The zone number is ⌊(λ + 180) / 6⌋ + 1, and the EPSG code is 32600 plus that zone in the northern hemisphere and 32700 plus that zone in the southern hemisphere (Snyder, 1987). One column step and one row step of the source geotransform are transformed into that zone. Δ*x* and Δ*y* are the lengths of those steps, and the pixel area used for storage is their product. For a north-up projected raster the steps are perpendicular, so the product is the cell area.

The raster served to the map is a single-band float32 Cloud Optimized GeoTIFF (Cloud Optimized GeoTIFF contributors, n.d.), warped with nearest neighbour into EPSG:3857, or into EPSG:4326 if that warp fails. Nearest neighbour keeps HAND values from being averaged with their neighbours. A click on the map reads this warped grid, so the reported depth can differ from the native cell by one resampled pixel. The stage–storage curve is always integrated on the native grid.

## Stage and storage

At stage *h* the flooded area and the stored volume are the discrete integrals of the depth grid:

*A*(*h*) = *N*(HAND ≤ *h*) · Δ*x* · Δ*y*

*V*(*h*) = Σᵢ max(*h* − HANDᵢ, 0) · Δ*x* · Δ*y*

The sum is over valid cells. The basin area *A*basin is the area of those cells, uplands included, not only the channel. Stages run from 0 m to 15 m at a spacing of 0.05 m. Above 15 m the curve is not extended: extra volume stays at 15 m and the panel marks the stage as capped. Fifteen metres is the top of the table in this app. It is also, in the original HAND terrain classification, the upper bound of the shallow water-table class, with deep water table above that (Nobre et al., 2011), but the cap here is a table limit, not that classification.

The browser never asks the server for a new stage. Runoff volume is computed locally, then a binary search finds the two tabulated stages whose volumes bracket it, and stage and flooded area are linearly interpolated between those rows. On a tabulated stage the volume is the sum above. Between tabulated stages the interpolation treats *V* as linear in *h* over that 5 cm, which is an approximation to the piecewise-linear storage curve.

The water surface is level in HAND space: one stage for every cell that drains within the scene. Reach-by-reach stages, a synthetic rating curve, and Manning’s equation are the next step in the HAND flood-mapping literature (Garousi-Nejad et al., 2019; Zheng et al., 2018). They are not computed here. There is no roughness, no discharge, and no backwater.

## Runoff

Excess rainfall is the curve-number method of the U.S. Soil Conservation Service, now the Natural Resources Conservation Service (U.S. Department of Agriculture [USDA], Soil Conservation Service [SCS], 1972; USDA, Natural Resources Conservation Service [NRCS], 2004). In inches the retention is *S* = 1000/*CN* − 10. In millimetres, multiplying by 25.4,

*S* = 25400/*CN* − 254

Initial abstraction is one fifth of retention, the ratio the original tables were built with (USDA, SCS, 1972):

*I*a = 0.2 *S*

Runoff depth *Q* is zero when rainfall *P* does not exceed *I*a. Otherwise

*Q* = (*P* − 0.2*S*)² / (*P* + 0.8*S*)

with *P*, *S*, and *Q* in millimetres (USDA, NRCS, 2004). The volume poured onto the HAND surface is

*V*in = (*Q* / 1000) · *A*basin

in cubic metres. The same curve number is applied to the whole valid grid. That is the lumped-watershed assumption of Technical Release 55 (USDA, SCS, 1986), and it is a poor description of a scene that mixes channel, floodplain, and upland unless the user sets a curve number that represents that mix.

A later reanalysis found that *I*a = 0.05*S* fits many gauged watersheds better (Woodward et al., 2003). The published curve numbers were developed at 0.2, so changing only the ratio misuses the tables (Hawkins et al., 2009). This app keeps 0.2.

### Antecedent moisture

Tabulated curve numbers are for average antecedent moisture, called AMC II in the original handbook and antecedent runoff condition II later (Hawkins et al., 2009; USDA, NRCS, 2004). The dry and wet conversions used here are the algebraic fits of Chow et al. (1988) to the National Engineering Handbook table:

*CN*I = 4.2 *CN*II / (10 − 0.058 *CN*II)

*CN*III = 23 *CN*II / (10 + 0.13 *CN*II)

The slider chooses the condition directly. It does not look up the old five-day rainfall bins. Those bins came from a small set of watersheds and are no longer recommended (Hawkins et al., 2009).

### Cover presets

The five presets are entries for hydrologic soil group B in Technical Release 55 (USDA, SCS, 1986). They are not a soil map. Group B is a moderate infiltration class; groups A, C, and D have different numbers, and the user can type any curve number from 35 to 98.

| Cover in the panel | Condition in TR-55 | *CN*II |
| --- | --- | --- |
| Woods | Woods, good hydrologic condition | 55 |
| Pasture | Pasture, grassland, or range, fair condition | 69 |
| Row crops | Row crops, straight row, good hydrologic condition | 78 |
| Residential | Residential, 1/8 acre lots or less | 85 |
| Urban | Commercial and business | 92 |

Straight-row row crops in good condition on group B are 78. The contoured class in the same table is 75. The panel names the straight-row class so the number and the label match the table.

## Worked check

For *CN* = 80 and *P* = 100 mm, *S* = 25400/80 − 254 = 63.5 mm and *I*a = 12.7 mm. Then

*Q* = (100 − 12.7)² / (100 + 0.8 × 63.5) = 50.539 mm

which is the value the client returns. AMC I at the same *CN*II is 4.2 × 80 / (10 − 0.058 × 80) = 62.687, and AMC III is 23 × 80 / (10 + 0.13 × 80) = 90.196.

## Sample scene

The dataset shipped with the app is a synthetic valley of 210 rows by 168 columns at 30 m, written in UTM zone 51 N and centred near 121.25° E, 14.15° N so that a satellite basemap has a frame. It is not a survey of Laguna de Bay, and it is not a flood map of that coast. The committed HAND grid was produced with pysheds at the 1 km² stream threshold. Loading it does not recompute the terrain.

## What is left out

- Loss and damage to rice, phenology, and damage curves (Araza & Alosnos, 2026) are outside this calculation. The depth map is an input those methods can use.
- One stage for the whole window ignores reach-to-reach differences, bridges, and backwater (Garousi-Nejad et al., 2019; Zheng et al., 2018).
- A crop of a larger DEM drops the upstream area (Jenson & Domingue, 1988).
- The stream threshold changes the map about as much as the cell size does (Patel et al., 2026). The default of 1 km² is a starting value, not a calibrated channel network.
- Curve numbers are lumped, soil group B unless the user overrides them, and initial abstraction stays at 0.2*S* (Hawkins et al., 2009; USDA, SCS, 1986).
- The storage table ends at 15 m.

## References

Araza, A. B., & Alosnos, E. (2026). Advancing Earth Observation-based methods for rapid mapping and estimation of flood and drought impacts on rice production in the Philippines. *International Journal of Disaster Risk Reduction, 133*, Article 105979. https://doi.org/10.1016/j.ijdrr.2025.105979

Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models. *Computers & Geosciences, 62*, 117–127. https://doi.org/10.1016/j.cageo.2013.04.024

Bartos, M. (2025). *pysheds* (Version 0.5) [Computer software]. https://github.com/mdbartos/pysheds

Battersby, S. E., Finn, M. P., Usery, E. L., & Yamamoto, K. H. (2014). Implications of Web Mercator and its use in online mapping. *Cartographica, 49*(2), 85–101. https://doi.org/10.3138/carto.49.2.2313

Chow, V. T., Maidment, D. R., & Mays, L. W. (1988). *Applied hydrology*. McGraw-Hill.

Cloud Optimized GeoTIFF contributors. (n.d.). *Cloud Optimized GeoTIFF specification*. https://github.com/cogeotiff/cog-spec

Garbrecht, J., & Martz, L. W. (1997). The assignment of drainage direction over flat surfaces in raster digital elevation models. *Journal of Hydrology, 193*(1–4), 204–213. https://doi.org/10.1016/S0022-1694(96)03138-1

Garousi-Nejad, I., Tarboton, D. G., Aboutalebi, M., & Torres-Rua, A. F. (2019). Terrain analysis enhancements to the Height Above Nearest Drainage flood inundation mapping method. *Water Resources Research, 55*(10), 7983–8009. https://doi.org/10.1029/2019WR024837

Hawkins, R. H., Ward, T. J., Woodward, D. E., & Van Mullem, J. A. (2009). *Curve number hydrology: State of the practice*. American Society of Civil Engineers. https://doi.org/10.1061/9780784410042

Jenson, S. K., & Domingue, J. O. (1988). Extracting topographic structure from digital elevation data for geographic information system analysis. *Photogrammetric Engineering and Remote Sensing, 54*(11), 1593–1600.

Nobre, A. D., Cuartas, L. A., Hodnett, M., Rennó, C. D., Rodrigues, G., Silveira, A., Waterloo, M., & Saleska, S. (2011). Height above the nearest drainage – A hydrologically relevant new terrain model. *Journal of Hydrology, 404*(1–2), 13–29. https://doi.org/10.1016/j.jhydrol.2011.03.051

Nobre, A. D., Cuartas, L. A., Momo, M. R., Severo, D. L., Pinheiro, A., & Nobre, C. A. (2016). HAND contour: A new proxy predictor of inundation extent. *Hydrological Processes, 30*(2), 320–333. https://doi.org/10.1002/hyp.10581

O’Callaghan, J. F., & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. *Computer Vision, Graphics, and Image Processing, 28*(3), 323–344. https://doi.org/10.1016/S0734-189X(84)80011-0

Patel, K., Rajib, A., Biswas, N. K., Liu, Z., & Lofton, E. N. (2026). The HAND of flood mapping: Multi-dimensional evaluation across data-rich and data-poor basins using existing maps, ground observations, and remote sensing data. *Environmental Research Communications, 8*(5), Article 051008. https://doi.org/10.1088/2515-7620/ae6236

Rennó, C. D., Nobre, A. D., Cuartas, L. A., Soares, J. V., Hodnett, M. G., Tomasella, J., & Waterloo, M. J. (2008). HAND, a new terrain descriptor using SRTM-DEM: Mapping terra-firme rainforest environments in Amazonia. *Remote Sensing of Environment, 112*(9), 3469–3481. https://doi.org/10.1016/j.rse.2008.03.018

Snyder, J. P. (1987). *Map projections—A working manual* (Professional Paper No. 1395). U.S. Geological Survey. https://doi.org/10.3133/pp1395

U.S. Department of Agriculture, Natural Resources Conservation Service. (2004). Estimation of direct runoff from storm rainfall. In *National engineering handbook* (Part 630, Chapter 10).

U.S. Department of Agriculture, Soil Conservation Service. (1972). *National engineering handbook* (Section 4, Hydrology).

U.S. Department of Agriculture, Soil Conservation Service. (1986). *Urban hydrology for small watersheds* (Technical Release No. 55, 2nd ed.).

Woodward, D. E., Hawkins, R. H., Jiang, R., Hjelmfelt, A. T., Jr., Van Mullem, J. A., & Quan, Q. D. (2003). Runoff curve number method: Examination of the initial abstraction ratio. In P. Bizier & P. DeBarry (Eds.), *World Water & Environmental Resources Congress 2003*. American Society of Civil Engineers. https://doi.org/10.1061/40685(2003)308

Zheng, X., Tarboton, D. G., Maidment, D. R., Liu, Y. Y., & Passalacqua, P. (2018). River channel geometry and rating curve estimation using height above the nearest drainage. *Journal of the American Water Resources Association, 54*(4), 785–806. https://doi.org/10.1111/1752-1688.12661
