/**
 * Plate manifest for the landing parallax ("Through the Layers of the Island",
 * docs/landing-concept.md). The plates themselves live in the media bucket
 * under `landing/` — never in git — and are addressed relative to MEDIA_BASE.
 *
 * The bucket also holds `landing/manifest.json` in exactly this shape; when it
 * exists it overrides this bundled default, so a re-generated plate — or a
 * re-timed layer — is a bucket write, not a deploy. The bundled copy is the
 * fallback and the documentation of record for what must be generated.
 */

/**
 * Absolute base URL for public media. In production this is
 * `${NEXT_PUBLIC_API_URL}/media` (Caddy proxies it to the bucket); locally
 * MinIO serves the same path shape, but on its own port, hence the override.
 */
export const MEDIA_BASE =
  process.env.NEXT_PUBLIC_MEDIA_URL ??
  `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/media`;

export const LANDING_BASE = `${MEDIA_BASE}/landing`;

/** The six scenes of the journey, in scroll order. */
export type SceneId =
  | 'opening' // above a thin cloud deck, sun and sky
  | 'coast' // Kyrenia castle, harbour, sea, Five Finger ridge behind
  | 'valley' // Bellapais valley side of the mountains
  | 'neighbourhood' // villa rooftops, olive terraces, pool edge
  | 'villa' // the villa's own terrace, infinity pool, sea beyond
  | 'interior'; // the room, open doorway looking back at the sea

/**
 * What a plate is for. `scenery` layers parallax inside their scene;
 * `transition` layers are the wipes that hide the scene swaps;
 * `backdrop` persists across the whole journey.
 */
export type PlateRole = 'backdrop' | 'scenery' | 'transition';

export interface Plate {
  id: string;
  scene: SceneId;
  role: PlateRole;
  /**
   * Parallax speed factor from the concept's layer stack (L0=0.1 … L6=1.5).
   * Transitions ignore it — their movement is choreographed.
   */
  speed: number;
  /** Stacking order inside the stage; higher is nearer the camera. */
  z: number;
  /**
   * File names relative to `landing/`. Fully opaque video plates carry
   * webm+mp4+poster; plates whose loop needs transparency (anything with sky
   * showing above its silhouette) are VP9-alpha webm only — H.264 cannot
   * carry alpha, so browsers without VP9 get the alpha `poster` instead.
   * Still cutouts carry only `poster` (a WebP with alpha when `cutout`).
   */
  webm?: string;
  mp4?: string;
  poster: string;
  /** Transparent-background variant — rendered as-is over other layers. */
  cutout?: boolean;
  /** Extra alpha mask (white = visible) for masked reveals (the arch window). */
  mask?: string;
  /** Loop length in seconds, for the generation brief. */
  loopSeconds?: number;
  /** Near layers (L4–L6) get the ±3° mouse tilt; backgrounds stay still. */
  tilt?: boolean;
}

export interface LandingManifest {
  version: number;
  plates: Plate[];
}

