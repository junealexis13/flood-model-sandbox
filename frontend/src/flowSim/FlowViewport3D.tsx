import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  depthColorNormalized,
  terrainColorNormalized,
  velocityColorNormalized,
} from "./colorMaps";
import type {
  CameraPreset,
  FlowSimData,
  PointInspection,
  PointSeriesSample,
  WaterColorMode,
} from "./types";

interface FlowViewport3DProps {
  data: FlowSimData | null;
  frameIndex: number;
  colorMode: WaterColorMode;
  showWireframe: boolean;
  zScale: number;
  waterOpacity: number;
  cameraPreset: { mode: CameraPreset; seq: number };
  snapshotSignal: number;
  onInspect: (point: PointInspection | null) => void;
  onAzimuthChange?: (northDeg: number) => void;
}

const WET_THRESHOLD_M = 0.005;

const WATER_VERTEX_SHADER = `
  attribute float aDepth;
  varying float vDepth;
  varying vec3 vColor;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vDepth = aDepth;
    vColor = color;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const WATER_FRAGMENT_SHADER = `
  uniform float uOpacity;
  varying float vDepth;
  varying vec3 vColor;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    if (vDepth < 0.005 || uOpacity <= 0.01) discard;
    vec3 n = normalize(vWorldNormal);
    vec3 sunDir = normalize(vec3(0.55, 0.78, 0.32));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfVec = normalize(sunDir + viewDir);

    float diff = max(dot(n, sunDir), 0.0);
    float spec = pow(max(dot(n, halfVec), 0.0), 42.0) * 0.22;
    float light = 0.56 + 0.44 * diff;
    vec3 lit = vColor * light + vec3(0.88, 0.96, 0.98) * spec;

    float baseAlpha = clamp(0.54 + smoothstep(0.005, 1.5, vDepth) * 0.36, 0.54, 0.90);
    gl_FragColor = vec4(lit, baseAlpha * uOpacity);
  }
