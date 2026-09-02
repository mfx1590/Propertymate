/**
 * Seed: roles, permissions (matrix from Plan §3), verification_requirements,
 * regions taxonomy, pipeline templates (Plan §7), super admin user.
 * Idempotent — safe to re-run (upserts everywhere).
 */
import { PrismaClient, VerificationContext, DealKind } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── roles ──────────────────────────────────────────────────────────
const ROLES = [
  { key: 'customer', name: 'Customer' },
  { key: 'owner', name: 'Owner' },
  { key: 'solo_agent', name: 'Solo Agent' },
  { key: 'agency', name: 'Agency' },
  { key: 'agency_member', name: 'Agency Member' },
  { key: 'developer', name: 'Developer' },
  { key: 'admin', name: 'Admin' },
];

// ── permission matrix (Plan §3) ────────────────────────────────────
const PERMISSIONS: Record<string, string[]> = {
  customer: [
    'search.saved.manage', 'favorite.manage',
    'viewing.request', 'offer.create',
    'chat.participate',
    // buyers complete their own deal stages (legal_check, deposit_recorded);
    // the deals service still enforces party + completesBy on every advance
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
  ],
  owner: [
    'listing.create', 'listing.update.own', 'listing.delete.own',
    'listing.delegate', 'listing.confirm_availability',
    'search.saved.manage', 'favorite.manage',
    'viewing.host', 'offer.respond',
    'chat.participate',
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
    'analytics.own.view',
  ],
  solo_agent: [
    'listing.create', 'listing.update.own', 'listing.delete.own',
    'listing.manage.mandated', 'listing.confirm_availability',
    'search.saved.manage', 'favorite.manage',
    'viewing.request', 'viewing.host', 'offer.create', 'offer.respond',
    'chat.participate',
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
    'analytics.own.view',
  ],
  agency: [
    'listing.create', 'listing.update.own', 'listing.delete.own',
    'listing.manage.mandated', 'listing.confirm_availability',
    'agency.agents.manage',
    'search.saved.manage', 'favorite.manage',
    'viewing.request', 'viewing.host', 'offer.create', 'offer.respond',
    'chat.participate',
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
    'analytics.own.view',
  ],
  // An agency member works listings exactly like a solo agent. `agents.manage`
  // is coarse here, as `listing.update.own` is elsewhere: the guard admits the
  // role and OrganizationsService enforces orgRole === 'org_admin' (§13.1).
  agency_member: [
    'listing.create', 'listing.update.own', 'listing.delete.own',
    'listing.manage.mandated', 'listing.confirm_availability',
    'agency.agents.manage',
    'search.saved.manage', 'favorite.manage',
    'viewing.request', 'viewing.host', 'offer.create', 'offer.respond',
    'chat.participate',
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
    'analytics.own.view',
  ],
  developer: [
    'project.create', 'project.update.own', 'project.unit.manage', 'project.update.publish',
    'search.saved.manage', 'favorite.manage',
    'offer.respond',
    'chat.participate',
    'deal.participate', 'deal.stage.complete', 'deal.document.upload',
    'rating.create', 'dispute.open', 'review.report',
    'analytics.own.view',
  ],
  admin: [
    'verification.review', 'user.manage', 'listing.moderate',
    'dispute.resolve', 'review.moderate', 'analytics.view', 'audit.view', 'cms.manage',
    'chat.participate', 'deal.participate',
  ],
};

// ── regions taxonomy (Plan §1) ─────────────────────────────────────
// Names in all four locales (§2.4). These reach the user directly — the region
// dropdown, the landing-page title, the mobile app — so leaving ru/fa as the
// English string, as this seed originally did, showed "Kyrenia" to a Russian
// reader on a page whose entire purpose was to be in Russian.
const REGIONS = [
  { slug: 'kyrenia', en: 'Kyrenia', tr: 'Girne', ru: 'Кирения', fa: 'گیرنه', lat: 35.3364, lng: 33.3182 },
  { slug: 'famagusta', en: 'Famagusta', tr: 'Gazimağusa', ru: 'Фамагуста', fa: 'فاماگوستا', lat: 35.1264, lng: 33.9391 },
  { slug: 'iskele', en: 'İskele', tr: 'İskele', ru: 'Искеле', fa: 'ایسکله', lat: 35.2857, lng: 33.8916 },
  { slug: 'nicosia', en: 'Nicosia', tr: 'Lefkoşa', ru: 'Никосия', fa: 'نیکوزیا', lat: 35.1856, lng: 33.3823 },
  { slug: 'guzelyurt', en: 'Güzelyurt', tr: 'Güzelyurt', ru: 'Гюзельюрт', fa: 'گوزل‌یورت', lat: 35.1983, lng: 32.9931 },
  { slug: 'lefke', en: 'Lefke', tr: 'Lefke', ru: 'Лефке', fa: 'لفکه', lat: 35.1103, lng: 32.8481 },
];

