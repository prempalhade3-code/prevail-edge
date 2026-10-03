/**
 * Road surfaces, kerbs and lane markings for the whole corridor.
 *
 * All roads are merged into a handful of buffer geometries at load time, so the
 * network costs about three draw calls instead of one per segment. Ribbons use
 * mitred vertex normals so corners join without gaps or overlapping slivers.
 */
import { useEffect, useMemo } from "react";
import { useTexture } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, DoubleSide, RepeatWrapping, SRGBColorSpace } from "three";
import type { RoadPolyline } from "../../lib/cityScene";

const ROAD_Y = 0.0;
const MARKING_Y = 0.025;
const KERB_HEIGHT = 0.16;
const SIDEWALK_WIDTH = 2.6;
const GROUND_Y = -0.15;

type Vec2 = [number, number];

/** Per-vertex mitred normals, so a ribbon stays continuous through corners. */
function mitredNormals(pts: Vec2[]): Vec2[] {
  const normals: Vec2[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    normals.push([-dz, dx]);
  }
  return normals;
}

type Builder = {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
};

function newBuilder(): Builder {
  return { position: [], normal: [], uv: [], index: [] };
}

/** Append a quad strip between two offset edges of a polyline. */
function addRibbon(
  b: Builder,
  pts: Vec2[],
  normals: Vec2[],
  innerOffset: number,
  outerOffset: number,
  y: number,
  vScale = 0.08,
) {
  const base = b.position.length / 3;
  let run = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (i > 0) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [nx, nz] = normals[i];
    b.position.push(
      pts[i][0] + nx * innerOffset,
      y,
      pts[i][1] + nz * innerOffset,
      pts[i][0] + nx * outerOffset,
      y,
      pts[i][1] + nz * outerOffset,
    );
    b.normal.push(0, 1, 0, 0, 1, 0);
    b.uv.push(0, run * vScale, 1, run * vScale);
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = base + i * 2;
    b.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

/** Append the vertical kerb face along one side of a road. */
function addKerbFace(b: Builder, pts: Vec2[], normals: Vec2[], offset: number, side: number) {
  const base = b.position.length / 3;
  for (let i = 0; i < pts.length; i += 1) {
    const [nx, nz] = normals[i];
    const x = pts[i][0] + nx * offset;
    const z = pts[i][1] + nz * offset;
    b.position.push(x, ROAD_Y, z, x, KERB_HEIGHT, z);
    b.normal.push(-nx * side, 0, -nz * side, -nx * side, 0, -nz * side);
    b.uv.push(0, 0, 1, 1);
  }
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = base + i * 2;
    if (side > 0) b.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else b.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** Dashed centre line, emitted as small flat quads. */
function addDashes(b: Builder, pts: Vec2[], normals: Vec2[], halfWidth: number) {
  const dash = 3.0;
  const gap = 9.0;
  const width = 0.16;
  const lanes = Math.max(1, Math.round(halfWidth / 3.5));

  for (let lane = 1; lane < lanes; lane += 1) {
    const offset = (lane / lanes) * halfWidth * 2 - halfWidth;
    let carried = 0;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const ax = pts[i][0] + normals[i][0] * offset;
      const az = pts[i][1] + normals[i][1] * offset;
      const bx = pts[i + 1][0] + normals[i + 1][0] * offset;
      const bz = pts[i + 1][1] + normals[i + 1][1] * offset;
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen < 1e-6) continue;
      const ux = (bx - ax) / segLen;
      const uz = (bz - az) / segLen;
      const px = -uz * width;
      const pz = ux * width;

      let t = carried;
      while (t + dash < segLen) {
        const sx = ax + ux * t;
        const sz = az + uz * t;
        const ex = ax + ux * (t + dash);
        const ez = az + uz * (t + dash);
        const base = b.position.length / 3;
        b.position.push(
          sx + px, MARKING_Y, sz + pz,
          sx - px, MARKING_Y, sz - pz,
          ex + px, MARKING_Y, ez + pz,
          ex - px, MARKING_Y, ez - pz,
        );
        for (let k = 0; k < 4; k += 1) b.normal.push(0, 1, 0);
        b.uv.push(0, 0, 1, 0, 0, 1, 1, 1);
        b.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        t += dash + gap;
      }
      carried = Math.max(0, t - segLen);
    }
  }
}