`;

interface BaryTarget {
  a: number;
  b: number;
  c: number;
  u: number;
  v: number;
  w: number;
  series: PointSeriesSample[];
}

interface SceneHandles {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gridHelper: THREE.GridHelper;
  terrainMesh: THREE.Mesh | null;
  skirtMesh: THREE.Mesh | null;
  wireframeMesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  waterMat: THREE.ShaderMaterial | null;
  markerMesh: THREE.Mesh;
  boundaryEdges: Array<[number, number]>;
  skirtDepth: number;
  baseElev: number;
  spanXY: number;
  spanZ: number;
  depthScale: number;
  velScale: number;
}

export function FlowViewport3D({
  data,
  frameIndex,
  colorMode,
  showWireframe,
  zScale,
  waterOpacity,
  cameraPreset,
  snapshotSignal,
  onInspect,
  onAzimuthChange,
}: FlowViewport3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const dataRef = useRef<FlowSimData | null>(data);
  const frameRef = useRef(frameIndex);
  const zScaleRef = useRef(zScale);
  const waterOpacityRef = useRef(waterOpacity);
  const onInspectRef = useRef(onInspect);
  const onAzimuthRef = useRef(onAzimuthChange);
  const lastAzimuthRef = useRef<number>(NaN);
  const pinnedTargetRef = useRef<BaryTarget | null>(null);

  dataRef.current = data;
  frameRef.current = frameIndex;
  zScaleRef.current = zScale;
  waterOpacityRef.current = waterOpacity;
  onInspectRef.current = onInspect;
  onAzimuthRef.current = onAzimuthChange;

  // Initialize Three.js renderer, scene, camera, lights, ambient grid, and OrbitControls once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101614");

    const camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || 800) / Math.max(1, container.clientHeight || 600),
      0.5,
      500000,
    );
    camera.position.set(520, 380, 620);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;

    const hemi = new THREE.HemisphereLight(0xf6f3ea, 0x26312d, 0.85);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff8e8, 1.08);
    sun.position.set(1, 1.6, 0.8);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x9bd6cf, 0.36);
    fill.position.set(-1.2, 0.7, -1.0);
    scene.add(fill);

    const gridHelper = new THREE.GridHelper(1600, 32, 0x26443d, 0x1a2623);
    gridHelper.position.y = -20;
    const gridMat = gridHelper.material;
    if (Array.isArray(gridMat)) {
      gridMat.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.55;
      });
    } else {
      gridMat.transparent = true;
      gridMat.opacity = 0.55;
    }
    scene.add(gridHelper);

    const markerGeom = new THREE.SphereGeometry(1, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const markerMesh = new THREE.Mesh(markerGeom, markerMat);
    markerMesh.visible = false;
    scene.add(markerMesh);

    const handles: SceneHandles = {
      renderer,
      scene,
      camera,
      controls,
      gridHelper,
      terrainMesh: null,
      skirtMesh: null,
      wireframeMesh: null,
      waterMesh: null,
      waterMat: null,
      markerMesh,
      boundaryEdges: [],
      skirtDepth: 20,
      baseElev: 0,
      spanXY: 1000,
      spanZ: 10,
      depthScale: 2,
      velScale: 2,
    };
    handlesRef.current = handles;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const triA = new THREE.Vector3();
    const triB = new THREE.Vector3();
    const triC = new THREE.Vector3();
    const bary = new THREE.Vector3();

    let pointerDownX = 0;
    let pointerDownY = 0;
    let hoverRaf = 0;

    const sampleAtClient = (clientX: number, clientY: number, pinned: boolean) => {
      const currentData = dataRef.current;
      const currentHandles = handlesRef.current;
      if (!currentData || !currentHandles || !currentHandles.terrainMesh) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(currentHandles.terrainMesh, false);
      if (hits.length === 0 || !hits[0].face) {
        if (!pinnedTargetRef.current) {
          currentHandles.markerMesh.visible = false;
          onInspectRef.current(null);
        }
        return;
      }

      const hit = hits[0];
      if (!hit.face) return;
      const { a, b, c } = hit.face;
      const posAttr = currentHandles.terrainMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      triA.fromBufferAttribute(posAttr, a);
      triB.fromBufferAttribute(posAttr, b);
      triC.fromBufferAttribute(posAttr, c);
      THREE.Triangle.getBarycoord(hit.point, triA, triB, triC, bary);

      const u = Number.isFinite(bary.x) ? bary.x : 1 / 3;
      const v = Number.isFinite(bary.y) ? bary.y : 1 / 3;
      const w = Number.isFinite(bary.z) ? bary.z : 1 / 3;

      currentHandles.markerMesh.position.copy(hit.point);
      const markerR = Math.max(1.2, currentHandles.spanXY * 0.0045);
      currentHandles.markerMesh.scale.setScalar(markerR);
      currentHandles.markerMesh.visible = true;

      let series: PointSeriesSample[] | undefined;
      if (pinned) {
        series = extractPointSeries(currentData, { a, b, c, u, v, w });
        pinnedTargetRef.current = { a, b, c, u, v, w, series };
      } else {
        series = pinnedTargetRef.current?.series;
      }

      onInspectRef.current(
        interpolatePoint(
          currentData,
          frameRef.current,
          { a, b, c, u, v, w },
          pinned || Boolean(pinnedTargetRef.current),
          series,
        ),
      );
    };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownX = ev.clientX;
      pointerDownY = ev.clientY;
    };

    const onPointerUp = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pointerDownX, ev.clientY - pointerDownY);
      if (dist < 5) {
        sampleAtClient(ev.clientX, ev.clientY, true);
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (pinnedTargetRef.current || ev.buttons !== 0) return;
      if (hoverRaf) return;
      const { clientX, clientY } = ev;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        sampleAtClient(clientX, clientY, false);
      });
    };

    const onDoubleClick = () => {
      pinnedTargetRef.current = null;
      handles.markerMesh.visible = false;
      onInspectRef.current(null);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("dblclick", onDoubleClick);

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (!dataRef.current) {
        gridHelper.rotation.y += 0.0005;
      }
      controls.update();

      // Compute North compass angle (-Z is North, +X is East).
      const dx = controls.target.x - camera.position.x;
      const dz = controls.target.z - camera.position.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        const northDeg = Math.round((-Math.atan2(dx, -dz) * 180) / Math.PI);
        if (northDeg !== lastAzimuthRef.current) {
          lastAzimuthRef.current = northDeg;
          onAzimuthRef.current?.(northDeg);
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      disposeMesh(handles.terrainMesh, scene);
      disposeMesh(handles.skirtMesh, scene);
      disposeMesh(handles.wireframeMesh, scene);
      disposeMesh(handles.waterMesh, scene);
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      if (Array.isArray(gridHelper.material)) {
        gridHelper.material.forEach((m) => m.dispose());
      } else {
        gridHelper.material.dispose();
      }
      markerGeom.dispose();
      markerMat.dispose();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      handlesRef.current = null;
    };
  }, []);

  // Build terrain + skirt + water BufferGeometries whenever simulation data changes.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;

    disposeMesh(handles.terrainMesh, handles.scene);
    disposeMesh(handles.skirtMesh, handles.scene);
    disposeMesh(handles.wireframeMesh, handles.scene);
    disposeMesh(handles.waterMesh, handles.scene);
    handles.terrainMesh = null;
    handles.skirtMesh = null;
    handles.wireframeMesh = null;
    handles.waterMesh = null;
    handles.waterMat = null;
    handles.boundaryEdges = [];
    handles.markerMesh.visible = false;
    pinnedTargetRef.current = null;

    if (!data) {
      handles.gridHelper.scale.setScalar(1);
      handles.gridHelper.position.y = -20;
      return;
    }

    const { meta, xLocal, yLocal, elevation, indices } = data;
    const n = meta.vertex_count;
    const bounds = meta.bounds_local;
    const baseElev = bounds.min_z;
    const elevSpan = Math.max(1e-3, bounds.max_z - bounds.min_z);
    const spanX = Math.max(1, bounds.max_x - bounds.min_x);
    const spanY = Math.max(1, bounds.max_y - bounds.min_y);
    const spanXY = Math.max(spanX, spanY);
    const skirtDepth = Math.max(spanXY * 0.025, elevSpan * 0.35, 4);

    handles.baseElev = baseElev;
    handles.spanXY = spanXY;
    handles.spanZ = elevSpan;
    handles.skirtDepth = skirtDepth;
    handles.depthScale = Math.max(0.5, meta.global_stats.max_depth_m);
    handles.velScale = Math.max(0.5, meta.global_stats.max_velocity_m_s);

    const terrainPositions = new Float32Array(n * 3);
    const terrainColors = new Float32Array(n * 3);
    const initialZScale = zScaleRef.current;

    for (let i = 0; i < n; i += 1) {
      const i3 = i * 3;
      terrainPositions[i3] = xLocal[i];
      terrainPositions[i3 + 1] = (elevation[i] - baseElev) * initialZScale;
      terrainPositions[i3 + 2] = -yLocal[i];

      const [r, g, b] = terrainColorNormalized((elevation[i] - baseElev) / elevSpan);
      terrainColors[i3] = r;
      terrainColors[i3 + 1] = g;
      terrainColors[i3 + 2] = b;
    }

    const indexAttr = new THREE.BufferAttribute(new Uint32Array(indices), 1);

    const terrainGeom = new THREE.BufferGeometry();
    terrainGeom.setAttribute("position", new THREE.BufferAttribute(terrainPositions, 3));
    terrainGeom.setAttribute("color", new THREE.BufferAttribute(terrainColors, 3));
    terrainGeom.setIndex(indexAttr);
    terrainGeom.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    handles.scene.add(terrainMesh);
    handles.terrainMesh = terrainMesh;

    // Build extruded geological base skirt along boundary edges.
    const boundaryEdges = extractBoundaryEdges(indices);
    handles.boundaryEdges = boundaryEdges;
    if (boundaryEdges.length > 0) {
      const skirtGeom = buildSkirtGeometry(
        boundaryEdges,
        xLocal,
        yLocal,
        elevation,
        baseElev,
        initialZScale,
        skirtDepth,
      );
      const skirtMat = new THREE.MeshStandardMaterial({
        color: 0x4c443a,
        roughness: 0.92,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      const skirtMesh = new THREE.Mesh(skirtGeom, skirtMat);
      handles.scene.add(skirtMesh);
      handles.skirtMesh = skirtMesh;
    }

    // Reposition ambient grid neatly underneath the terrain plinth.
    handles.gridHelper.rotation.y = 0;
    const gridScale = Math.max(0.2, (spanXY * 2.1) / 1600);
    handles.gridHelper.scale.set(gridScale, 1, gridScale);
    handles.gridHelper.position.y = -skirtDepth - Math.max(0.4, spanXY * 0.002);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xf3efe6,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const wireframeMesh = new THREE.Mesh(terrainGeom, wireMat);
    wireframeMesh.visible = showWireframe;
    handles.scene.add(wireframeMesh);
    handles.wireframeMesh = wireframeMesh;

    const waterPositions = new Float32Array(n * 3);
    const waterColors = new Float32Array(n * 3);
    const waterDepths = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const i3 = i * 3;
      waterPositions[i3] = xLocal[i];
      waterPositions[i3 + 1] = (elevation[i] - baseElev) * initialZScale;
      waterPositions[i3 + 2] = -yLocal[i];
    }

    const waterGeom = new THREE.BufferGeometry();
    waterGeom.setAttribute("position", new THREE.BufferAttribute(waterPositions, 3));
    waterGeom.setAttribute("color", new THREE.BufferAttribute(waterColors, 3));
    waterGeom.setAttribute("aDepth", new THREE.BufferAttribute(waterDepths, 1));
    waterGeom.setIndex(indexAttr);
    waterGeom.computeVertexNormals();

    const waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: waterOpacityRef.current },
      },
      vertexShader: WATER_VERTEX_SHADER,
      fragmentShader: WATER_FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const waterMesh = new THREE.Mesh(waterGeom, waterMat);
    waterMesh.visible = waterOpacityRef.current > 0.01;
    handles.scene.add(waterMesh);
    handles.waterMesh = waterMesh;
    handles.waterMat = waterMat;

    applyCameraPreset(handles, "iso");
  }, [data]);

  // Toggle wireframe visibility.
  useEffect(() => {
    const handles = handlesRef.current;
    if (handles?.wireframeMesh) {
      handles.wireframeMesh.visible = showWireframe;
    }
  }, [showWireframe]);

  // Update water shader opacity uniform without rebuilding geometry.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles?.waterMat || !handles.waterMesh) return;
    handles.waterMat.uniforms.uOpacity.value = waterOpacity;
    handles.waterMesh.visible = waterOpacity > 0.01;
  }, [waterOpacity]);

  // Apply camera presets (iso / top / low / north).
  useEffect(() => {
    const handles = handlesRef.current;
    if (handles && data && cameraPreset.seq > 0) {
      applyCameraPreset(handles, cameraPreset.mode);
    }
  }, [cameraPreset, data]);

  // Export PNG snapshot of current Three.js frame.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !data || snapshotSignal <= 0) return;
    handles.renderer.render(handles.scene, handles.camera);
    const dataUrl = handles.renderer.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `flow-sim-frame-${String(frameRef.current + 1).padStart(2, "0")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [snapshotSignal, data]);

  // Update terrain + skirt vertical scale & water surface vertices/colors on frame, colorMode, or zScale changes.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !data || !handles.terrainMesh || !handles.waterMesh) return;

    const { meta, elevation, stage, depth, speed } = data;
    const n = meta.vertex_count;
    const fIdx = Math.max(0, Math.min(meta.frame_count - 1, frameIndex));
    const fOff = fIdx * n;
    const baseElev = handles.baseElev;
    const eps = Math.max(0.03, handles.spanXY * 0.00018);

    const terrainPos = handles.terrainMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const terrainArr = terrainPos.array as Float32Array;
    for (let i = 0; i < n; i += 1) {
      terrainArr[i * 3 + 1] = (elevation[i] - baseElev) * zScale;
    }
    terrainPos.needsUpdate = true;
    handles.terrainMesh.geometry.computeVertexNormals();
    handles.terrainMesh.geometry.computeBoundingSphere();

    if (handles.skirtMesh && handles.boundaryEdges.length > 0) {
      const skirtPos = handles.skirtMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const skirtArr = skirtPos.array as Float32Array;
      const edges = handles.boundaryEdges;
      for (let e = 0; e < edges.length; e += 1) {
        const [u, v] = edges[e];
        const base = e * 12;
        skirtArr[base + 1] = (elevation[u] - baseElev) * zScale;
        skirtArr[base + 4] = (elevation[v] - baseElev) * zScale;
      }
      skirtPos.needsUpdate = true;
      handles.skirtMesh.geometry.computeVertexNormals();
    }

    const waterPos = handles.waterMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const waterCol = handles.waterMesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const waterDep = handles.waterMesh.geometry.getAttribute("aDepth") as THREE.BufferAttribute;
    const wPosArr = waterPos.array as Float32Array;
    const wColArr = waterCol.array as Float32Array;
    const wDepArr = waterDep.array as Float32Array;

    const dScale = handles.depthScale;
    const vScale = handles.velScale;

    for (let i = 0; i < n; i += 1) {
      const idx = fOff + i;
      const d = depth[idx];
      const w = stage[idx];
      const v = speed[idx];
      const i3 = i * 3;

      wDepArr[i] = d;
      if (d >= WET_THRESHOLD_M) {
        wPosArr[i3 + 1] = (w - baseElev) * zScale + eps;
      } else {
        wPosArr[i3 + 1] = (elevation[i] - baseElev) * zScale - eps;
      }

      const [r, g, b] =
        colorMode === "depth"
          ? depthColorNormalized(d, dScale)
          : velocityColorNormalized(v, vScale);
      wColArr[i3] = r;
      wColArr[i3 + 1] = g;
      wColArr[i3 + 2] = b;
    }

    waterPos.needsUpdate = true;
    waterCol.needsUpdate = true;
    waterDep.needsUpdate = true;
    handles.waterMesh.geometry.computeVertexNormals();

    if (pinnedTargetRef.current) {
      const pt = interpolatePoint(
        data,
        fIdx,
        pinnedTargetRef.current,
        true,
        pinnedTargetRef.current.series,
      );
      handles.markerMesh.position.set(
        pt.localX,
        (pt.elevationM - baseElev) * zScale,
        -pt.localY,
      );
      onInspectRef.current(pt);
    }
  }, [data, frameIndex, colorMode, zScale]);

  return <div ref={containerRef} className="h-full w-full cursor-crosshair" />;
}

