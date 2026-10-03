/**
 * Shared facade atlases for the metropolitan buildings.
 *
 * Kenney city-kit models stay cartoon no matter how they are lit. These canvases
 * produce glass curtain walls, IT-campus cladding and residential plaster that
 * read as real materials at street distance, while remaining a few kilobytes and
 * one GPU texture each.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

export type FacadeKind = "office" | "tower" | "campus" | "house";

function fill(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function windowColor(kind: FacadeKind, lit: boolean): string {
  if (!lit) return kind === "house" ? "#3a4038" : "#0b1520";
  if (kind === "tower") return "rgba(168, 210, 236, 0.92)";
  if (kind === "office") return "rgba(196, 214, 226, 0.88)";
  if (kind === "campus") return "rgba(232, 220, 186, 0.9)";
  return "rgba(255, 226, 170, 0.85)";
}

function paintFacade(kind: FacadeKind): HTMLCanvasElement {
  const w = 512;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const skins: Record<FacadeKind, [string, string]> = {
    office: ["#9aa3ad", "#5c6570"],
    tower: ["#1a222b", "#0e141a"],
    campus: ["#e2d3b4", "#b89a6a"],
    house: ["#efe4d2", "#c9a27a"],
  };
  const [base, accent] = skins[kind];
  fill(ctx, base);

  // Podium / roof band so the silhouette is not a single slab.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, kind === "house" ? 70 : 48);
  ctx.fillRect(0, h - (kind === "house" ? 90 : 64), w, kind === "house" ? 90 : 64);

  const cols = kind === "house" ? 4 : kind === "campus" ? 7 : 8;
  const rows = kind === "house" ? 3 : kind === "campus" ? 9 : kind === "office" ? 16 : 22;
  const marginX = kind === "house" ? 48 : 28;
  const marginY = kind === "house" ? 110 : 70;
  const gapX = kind === "house" ? 18 : 8;
  const gapY = kind === "house" ? 28 : 10;
  const usableW = w - marginX * 2;
  const usableH = h - marginY * 2;
  const winW = (usableW - gapX * (cols - 1)) / cols;
  const winH = (usableH - gapY * (rows - 1)) / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = marginX + col * (winW + gapX);
      const y = marginY + row * (winH + gapY);
      const seed = (row * 17 + col * 31 + kind.length * 13) % 100;
      const lit = seed > (kind === "house" ? 55 : 28);
      ctx.fillStyle = windowColor(kind, lit);
      ctx.fillRect(x, y, winW, winH);
      if (kind !== "house") {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(x, y, winW, Math.max(2, winH * 0.18));
      }
    }
  }

  if (kind === "campus") {
    ctx.fillStyle = "#2a6f9a";
    ctx.fillRect(0, 80, w, 18);
  }
  if (kind === "house") {
    ctx.fillStyle = "#5d7a4a";
    ctx.fillRect(0, 0, w, 64);
  }

  return canvas;
}

const cache = new Map<FacadeKind, CanvasTexture>();

export function facadeTexture(kind: FacadeKind): CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const tex = new CanvasTexture(paintFacade(kind));
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  cache.set(kind, tex);
  return tex;
}