// ── verification requirements (Plan §3) ────────────────────────────
type ReqSeed = {
  roleKey: string | null;
  context: VerificationContext;
  documentType: string;
  isRequired: boolean;
  title: string;
  help?: string;
  sortOrder: number;
};

const REQUIREMENTS: ReqSeed[] = [
  // Owner listing (resale)
  { roleKey: 'owner', context: 'listing_resale', documentType: 'title_deed', isRequired: true, title: 'Title deed (koçan)', help: 'Tag the deed type: Turkish / Exchange (Eşdeğer) / Allocation (Tahsis) / Foreign', sortOrder: 1 },
  { roleKey: 'owner', context: 'listing_resale', documentType: 'owner_id', isRequired: true, title: 'Owner ID or passport', help: 'Name must match the title deed', sortOrder: 2 },
  { roleKey: 'owner', context: 'listing_resale', documentType: 'utility_bill', isRequired: true, title: 'Recent utility bill or council tax document', sortOrder: 3 },
  // Owner listing (rental)
  { roleKey: 'owner', context: 'listing_rental', documentType: 'title_deed', isRequired: false, title: 'Title deed (koçan)', help: 'Provide the title deed OR a rental authority document', sortOrder: 1 },
  { roleKey: 'owner', context: 'listing_rental', documentType: 'rental_authority', isRequired: false, title: 'Rental authority document', help: 'Required if you are not uploading the title deed', sortOrder: 2 },
  { roleKey: 'owner', context: 'listing_rental', documentType: 'owner_id', isRequired: true, title: 'Owner ID or passport', sortOrder: 3 },
  // Solo agent profile
  { roleKey: 'solo_agent', context: 'profile', documentType: 'government_id', isRequired: true, title: 'Government ID', sortOrder: 1 },
  { roleKey: 'solo_agent', context: 'profile', documentType: 'real_estate_license', isRequired: true, title: 'Real estate license / authorization', sortOrder: 2 },
  { roleKey: 'solo_agent', context: 'profile', documentType: 'selfie_with_id', isRequired: true, title: 'Selfie holding your ID', help: 'Face and ID text must both be clearly visible', sortOrder: 3 },
  // Solo agent per-listing mandate
  { roleKey: 'solo_agent', context: 'listing_resale', documentType: 'owner_mandate', isRequired: true, title: 'Signed owner mandate', help: 'Signed authorization from the property owner', sortOrder: 10 },
  { roleKey: 'solo_agent', context: 'listing_rental', documentType: 'owner_mandate', isRequired: true, title: 'Signed owner mandate', help: 'Signed authorization from the property owner', sortOrder: 10 },
  // Agency profile
  { roleKey: 'agency', context: 'profile', documentType: 'business_registration', isRequired: true, title: 'Business registration', sortOrder: 1 },
  { roleKey: 'agency', context: 'profile', documentType: 'tax_number', isRequired: true, title: 'Tax number certificate', sortOrder: 2 },
  { roleKey: 'agency', context: 'profile', documentType: 'real_estate_license', isRequired: true, title: 'Agency license', sortOrder: 3 },
  { roleKey: 'agency', context: 'profile', documentType: 'office_address_proof', isRequired: true, title: 'Office address proof', sortOrder: 4 },
  { roleKey: 'agency', context: 'profile', documentType: 'signatory_id', isRequired: true, title: 'Authorized signatory ID', sortOrder: 5 },
  // Developer profile
  { roleKey: 'developer', context: 'profile', documentType: 'company_registration', isRequired: true, title: 'Company registration', sortOrder: 1 },
  { roleKey: 'developer', context: 'profile', documentType: 'tax_number', isRequired: true, title: 'Tax number certificate', sortOrder: 2 },
  { roleKey: 'developer', context: 'profile', documentType: 'portfolio', isRequired: false, title: 'Company portfolio', sortOrder: 3 },
  // Developer per-project
  { roleKey: 'developer', context: 'project', documentType: 'construction_permit', isRequired: true, title: 'Construction permit', sortOrder: 1 },
  { roleKey: 'developer', context: 'project', documentType: 'project_plans', isRequired: true, title: 'Project plans', sortOrder: 2 },
];