function extractBoundaryEdges(indices: Uint32Array): Array<[number, number]> {
  const counts = new Map<number, { count: number; u: number; v: number }>();
  const stride = 1_000_000;
  const addEdge = (u: number, v: number) => {
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const key = lo * stride + hi;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { count: 1, u, v });
    }
  };

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const boundary: Array<[number, number]> = [];
  for (const entry of counts.values()) {
    if (entry.count === 1) {
      boundary.push([entry.u, entry.v]);
    }
  }
  return boundary;
}

function buildSkirtGeometry(
  edges: Array<[number, number]>,
  xLocal: Float32Array,
  yLocal: Float32Array,
  elevation: Float32Array,
  baseElev: number,
  zScale: number,
  skirtDepth: number,
): THREE.BufferGeometry {
  const edgeCount = edges.length;
  const positions = new Float32Array(edgeCount * 4 * 3);
  const quadIndices = new Uint32Array(edgeCount * 6);

  for (let e = 0; e < edgeCount; e += 1) {
    const [u, v] = edges[e];
    const vBase = e * 4;
    const pBase = vBase * 3;
    const iBase = e * 6;

    const ux = xLocal[u];
    const uyTop = (elevation[u] - baseElev) * zScale;
    const uz = -yLocal[u];

    const vx = xLocal[v];
    const vyTop = (elevation[v] - baseElev) * zScale;
    const vz = -yLocal[v];

    // 0: top-u, 1: top-v, 2: bottom-u, 3: bottom-v
    positions[pBase] = ux;
    positions[pBase + 1] = uyTop;
    positions[pBase + 2] = uz;

    positions[pBase + 3] = vx;
    positions[pBase + 4] = vyTop;
    positions[pBase + 5] = vz;

    positions[pBase + 6] = ux;
    positions[pBase + 7] = -skirtDepth;
    positions[pBase + 8] = uz;

    positions[pBase + 9] = vx;
    positions[pBase + 10] = -skirtDepth;
    positions[pBase + 11] = vz;

    quadIndices[iBase] = vBase;
    quadIndices[iBase + 1] = vBase + 1;
    quadIndices[iBase + 2] = vBase + 2;

    quadIndices[iBase + 3] = vBase + 1;
    quadIndices[iBase + 4] = vBase + 3;
    quadIndices[iBase + 5] = vBase + 2;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(quadIndices, 1));
  geom.computeVertexNormals();
  return geom;
}