export const DEFAULT_MANIFEST: LandingManifest = {
  version: 1,
  plates: [
    // ---- persistent backdrop -------------------------------------------
    { id: 'l0-sky', scene: 'opening', role: 'backdrop', speed: 0.1, z: 0,
      webm: 'l0-sky.webm', mp4: 'l0-sky.mp4', poster: 'l0-sky.webp', loopSeconds: 10 },

    // ---- S0 opening: above the clouds ----------------------------------
    { id: 's0-clouds', scene: 'opening', role: 'scenery', speed: 0.3, z: 10,
      webm: 's0-clouds.webm', poster: 's0-clouds.webp', loopSeconds: 8 },
    // T1 cloud wipe — a single cumulus cutout that sweeps the whole frame
    { id: 't1-cloud', scene: 'opening', role: 'transition', speed: 1.2, z: 60,
      poster: 't1-cloud.webp', cutout: true },

    // ---- S1 coast: Kyrenia ---------------------------------------------
    { id: 's1-sea', scene: 'coast', role: 'scenery', speed: 0.25, z: 11,
      webm: 's1-sea.webm', poster: 's1-sea.webp', loopSeconds: 8 },
    { id: 's1-ridge-haze', scene: 'coast', role: 'scenery', speed: 0.4, z: 12,
      poster: 's1-ridge-haze.webp' },
    { id: 's1-harbour', scene: 'coast', role: 'scenery', speed: 0.6, z: 13,
      webm: 's1-harbour.webm', poster: 's1-harbour.webp', loopSeconds: 8 },
    // T2 ridge occlusion — hard-alpha top edge, rises to cover the harbour
    { id: 't2-ridge', scene: 'coast', role: 'transition', speed: 0.4, z: 61,
      poster: 't2-ridge.webp', cutout: true },

    // ---- S2 valley: Bellapais ------------------------------------------
    { id: 's2-ridge-far', scene: 'valley', role: 'scenery', speed: 0.3, z: 11,
      poster: 's2-ridge-far.webp' },
    { id: 's2-valley', scene: 'valley', role: 'scenery', speed: 0.5, z: 13,
      webm: 's2-valley.webm', poster: 's2-valley.webp', loopSeconds: 8 },
    // T3 tree-trunk pass — dark pine trunk, wide enough to cover the frame
    { id: 't3-trunk', scene: 'valley', role: 'transition', speed: 1.2, z: 62,
      poster: 't3-trunk.webp', cutout: true },

    // ---- S3 neighbourhood ----------------------------------------------
    { id: 's3-terrace', scene: 'neighbourhood', role: 'scenery', speed: 0.6, z: 13,
      webm: 's3-terrace.webm', poster: 's3-terrace.webp', loopSeconds: 8 },
    { id: 's3-pines', scene: 'neighbourhood', role: 'scenery', speed: 0.85, z: 20,
      poster: 's3-pines.webp', cutout: true, tilt: true },
    // T4 arch push-through — stone arch, transparent window + window mask
    { id: 't4-arch', scene: 'neighbourhood', role: 'transition', speed: 1.2, z: 63,
      poster: 't4-arch.webp', cutout: true, mask: 't4-arch-mask.webp' },

    // ---- S4 villa terrace ----------------------------------------------
    { id: 's4-terrace', scene: 'villa', role: 'scenery', speed: 0.6, z: 13,
      webm: 's4-terrace.webm', poster: 's4-terrace.webp', loopSeconds: 8 },
    { id: 's4-bougainvillea', scene: 'villa', role: 'scenery', speed: 1.2, z: 20,
      poster: 's4-bougainvillea.webp', cutout: true, tilt: true },
    // T5 curtain reveal — sheer linen, slight wind loop, alpha WebM
    { id: 't5-curtain', scene: 'villa', role: 'transition', speed: 1.5, z: 64,
      webm: 't5-curtain.webm', poster: 't5-curtain.webp', cutout: true, loopSeconds: 6 },

    // ---- S5 interior: the calm hold ------------------------------------
    { id: 's5-interior', scene: 'interior', role: 'scenery', speed: 0.3, z: 13,
      webm: 's5-interior.webm', mp4: 's5-interior.mp4', poster: 's5-interior.webp', loopSeconds: 10 },
    { id: 's5-doorframe', scene: 'interior', role: 'scenery', speed: 1.5, z: 20,
      poster: 's5-doorframe.webp', cutout: true, tilt: true },
  ],
};

export function plateUrl(file: string): string {
  return `${LANDING_BASE}/${file}`;
}

/**
 * Fetch the bucket manifest; fall back to the bundled default. Client-only —
 * nothing on the server (and nothing at build time) touches the bucket.
 */
export async function loadManifest(): Promise<LandingManifest> {
  try {
    const res = await fetch(`${LANDING_BASE}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_MANIFEST;
    const json = (await res.json()) as LandingManifest;
    return Array.isArray(json.plates) && json.plates.length > 0 ? json : DEFAULT_MANIFEST;
  } catch {
    return DEFAULT_MANIFEST;
  }
}