function toGeometry(b: Builder): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(b.position), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(b.normal), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(b.uv), 2));
  geometry.setIndex(b.index);
  geometry.computeBoundingSphere();
  return geometry;
}

export function Roads({ roads }: { roads: RoadPolyline[] }) {
  const asphalt = useTexture({
    map: "/textures/aerial_asphalt_01_diffuse.jpg",
    normalMap: "/textures/aerial_asphalt_01_nor_gl.jpg",
    roughnessMap: "/textures/aerial_asphalt_01_rough.jpg",
  });
  const grass = useTexture({
    map: "/textures/aerial_grass_rock_diffuse.jpg",
    normalMap: "/textures/aerial_grass_rock_nor_gl.jpg",
    roughnessMap: "/textures/aerial_grass_rock_rough.jpg",
  });
  const concrete = useTexture({
    map: "/textures/concrete_floor_02_diffuse.jpg",
    normalMap: "/textures/concrete_floor_02_nor_gl.jpg",
    roughnessMap: "/textures/concrete_floor_02_rough.jpg",
  });

  useEffect(() => {
    for (const tex of [asphalt, grass, concrete]) {
      tex.map.colorSpace = SRGBColorSpace;
      tex.map.wrapS = tex.map.wrapT = RepeatWrapping;
      tex.normalMap.wrapS = tex.normalMap.wrapT = RepeatWrapping;
      tex.roughnessMap.wrapS = tex.roughnessMap.wrapT = RepeatWrapping;
      tex.map.anisotropy = 8;
    }
    grass.map.repeat.set(420, 420);
    grass.normalMap.repeat.set(420, 420);
    grass.roughnessMap.repeat.set(420, 420);
    asphalt.map.repeat.set(2.4, 0.18);
    asphalt.normalMap.repeat.set(2.4, 0.18);
    asphalt.roughnessMap.repeat.set(2.4, 0.18);
    concrete.map.repeat.set(2.2, 0.2);
    concrete.normalMap.repeat.set(2.2, 0.2);
    concrete.roughnessMap.repeat.set(2.2, 0.2);
  }, [asphalt, grass, concrete]);

  const { road, kerb, marking } = useMemo(() => {
    const roadB = newBuilder();
    const kerbB = newBuilder();
    const markB = newBuilder();

    for (const r of roads) {
      if (r.pts.length < 2) continue;
      const pts = r.pts as Vec2[];
      const normals = mitredNormals(pts);
      const hw = r.half_width;

      addRibbon(roadB, pts, normals, -hw, hw, ROAD_Y, 0.05);

      // Pavements either side, plus the vertical kerb face that meets the road.
      addRibbon(kerbB, pts, normals, hw, hw + SIDEWALK_WIDTH, KERB_HEIGHT);
      addRibbon(kerbB, pts, normals, -hw - SIDEWALK_WIDTH, -hw, KERB_HEIGHT);
      addKerbFace(kerbB, pts, normals, hw, 1);
      addKerbFace(kerbB, pts, normals, -hw, -1);

      if (r.rank >= 3) addDashes(markB, pts, normals, hw);
    }

    return {
      road: toGeometry(roadB),
      kerb: toGeometry(kerbB),
      marking: toGeometry(markB),
    };
  }, [roads]);

  return (
    <group>
      <mesh position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16000, 16000]} />
        <meshStandardMaterial
          color="#5c7d3f"
          map={grass.map}
          normalMap={grass.normalMap}
          roughnessMap={grass.roughnessMap}
          roughness={1}
          metalness={0}
        />
      </mesh>

      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial
          map={asphalt.map}
          normalMap={asphalt.normalMap}
          roughnessMap={asphalt.roughnessMap}
          roughness={0.92}
          metalness={0.02}
        />
      </mesh>

      <mesh geometry={kerb} receiveShadow>
        <meshStandardMaterial
          map={concrete.map}
          normalMap={concrete.normalMap}
          roughnessMap={concrete.roughnessMap}
          roughness={0.95}
          side={DoubleSide}
        />
      </mesh>

      <mesh geometry={marking}>
        <meshStandardMaterial
          color="#e8e4d8"
          roughness={0.6}
          emissive="#2a2820"
          emissiveIntensity={0.25}
        />
      </mesh>
    </group>
  );
}