function extractPointSeries(
  data: FlowSimData,
  target: { a: number; b: number; c: number; u: number; v: number; w: number },
): PointSeriesSample[] {
  const { depth, speed, meta } = data;
  const { a, b, c, u, v, w } = target;
  const n = meta.vertex_count;
  const samples: PointSeriesSample[] = new Array(meta.frame_count);

  for (let f = 0; f < meta.frame_count; f += 1) {
    const fOff = f * n;
    const depthM = Math.max(0, u * depth[fOff + a] + v * depth[fOff + b] + w * depth[fOff + c]);
    const velocityMS = Math.max(0, u * speed[fOff + a] + v * speed[fOff + b] + w * speed[fOff + c]);
    samples[f] = {
      timeSec: meta.times_sec[f] ?? f * meta.params.yieldstep_sec,
      depthM,
      velocityMS,
    };
  }
  return samples;
}

function interpolatePoint(
  data: FlowSimData,
  frameIdx: number,
  target: { a: number; b: number; c: number; u: number; v: number; w: number },
  pinned: boolean,
  series?: PointSeriesSample[],
): PointInspection {
  const { xLocal, yLocal, elevation, stage, depth, speed, meta } = data;
  const { a, b, c, u, v, w } = target;
  const fIdx = Math.max(0, Math.min(meta.frame_count - 1, frameIdx));
  const fOff = fIdx * meta.vertex_count;

  const localX = u * xLocal[a] + v * xLocal[b] + w * xLocal[c];
  const localY = u * yLocal[a] + v * yLocal[b] + w * yLocal[c];
  const elevationM = u * elevation[a] + v * elevation[b] + w * elevation[c];
  const depthM = Math.max(0, u * depth[fOff + a] + v * depth[fOff + b] + w * depth[fOff + c]);
  const stageM = u * stage[fOff + a] + v * stage[fOff + b] + w * stage[fOff + c];
  const velocityMS = Math.max(0, u * speed[fOff + a] + v * speed[fOff + b] + w * speed[fOff + c]);

  return {
    localX,
    localY,
    utmEasting: meta.utm_origin[0] + localX,
    utmNorthing: meta.utm_origin[1] + localY,
    utmEpsg: meta.utm_epsg,
    elevationM,
    depthM,
    stageM,
    velocityMS,
    pinned,
    series,
  };
}

