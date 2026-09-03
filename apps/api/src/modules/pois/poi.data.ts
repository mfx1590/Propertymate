/**
 * Static points-of-interest seed for the §6.1 map layers.
 *
 * Three categories, chosen by the plan because they are what actually moves a
 * TRNC purchase decision: a university (the student-rental market and the
 * reason most of the north's new-build stock exists), a beach, and a hospital.
 *
 * **Why TypeScript and not the `.geo.json` the plan names.** `nest-cli.json`
 * declares no `assets`, so a JSON file under `src/` is never copied to `dist/`
 * — the endpoint would work in `nest start --watch` and 500 in production,
 * which is the worst possible place to find out. The service emits GeoJSON, so
 * what leaves the API is exactly what the plan specifies; only the storage
 * differs. Moving this to a database table would also be wrong: nothing here
 * is user-editable, and a seed that can drift from the code has to be
 * reconciled forever.
 *
 * Coordinates are landmark-accurate to within a few hundred metres — enough to
 * place a pin and to say "about 2 km from the beach", not a survey. The map
 * layer is orientation for someone who has never been to Cyprus, and the UI
 * says as much rather than implying a measured distance.
 *
 * `nameTr` is present where the Turkish name is what a sign, a taxi driver and
 * a deed will actually say. That is the name a foreign buyer needs to
 * recognise on the ground, so it is data, not decoration.
 */
export type PoiCategory = 'university' | 'beach' | 'hospital';

export const POI_CATEGORIES: readonly PoiCategory[] = ['university', 'beach', 'hospital'] as const;

export interface Poi {
  id: string;
  category: PoiCategory;
  name: string;
  /** Local name where it differs from the one above. */
  nameTr?: string;
  lat: number;
  lng: number;
}

export const POIS: readonly Poi[] = [
  // ── universities ────────────────────────────────────────────────
  { id: 'emu', category: 'university', name: 'Eastern Mediterranean University', nameTr: 'Doğu Akdeniz Üniversitesi', lat: 35.1418, lng: 33.9080 },
  { id: 'neu', category: 'university', name: 'Near East University', nameTr: 'Yakın Doğu Üniversitesi', lat: 35.2266, lng: 33.3193 },
  { id: 'ciu', category: 'university', name: 'Cyprus International University', nameTr: 'Uluslararası Kıbrıs Üniversitesi', lat: 35.1846, lng: 33.4008 },
  { id: 'gau', category: 'university', name: 'Girne American University', nameTr: 'Girne Amerikan Üniversitesi', lat: 35.3376, lng: 33.2610 },
  { id: 'kyrenia-uni', category: 'university', name: 'University of Kyrenia', nameTr: 'Girne Üniversitesi', lat: 35.3405, lng: 33.3160 },
  { id: 'final-uni', category: 'university', name: 'Final International University', nameTr: 'Final Uluslararası Üniversitesi', lat: 35.3419, lng: 33.3730 },
  { id: 'arucad', category: 'university', name: 'Arkin University of Creative Arts and Design', nameTr: 'Arkın Yaratıcı Sanatlar ve Tasarım Üniversitesi', lat: 35.3357, lng: 33.2793 },
  { id: 'eul', category: 'university', name: 'European University of Lefke', nameTr: 'Lefke Avrupa Üniversitesi', lat: 35.1122, lng: 32.8462 },
  { id: 'metu-ncc', category: 'university', name: 'METU Northern Cyprus Campus', nameTr: 'ODTÜ Kuzey Kıbrıs Kampüsü', lat: 35.2447, lng: 32.9895 },

  // ── beaches ─────────────────────────────────────────────────────
  { id: 'escape-beach', category: 'beach', name: 'Escape Beach', nameTr: 'Yavuz Çıkarma Plajı', lat: 35.3372, lng: 33.2295 },
  { id: 'camelot-beach', category: 'beach', name: 'Camelot Beach', lat: 35.3390, lng: 33.2050 },
  { id: 'denizkizi-beach', category: 'beach', name: 'Denizkızı Beach', nameTr: 'Denizkızı Plajı', lat: 35.3400, lng: 33.2160 },
  { id: 'alagadi-beach', category: 'beach', name: 'Alagadi Turtle Beach', nameTr: 'Alagadi Plajı', lat: 35.3350, lng: 33.4880 },
  { id: 'kaplica-beach', category: 'beach', name: 'Kaplıca Beach', nameTr: 'Kaplıca Plajı', lat: 35.4230, lng: 34.0850 },
  { id: 'bafra-beach', category: 'beach', name: 'Bafra Beach', nameTr: 'Bafra Plajı', lat: 35.4180, lng: 34.1000 },
  { id: 'long-beach', category: 'beach', name: 'Long Beach', nameTr: 'Uzunkum Plajı', lat: 35.2670, lng: 33.9070 },
  { id: 'glapsides-beach', category: 'beach', name: 'Glapsides Beach', nameTr: 'Glapsides Plajı', lat: 35.1600, lng: 33.9400 },
  { id: 'palm-beach', category: 'beach', name: 'Palm Beach', nameTr: 'Palm Beach Plajı', lat: 35.1140, lng: 33.9540 },
  { id: 'golden-beach', category: 'beach', name: 'Golden Beach (Karpaz)', nameTr: 'Altınkum Plajı', lat: 35.5560, lng: 34.4640 },

  // ── hospitals ───────────────────────────────────────────────────
  { id: 'nalbantoglu-hospital', category: 'hospital', name: 'Dr. Burhan Nalbantoğlu State Hospital', nameTr: 'Dr. Burhan Nalbantoğlu Devlet Hastanesi', lat: 35.1917, lng: 33.3520 },
  { id: 'neu-hospital', category: 'hospital', name: 'Near East University Hospital', nameTr: 'Yakın Doğu Üniversitesi Hastanesi', lat: 35.2280, lng: 33.3140 },
  { id: 'akcicek-hospital', category: 'hospital', name: 'Dr. Akçiçek State Hospital', nameTr: 'Dr. Akçiçek Devlet Hastanesi', lat: 35.3369, lng: 33.3230 },
  { id: 'kyrenia-uni-hospital', category: 'hospital', name: 'Dr. Suat Günsel University of Kyrenia Hospital', nameTr: 'Dr. Suat Günsel Girne Üniversitesi Hastanesi', lat: 35.3400, lng: 33.3115 },
  { id: 'famagusta-hospital', category: 'hospital', name: 'Famagusta State Hospital', nameTr: 'Gazimağusa Devlet Hastanesi', lat: 35.1215, lng: 33.9420 },
  { id: 'cengiz-topel-hospital', category: 'hospital', name: 'Cengiz Topel State Hospital', nameTr: 'Cengiz Topel Devlet Hastanesi', lat: 35.1990, lng: 32.9930 },
];