// ── pipeline templates (Plan §7) ───────────────────────────────────
const t = (en: string, tr: string) => ({ en, tr, ru: en, fa: en });

const PURCHASE_STAGES = [
  { key: 'inquiry', titleI18n: t('Inquiry', 'Talep'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: [], notifications: [] },
  { key: 'viewing', titleI18n: t('Viewing', 'Görüntüleme'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: [], notifications: ['viewing.confirmed'] },
  { key: 'offer', titleI18n: t('Offer', 'Teklif'), requiredDocuments: [], completesBy: 'seller', injectableServiceTypes: [], notifications: ['offer.received'] },
  { key: 'offer_accepted', titleI18n: t('Offer accepted', 'Teklif kabul edildi'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: [], notifications: ['offer.accepted'], createsSnapshot: true },
  { key: 'legal_check', titleI18n: t('Legal check', 'Hukuki kontrol'), requiredDocuments: [], completesBy: 'buyer', injectableServiceTypes: ['lawyer'], notifications: ['deal.stage_advanced'] },
  { key: 'contract_signing', titleI18n: t('Contract signing', 'Sözleşme imzalama'), requiredDocuments: ['contract'], completesBy: 'both_parties', injectableServiceTypes: ['lawyer', 'notary_translation'], notifications: ['deal.stage_advanced'] },
  { key: 'deposit_recorded', titleI18n: t('Deposit recorded', 'Depozito kaydedildi'), requiredDocuments: ['deposit_receipt'], completesBy: 'buyer', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'permit_process', titleI18n: t('Purchase permit (foreign buyers)', 'Satın alma izni (yabancı alıcılar)'), requiredDocuments: [], completesBy: 'buyer', injectableServiceTypes: ['lawyer'], notifications: ['deal.stage_advanced'], skippable: true },
  { key: 'completion', titleI18n: t('Completion & handover', 'Tamamlama ve teslim'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: [], notifications: ['deal.completed'] },
  { key: 'post_deal', titleI18n: t('Post-deal services', 'Satış sonrası hizmetler'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: ['furniture', 'movers', 'insurance'], notifications: [], skippable: true },
];

const RENTAL_STAGES = [
  { key: 'inquiry', titleI18n: t('Inquiry', 'Talep'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: [], notifications: [] },
  { key: 'viewing', titleI18n: t('Viewing', 'Görüntüleme'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: [], notifications: ['viewing.confirmed'] },
  { key: 'application', titleI18n: t('Application', 'Başvuru'), requiredDocuments: ['government_id'], completesBy: 'buyer', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'landlord_approval', titleI18n: t('Landlord approval', 'Ev sahibi onayı'), requiredDocuments: [], completesBy: 'seller', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'contract', titleI18n: t('Contract', 'Sözleşme'), requiredDocuments: ['contract'], completesBy: 'both_parties', injectableServiceTypes: ['notary_translation'], notifications: ['deal.stage_advanced'] },
  { key: 'deposit_recorded', titleI18n: t('Deposit recorded', 'Depozito kaydedildi'), requiredDocuments: ['deposit_receipt'], completesBy: 'buyer', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'move_in_checklist', titleI18n: t('Move-in checklist', 'Taşınma kontrol listesi'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: ['movers'], notifications: ['deal.stage_advanced'] },
  { key: 'active_tenancy', titleI18n: t('Active tenancy', 'Aktif kiracılık'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: ['property_management', 'insurance'], notifications: [] },
  { key: 'renewal_or_exit', titleI18n: t('Renewal / exit checklist', 'Yenileme / çıkış kontrol listesi'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: ['movers'], notifications: ['deal.stage_advanced'] },
];

// Off-plan developer sale (§6.3): the reservation IS the deal — there is no
// offer/counter-offer round, the buyer reserves a unit at the published price.
const PROJECT_PURCHASE_STAGES = [
  { key: 'reservation', titleI18n: t('Reservation', 'Rezervasyon'), requiredDocuments: [], completesBy: 'seller', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'legal_check', titleI18n: t('Legal check', 'Hukuki kontrol'), requiredDocuments: [], completesBy: 'buyer', injectableServiceTypes: ['lawyer'], notifications: ['deal.stage_advanced'] },
  { key: 'contract_signing', titleI18n: t('Contract signing', 'Sözleşme imzalama'), requiredDocuments: ['contract'], completesBy: 'both_parties', injectableServiceTypes: ['lawyer', 'notary_translation'], notifications: ['deal.stage_advanced'] },
  { key: 'deposit_recorded', titleI18n: t('Down payment recorded', 'Peşinat kaydedildi'), requiredDocuments: ['deposit_receipt'], completesBy: 'buyer', injectableServiceTypes: [], notifications: ['deal.stage_advanced'] },
  { key: 'permit_process', titleI18n: t('Purchase permit (foreign buyers)', 'Satın alma izni (yabancı alıcılar)'), requiredDocuments: [], completesBy: 'buyer', injectableServiceTypes: ['lawyer'], notifications: ['deal.stage_advanced'], skippable: true },
  { key: 'construction', titleI18n: t('Construction & installments', 'İnşaat ve taksitler'), requiredDocuments: [], completesBy: 'seller', injectableServiceTypes: [], notifications: ['project.update_published'] },
  { key: 'completion', titleI18n: t('Completion & handover', 'Tamamlama ve teslim'), requiredDocuments: [], completesBy: 'both_parties', injectableServiceTypes: [], notifications: ['deal.completed'] },
  { key: 'post_deal', titleI18n: t('Post-deal services', 'Satış sonrası hizmetler'), requiredDocuments: [], completesBy: 'system', injectableServiceTypes: ['furniture', 'movers', 'insurance'], notifications: [], skippable: true },
];

async function main() {
  // roles
  const roleByKey: Record<string, string> = {};
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: r.key },
      update: { name: r.name },
      create: r,
    });
    roleByKey[r.key] = role.id;
  }

  // permissions + role_permissions
  const allPermissionKeys = [...new Set(Object.values(PERMISSIONS).flat())];
  const permByKey: Record<string, string> = {};
  for (const key of allPermissionKeys) {
    const p = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    permByKey[key] = p.id;
  }
  for (const [roleKey, permKeys] of Object.entries(PERMISSIONS)) {
    for (const permKey of permKeys) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleByKey[roleKey], permissionId: permByKey[permKey] } },
        update: {},
        create: { roleId: roleByKey[roleKey], permissionId: permByKey[permKey] },
      });
    }
  }

  // regions
  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { slug: region.slug },
      // Names and coordinates are corrected on re-seed. `update: {}` meant an
      // existing database kept whatever it was first given — so fixing a
      // translation here would never have reached a deployed environment.
      update: {
        nameI18n: { en: region.en, tr: region.tr, ru: region.ru, fa: region.fa },
        lat: region.lat,
        lng: region.lng,
      },
      create: {
        slug: region.slug,
        nameI18n: { en: region.en, tr: region.tr, ru: region.ru, fa: region.fa },
        lat: region.lat,
        lng: region.lng,
      },
    });
  }

  // verification requirements (delete+recreate: config data, no FKs pointing at it)
  await prisma.verificationRequirement.deleteMany({});
  for (const req of REQUIREMENTS) {
    await prisma.verificationRequirement.create({
      data: {
        roleId: req.roleKey ? roleByKey[req.roleKey] : null,
        context: req.context,
        documentType: req.documentType,
        isRequired: req.isRequired,
        titleI18n: { en: req.title },
        helpI18n: req.help ? { en: req.help } : undefined,
        sortOrder: req.sortOrder,
      },
    });
  }

  // pipeline templates — resolved by key; project units reuse DealKind.purchase (§6.3)
  const TEMPLATES: Array<[string, DealKind, object[]]> = [
    ['purchase', DealKind.purchase, PURCHASE_STAGES],
    ['rental', DealKind.rental, RENTAL_STAGES],
    ['project_purchase', DealKind.purchase, PROJECT_PURCHASE_STAGES],
  ];
  for (const [key, kind, stages] of TEMPLATES) {
    await prisma.pipelineTemplate.upsert({
      where: { key },
      update: { kind, stages },
      create: { key, kind, stages },
    });
  }

  // FX rates: GBP base (Plan §1) — static seed; daily-refresh job comes with hardening
  const FX: Array<[string, number]> = [['GBP', 1], ['EUR', 1.17], ['USD', 1.27], ['TRY', 52.0]];
  for (const [quote, rate] of FX) {
    await prisma.fxRate.upsert({
      where: { base_quote: { base: 'GBP', quote } },
      update: { rate, fetchedAt: new Date() },
      create: { base: 'GBP', quote, rate },
    });
  }

  // ── marketplace core (§13) defaults ──────────────────────────────
  const SETTINGS: Array<[string, unknown]> = [
    ['assignment.max_agents', 3],            // owner picks up to N agents (§13.4)
    ['assignment.min_term_months', 1],
    ['assignment.max_term_months', 6],
    ['resale.mode', 'agent_only'],           // future toggle: 'owner_direct_allowed'
    ['reviews.warnings_before_ban', 3],
  ];
  for (const [key, value] of SETTINGS) {
    await prisma.platformSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as object },
    });
  }

  // §13.5 example profit bands — fully editable in the main admin dashboard
  if ((await prisma.profitBand.count()) === 0) {
    await prisma.profitBand.createMany({
      data: [
        { minPriceGbp: 0, maxPriceGbp: 50_000, profitGbp: 1_000 },
        { minPriceGbp: 50_000, maxPriceGbp: 100_000, profitGbp: 2_000 },
        { minPriceGbp: 100_000, maxPriceGbp: 200_000, profitGbp: 4_000 },
        { minPriceGbp: 200_000, maxPriceGbp: 500_000, profitGbp: 8_000 },
        { minPriceGbp: 500_000, maxPriceGbp: 100_000_000, profitGbp: 15_000 },
      ],
    });
  }

  // §13.3 basic plan per user type (tiers TBD; admin-granted until Phase 3)
  const PLANS = [
    { key: 'customer_free', name: 'Customer Free', roleKey: 'customer', tier: 0 },
    { key: 'owner_basic', name: 'Owner Basic', roleKey: 'owner', tier: 1 },
    { key: 'agent_basic', name: 'Agent Basic', roleKey: 'solo_agent', tier: 1 },
    { key: 'agency_basic', name: 'Agency Basic', roleKey: 'agency', tier: 1 },
    { key: 'developer_basic', name: 'Developer Basic', roleKey: 'developer', tier: 1 },
  ];
  for (const p of PLANS) {
    await prisma.plan.upsert({ where: { key: p.key }, update: { name: p.name, tier: p.tier }, create: p });
  }

  // super admin (dev credentials — change in production)
  const adminEmail = 'admin@propverify.local';
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash('Admin123!', 10),
      phone: '+905000000000',
      phoneVerifiedAt: new Date(),
      locale: 'en',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roleByKey['admin'] } },
    update: { verificationStatus: 'verified', badgeTier: 'verified' },
    create: {
      userId: admin.id,
      roleId: roleByKey['admin'],
      verificationStatus: 'verified',
      badgeTier: 'verified',
    },
  });
  await prisma.adminProfile.upsert({
    where: { userId: admin.id },
    update: { subRole: 'super_admin' },
    create: { userId: admin.id, subRole: 'super_admin' },
  });

  console.log('Seed complete:');
  console.log(`  roles: ${ROLES.length}, permissions: ${allPermissionKeys.length}`);
  console.log(`  regions: ${REGIONS.length}, verification requirements: ${REQUIREMENTS.length}`);
  console.log(`  pipeline templates: ${TEMPLATES.map(([key]) => key).join(', ')}`);
  console.log(`  super admin: ${adminEmail} / Admin123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