function applyCameraPreset(handles: SceneHandles, mode: CameraPreset): void {
  const { camera, controls, spanXY, spanZ } = handles;
  const dist = Math.max(spanXY * 0.92, 120);
  camera.near = Math.max(0.2, dist * 0.001);
  camera.far = Math.max(20000, dist * 25);
  controls.maxDistance = dist * 5;

  if (mode === "top") {
    controls.target.set(0, 0, 0);
    camera.position.set(0, dist * 1.18 + spanZ, Math.max(1, dist * 0.03));
  } else if (mode === "low") {
    controls.target.set(0, spanZ * 0.22, 0);
    camera.position.set(dist * 0.7, dist * 0.24 + spanZ * 0.85, dist * 0.68);
  } else if (mode === "north") {
    const offset = camera.position.clone().sub(controls.target);
    const horiz = Math.max(dist * 0.12, Math.hypot(offset.x, offset.z));
    camera.position.set(controls.target.x, camera.position.y, controls.target.z + horiz);
  } else {
    controls.target.set(0, spanZ * 0.25, 0);
    camera.position.set(dist * 0.58, dist * 0.52 + spanZ, dist * 0.72);
  }

  camera.updateProjectionMatrix();
  controls.update();
}

function disposeMesh(mesh: THREE.Mesh | null, scene: THREE.Scene): void {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((m) => m.dispose());
  } else {
    mesh.material.dispose();
  }
}
