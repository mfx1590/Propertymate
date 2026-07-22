/**
 * Demo data: ~50 live listings across the TRNC regions so the app looks real.
 * Resales are mediated (band profit + agent commission + list price, §13.5);
 * rentals are owner-direct. Idempotent — clears prior demo data, then reindexes
 * Meilisearch. Run: npm run db:demo
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MeiliSearch } from 'meilisearch';
import sharp from 'sharp';

const prisma = new PrismaClient();

const S3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT!,
  region: process.env.S3_REGION ?? 'auto',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! },
  forcePathStyle: true,
});
const MEDIA_BUCKET = process.env.S3_BUCKET_MEDIA ?? 'media';
const PUBLIC_BASE = process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${MEDIA_BUCKET}`;

const meili = new MeiliSearch({ host: process.env.MEILI_HOST ?? 'http://localhost:7700', apiKey: process.env.MEILI_MASTER_KEY });

const DEMO_OWNER_PHONE = '+905330000101';
const DEMO_AGENT_PHONE = '+905330000102';

// § profit bands (mirror of SettingsService.profitFor for standalone use)
function bandProfit(gbp: number): number {
  if (gbp < 50_000) return 1_000;
  if (gbp < 100_000) return 2_000;
  if (gbp < 200_000) return 4_000;
  if (gbp < 500_000) return 8_000;
  return 15_000;
}

const REGION_COORDS: Record<string, [number, number]> = {
  kyrenia: [35.3364, 33.3182],
  famagusta: [35.1264, 33.9391],
  iskele: [35.2857, 33.8916],
  nicosia: [35.1856, 33.3823],
  guzelyurt: [35.1983, 32.9931],
  lefke: [35.1103, 32.8481],
};
const DISTRICTS: Record<string, string[]> = {
  kyrenia: ['Alsancak', 'Lapta', 'Bellapais', 'Esentepe', 'Çatalköy'],
  famagusta: ['Sakarya', 'Yeni Boğaziçi', 'Tuzla', 'Maraş'],
  iskele: ['Long Beach', 'Boğaz', 'Bahçeler', 'Ötüken'],
  nicosia: ['Ortaköy', 'Gönyeli', 'Hamitköy', 'Yenikent'],
  guzelyurt: ['Merkez', 'Aydınköy', 'Gaziveren'],
  lefke: ['Merkez', 'Gemikonağı', 'Yeşilyurt'],
};
const DEED = ['turkish', 'exchange', 'allocation', 'foreign'] as const;
const FEATURES = ['pool', 'sea_view', 'mountain_view', 'garden', 'garage', 'balcony', 'air_conditioning', 'solar_water', 'white_goods', 'elevator'];
const PROP_TYPES = ['apartment', 'villa', 'penthouse', 'townhouse', 'studio', 'bungalow'];

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: readonly T[]): T => a[rand(a.length)];
const sample = <T>(a: T[], k: number) => [...a].sort(() => Math.random() - 0.5).slice(0, k);

async function uploadDemoPhotos(): Promise<string[]> {
  const palettes: [number, number, number][] = [
    [37, 99, 108], [70, 130, 120], [200, 170, 110], [120, 150, 180],
    [90, 120, 90], [170, 110, 90], [110, 130, 160], [150, 160, 120],
  ];
  const urls: string[] = [];
  for (let i = 0; i < palettes.length; i++) {
    const [r, g, b] = palettes[i];
    const svg = Buffer.from(
      `<svg width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${r},${g},${b})"/><stop offset="1" stop-color="rgb(${Math.min(r + 40, 255)},${Math.min(g + 40, 255)},${Math.min(b + 40, 255)})"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><text x="60" y="720" font-family="sans-serif" font-size="48" fill="rgba(255,255,255,0.85)">PropVerify demo</text></svg>`,
    );
    const jpg = await sharp(svg).jpeg({ quality: 80 }).toBuffer();
    const key = `demo/photo-${i}.jpg`;
    await S3.send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Body: jpg, ContentType: 'image/jpeg' }));
    urls.push(`${PUBLIC_BASE}/${key}`);
  }
  return urls;
}

async function ensureUser(phone: string, roleKey: string) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone, phoneVerifiedAt: new Date(), locale: 'en' } });
  }
  for (const key of ['customer', roleKey]) {
    const role = await prisma.role.findUnique({ where: { key } });
    if (!role) continue;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: { verificationStatus: 'verified', badgeTier: 'verified' },
      create: { userId: user.id, roleId: role.id, verificationStatus: 'verified', badgeTier: 'verified' },
    });
  }
  if (roleKey === 'solo_agent') {
    await prisma.agentProfile.upsert({
      where: { userId: user.id },
      update: { bio: 'Experienced TRNC agent', regions: Object.keys(REGION_COORDS) },
      create: { userId: user.id, bio: 'Experienced TRNC agent', regions: Object.keys(REGION_COORDS), dealCount: 12, ratingAvg: 4.7 },
    });
  }
  return user;
}

async function main() {
  const regions = await prisma.region.findMany({ where: { parentId: null } });
  if (regions.length === 0) throw new Error('Run the base seed first (npm run db:seed)');
  const regionBySlug = Object.fromEntries(regions.map((r) => [r.slug, r]));

  const owner = await ensureUser(DEMO_OWNER_PHONE, 'owner');
  const agent = await ensureUser(DEMO_AGENT_PHONE, 'solo_agent');

  // clear prior demo listings (cascade removes media)
  const prior = await prisma.property.findMany({
    where: { createdByUserId: { in: [owner.id, agent.id] } },
    select: { id: true },
  });
  if (prior.length) {
    const ids = prior.map((p) => p.id);
    await prisma.propertyMedia.deleteMany({ where: { propertyId: { in: ids } } });
    await prisma.property.deleteMany({ where: { id: { in: ids } } });
    try { await meili.index('listings').deleteDocuments(ids); } catch { /* meili optional */ }
  }

  const photos = await uploadDemoPhotos();
  console.log(`Uploaded ${photos.length} demo photos to MinIO`);

  const TOTAL = 50;
  const created: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const slug = pick(Object.keys(REGION_COORDS));
    const region = regionBySlug[slug];
    const [baseLat, baseLng] = REGION_COORDS[slug];
    const isRental = i % 3 === 0; // ~1/3 rentals
    const type = pick(PROP_TYPES);
    const beds = type === 'studio' ? 0 : 1 + rand(4);
    const baths = Math.max(1, beds - rand(2));
    const area = 45 + rand(220);
    const district = pick(DISTRICTS[slug]);
    const feats = sample(FEATURES, 2 + rand(4));
    const lat = baseLat + (Math.random() - 0.5) * 0.06;
    const lng = baseLng + (Math.random() - 0.5) * 0.06;
    const regionName = `${region.slug[0].toUpperCase()}${region.slug.slice(1)}`;
    const title =
      type === 'studio'
        ? `Studio in ${regionName}${isRental ? ' — for rent' : ''}`
        : `${beds}+1 ${type} in ${regionName}${isRental ? ' — for rent' : ''}`;
    const description = `A ${feats.slice(0, 2).join(' & ').replace(/_/g, ' ')} ${type} in ${district}, ${region.slug}. ${area} m², ${beds} bedrooms. Verified by PropVerify.`;

    const mediaUrls = sample(photos, 3 + rand(3));
    const mediaCreate = mediaUrls.map((url, idx) => ({ type: 'photo' as const, url, phash: null, sortOrder: idx }));

    if (isRental) {
      const monthly = 350 + rand(1500); // GBP/month
      const p = await prisma.property.create({
        data: {
          kind: 'rental', createdByUserId: owner.id,
          titleI18n: { en: title }, descriptionI18n: { en: description },
          regionId: region.id, district, lat, lng,
          priceAmount: monthly, priceCurrency: 'GBP', priceBaseGbp: monthly,
          bedrooms: beds, bathrooms: baths, areaM2: area,
          deedType: 'na', furnished: Math.random() > 0.4, features: feats,
          status: 'live', availabilityConfirmedAt: new Date(),
          media: { create: mediaCreate },
        },
      });
      created.push(p.id);
    } else {
      const ask = 55_000 + rand(445_000);
      const profit = bandProfit(ask);
      const commission = 2_000 + rand(6_000);
      const list = ask + profit + commission;
      const p = await prisma.property.create({
        data: {
          kind: 'resale', createdByUserId: owner.id, publishedByAgentId: agent.id,
          titleI18n: { en: title }, descriptionI18n: { en: description },
          regionId: region.id, district, lat, lng,
          priceAmount: ask, priceCurrency: 'GBP', priceBaseGbp: ask,
          platformProfitGbp: profit, agentCommissionGbp: commission, listPriceGbp: list,
          bedrooms: beds, bathrooms: baths, areaM2: area,
          deedType: pick(DEED), furnished: Math.random() > 0.5, features: feats,
          status: 'live', availabilityConfirmedAt: new Date(),
          media: { create: mediaCreate },
        },
      });
      created.push(p.id);
    }
  }
  console.log(`Created ${created.length} live demo listings`);

  // reindex Meilisearch
  const docs = [];
  for (const id of created) {
    const p = await prisma.property.findUnique({
      where: { id },
      include: { media: { orderBy: { sortOrder: 'asc' }, take: 1 }, region: { select: { slug: true, nameI18n: true } } },
    });
    if (!p) continue;
    const priceBaseGbp = p.listPriceGbp ? Number(p.listPriceGbp) : Number(p.priceBaseGbp);
    docs.push({
      id: p.id, kind: p.kind,
      title: (p.titleI18n as { en?: string }).en ?? '',
      description: ((p.descriptionI18n as { en?: string }).en ?? '').slice(0, 500),
      regionSlug: p.region.slug, regionName: (p.region.nameI18n as { en?: string }).en ?? p.region.slug,
      district: p.district, priceBaseGbp,
      priceAmount: p.listPriceGbp ? priceBaseGbp : Number(p.priceAmount),
      priceCurrency: p.listPriceGbp ? 'GBP' : p.priceCurrency,
      pricePerM2: p.areaM2 ? Math.round(priceBaseGbp / p.areaM2) : null,
      bedrooms: p.bedrooms, bathrooms: p.bathrooms, areaM2: p.areaM2,
      deedType: p.deedType, furnished: p.furnished,
      features: Array.isArray(p.features) ? (p.features as string[]) : [],
      coverUrl: p.media[0]?.url ?? null, createdAtTs: p.createdAt.getTime(),
      ...(p.lat && p.lng ? { _geo: { lat: p.lat, lng: p.lng } } : {}),
    });
  }
  try {
    await meili.index('listings').updateSettings({
      filterableAttributes: ['kind', 'regionSlug', 'bedrooms', 'bathrooms', 'deedType', 'furnished', 'priceBaseGbp', 'areaM2', 'features', '_geo'],
      sortableAttributes: ['priceBaseGbp', 'createdAtTs', 'pricePerM2'],
      searchableAttributes: ['title', 'description', 'regionName', 'district'],
    });
    await meili.index('listings').addDocuments(docs);
    console.log(`Indexed ${docs.length} documents into Meilisearch`);
  } catch (e) {
    console.warn('Meilisearch indexing skipped:', (e as Error).message);
  }

  console.log('\nDemo seed complete.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
