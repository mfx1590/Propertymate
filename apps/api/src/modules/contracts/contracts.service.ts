import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContractPdfService, type ContractSpec } from './pdf.service';
import {
  contractCopy,
  contractLocale,
  NOT_IN_YOUR_LANGUAGE,
  type ContractLocale,
} from './contract-copy';

/**
 * The rental pipeline's contract stage (Plan §7). Purchase and off-plan deals
 * also have a `contract_signing` stage, but a sale agreement is a different
 * document with different clauses — §10.2 scopes this to rental contracts, and
 * those deals continue to attach a lawyer-drafted PDF by hand.
 */
const CONTRACT_STAGE = 'contract';
/** Both purchase pipelines (resale and off-plan) produce their document here. */
const SALE_CONTRACT_STAGE = 'contract_signing';

/** Who must sign a tenancy: the principals, not their agents. */
const SIGNATORY_ROLES = ['buyer', 'seller'];

const PARTY_LABEL: Record<string, string> = {
  buyer: 'Tenant',
  seller: 'Landlord',
  agent_seller_side: 'Landlord agent',
  agent_buyer_side: 'Tenant agent',
};

/** A sale is between a buyer and a seller, not a tenant and a landlord. */
const SALE_PARTY_LABEL: Record<string, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  agent_seller_side: 'Seller agent',
  agent_buyer_side: 'Buyer agent',
};

/** A mandate is signed by the owner and the appointed agent (§13.4). */
const MANDATE_PARTY_LABEL: Record<string, string> = {
  seller: 'Owner',
  agent_seller_side: 'Appointed agent',
};

/**
 * Contract generation + typed e-sign (Plan §7, §6.2).
 *
 * The generated PDF is an ordinary `documents` row, so it inherits the private
 * bucket and short-lived signed URLs (§2.4) instead of a parallel store. The
 * document is re-rendered as signatures land, which is why the storage key is
 * overwritten rather than versioned: a tenancy has exactly one contract, and
 * the signature history lives in `contract_signatures` where it is queryable.
 */
/** Which role names a document uses depends on what kind of document it is. */
function partyLabels(kind: string): Record<string, string> {
  if (kind === 'agent_mandate') return MANDATE_PARTY_LABEL;
  if (kind === 'purchase_sale' || kind === 'offplan_sale') return SALE_PARTY_LABEL;
  return PARTY_LABEL;
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: ContractPdfService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Generates the tenancy contract for a deal, or returns the existing one. */
  async generateForDeal(userId: string, dealId: string, ip?: string) {
    const deal = await this.loadDeal(dealId);
    if (!deal.parties.some((p) => p.userId === userId)) {
      throw new ForbiddenException('Not a party to this deal');
    }

    // Idempotent, and checked before the stage guard: once a contract exists,
    // asking for it again should hand it back rather than fail because the deal
    // has since moved on to the deposit stage.
    const existing = await this.prisma.contract.findFirst({ where: { dealId } });
    if (existing) return this.detail(userId, existing.id);

    // A rental produces a tenancy; a purchase produces a sale agreement, and an
    // off-plan purchase a materially different one again — stage payments, a
    // delivery date and snagging rather than a single completion.
    const isRental = deal.kind === 'rental';
    const isOffPlan = !isRental && Boolean(deal.projectUnitId);
    const kind: 'rental_tenancy' | 'purchase_sale' | 'offplan_sale' = isRental
      ? 'rental_tenancy'
      : isOffPlan
        ? 'offplan_sale'
        : 'purchase_sale';

    const expectedStage = isRental ? CONTRACT_STAGE : SALE_CONTRACT_STAGE;
    if (deal.currentStageKey !== expectedStage) {
      throw new BadRequestException(
        `The contract is produced at the ${expectedStage} stage (deal is at ${deal.currentStageKey})`,
      );
    }

    const signatories = deal.parties.filter((p) => SIGNATORY_ROLES.includes(p.partyRole));
    if (signatories.length < 2) {
      throw new BadRequestException('Both principals must be on the deal before a contract exists');
    }

    // One contract, one language: recorded at generation from the locale of
    // whoever pressed the button, so both parties always see the same document
    // rather than two renderings that could differ.
    const requestedLocale = (await this.localeOf(userId)) ?? 'en';
    const locale = contractLocale(requestedLocale);
    const terms = { ...this.termsFor(deal), kind, locale, requestedLocale };
    const document = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'deal',
        entityId: dealId,
        documentType: 'contract',
        // filled immediately below, once the PDF that matches these rows exists
        storageKey: '',
        mime: 'application/pdf',
        size: 0,
        sha256: '',
        status: 'approved', // platform-generated, not an admin-verified upload
      },
    });

    const contract = await this.prisma.contract.create({
      data: {
        kind,
        dealId,
        propertyId: deal.propertyId,
        documentId: document.id,
        terms: terms as unknown as Prisma.InputJsonValue,
        signatures: {
          create: signatories.map((p) => ({ userId: p.userId, partyRole: p.partyRole })),
        },
      },
    });

    // visible in the deal room from the moment it exists, even unsigned
    await this.prisma.dealDocument.create({
      data: { dealId, documentId: document.id, stageKey: deal.currentStageKey },
    });
    await this.prisma.dealEvent.create({
      data: {
        dealId,
        actorId: userId,
        eventType: 'contract.generated',
        payload: { contractId: contract.id },
      },
    });

    await this.renderAndStore(contract.id);
    await this.audit.log({
      actorId: userId,
      action: 'contract.generated',
      entityType: 'contract',
      entityId: contract.id,
      after: { dealId, kind },
      ip,
    });

    for (const p of signatories.filter((s) => s.userId !== userId)) {
      await this.notifications.notify(p.userId, 'deal.stage_advanced', { dealId });
    }

    return this.detail(userId, contract.id);
  }

  /**
   * Types a signature. The legal weight of a typed signature is the audit trail
   * around it, so the typed text, the timestamp and the IP are all recorded and
   * reprinted on the document itself.
   */
  async sign(userId: string, contractId: string, typedName: string, ip?: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { signatures: true },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    if (contract.status === 'void') throw new BadRequestException('This contract was voided');

    const mine = contract.signatures.find((s) => s.userId === userId);
    if (!mine) throw new ForbiddenException('You are not a signatory to this contract');
    if (mine.signedAt) throw new BadRequestException('You have already signed');

    const name = typedName?.trim() ?? '';
    if (name.length < 2) throw new BadRequestException('Type your full name to sign');

    await this.prisma.contractSignature.update({
      where: { id: mine.id },
      data: { typedName: name, signedAt: new Date(), ip: ip ?? null },
    });

    const remaining = await this.prisma.contractSignature.count({
      where: { contractId, signedAt: null },
    });
    if (remaining === 0) {
      await this.prisma.contract.update({
        where: { id: contractId },
        data: { status: 'signed', signedAt: new Date() },
      });
    }

    // reprint so the PDF always matches the signature record
    await this.renderAndStore(contractId);

    if (contract.dealId) {
      await this.prisma.dealEvent.create({
        data: {
          dealId: contract.dealId,
          actorId: userId,
          eventType: remaining === 0 ? 'contract.signed' : 'contract.signature_added',
          payload: { contractId },
        },
      });
    }
    await this.audit.log({
      actorId: userId,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: contractId,
      after: { typedName: name, remaining },
      ip,
    });

    for (const s of contract.signatures.filter((s) => s.userId !== userId)) {
      await this.notifications.notify(s.userId, 'deal.stage_advanced', { dealId: contract.dealId });
    }

    return this.detail(userId, contractId);
  }

  /** Contract state for a party, plus a short-lived URL for the PDF (§2.4). */
  async detail(userId: string, contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        signatures: {
          include: { user: { select: { id: true, phone: true, email: true } } },
        },
        document: { select: { id: true, storageKey: true, size: true } },
      },
    });
    if (!contract) throw new NotFoundException('Contract not found');
    await this.assertVisible(userId, contract.dealId, contract.signatures.map((s) => s.userId));

    return {
      id: contract.id,
      kind: contract.kind,
      status: contract.status,
      dealId: contract.dealId,
      terms: contract.terms,
      documentId: contract.document.id,
      /** the viewer's own outstanding action, so the UI needs no second call */
      mySignature: this.shapeSignature(contract.signatures.find((s) => s.userId === userId)),
      signatures: contract.signatures.map((s) => this.shapeSignature(s)),
      createdAt: contract.createdAt,
      signedAt: contract.signedAt,
    };
  }

  async forDeal(userId: string, dealId: string) {
    const contract = await this.prisma.contract.findFirst({ where: { dealId } });
    if (!contract) return null;
    return this.detail(userId, contract.id);
  }

  /** True when the deal has a contract still waiting on someone (stage gate). */
  async hasUnsignedContract(dealId: string): Promise<boolean> {
    const count = await this.prisma.contract.count({
      where: { dealId, status: 'awaiting_signatures' },
    });
    return count > 0;
  }

  private shapeSignature(
    s?: {
      userId: string;
      partyRole: string;
      typedName: string | null;
      signedAt: Date | null;
      user?: { phone: string | null; email: string | null };
    },
  ) {
    if (!s) return null;
    return {
      userId: s.userId,
      partyRole: s.partyRole,
      label: PARTY_LABEL[s.partyRole] ?? s.partyRole,
      // the signed name is public to the counterparty — it is on the contract —
      // but contact details are not part of this payload
      typedName: s.typedName,
      signedAt: s.signedAt,
      signed: Boolean(s.signedAt),
    };
  }

  private async assertVisible(userId: string, dealId: string | null, signatoryIds: string[]) {
    if (signatoryIds.includes(userId)) return;
    if (dealId) {
      const party = await this.prisma.dealParty.count({ where: { dealId, userId } });
      if (party > 0) return; // an agent on the deal may read it without signing
    }
    const admin = await this.prisma.userRole.count({ where: { userId, role: { key: 'admin' } } });
    if (admin > 0) return;
    throw new ForbiddenException('Not allowed to view this contract');
  }

  private async loadDeal(dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        parties: { include: { user: { select: { id: true, phone: true, email: true } } } },
        snapshot: true,
        property: {
          select: {
            titleI18n: true,
            district: true,
            deedType: true,
            region: { select: { nameI18n: true } },
          },
        },
        projectUnit: { select: { project: { select: { deliveryDate: true } } } },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  /**
   * Generates (or returns) the agent mandate for an accepted assignment.
   *
   * This is the instrument that actually authorises an agent to market someone
   * else's property under §13.4 — until now an agent could publish a private
   * resale with nothing signed at all, which is a strange gap in a platform
   * whose whole premise is that paperwork was checked.
   *
   * Scoped to the assignment rather than a deal: a mandate is signed long
   * before any buyer exists, and it survives the deal that may never happen.
   */
  async generateForAssignment(userId: string, assignmentId: string, ip?: string) {
    const assignment = await this.prisma.agentAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (![assignment.ownerUserId, assignment.agentUserId].includes(userId)) {
      throw new ForbiddenException('Not a party to this assignment');
    }

    const existing = await this.prisma.contract.findFirst({ where: { assignmentId } });
    if (existing) return this.detail(userId, existing.id);

    // Only once the agent has taken the instruction. An invited-but-unanswered
    // assignment has nothing to put a signature against.
    if (assignment.status !== 'accepted') {
      throw new BadRequestException(
        `A mandate exists once the agent accepts (assignment is ${assignment.status})`,
      );
    }

    const property = await this.prisma.property.findUnique({
      where: { id: assignment.propertyId },
      select: {
        titleI18n: true,
        district: true,
        priceBaseGbp: true,
        region: { select: { nameI18n: true } },
      },
    });

    const requestedLocale = (await this.localeOf(userId)) ?? 'en';
    const locale = contractLocale(requestedLocale);
    const terms = {
      locale,
      requestedLocale,
      propertyTitle: (property?.titleI18n as { en?: string })?.en ?? '',
      address: [property?.district, (property?.region.nameI18n as { en?: string })?.en]
        .filter(Boolean)
        .join(', '),
      ownerAskGbp: property ? Number(property.priceBaseGbp) : null,
      termMonths: assignment.termMonths,
      expiresAt: assignment.expiresAt.toISOString(),
      generatedAt: new Date().toISOString(),
    };

    const document = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'assignment',
        entityId: assignmentId,
        documentType: 'agent_mandate',
        storageKey: '',
        mime: 'application/pdf',
        size: 0,
        sha256: '',
        status: 'approved',
      },
    });

    const contract = await this.prisma.contract.create({
      data: {
        kind: 'agent_mandate',
        assignmentId,
        propertyId: assignment.propertyId,
        documentId: document.id,
        terms: terms as unknown as Prisma.InputJsonValue,
        signatures: {
          create: [
            { userId: assignment.ownerUserId, partyRole: 'seller' },
            { userId: assignment.agentUserId, partyRole: 'agent_seller_side' },
          ],
        },
      },
    });

    await this.renderAndStore(contract.id);
    await this.audit.log({
      actorId: userId,
      action: 'contract.generated',
      entityType: 'contract',
      entityId: contract.id,
      after: { assignmentId, kind: 'agent_mandate' },
      ip,
    });

    const other =
      userId === assignment.ownerUserId ? assignment.agentUserId : assignment.ownerUserId;
    await this.notifications
      .notify(other, 'assignment.accepted', { title: terms.propertyTitle })
      .catch(() => undefined);

    return this.detail(userId, contract.id);
  }

  /** The mandate for an assignment, or null before one is generated. */
  async mandateForAssignment(userId: string, assignmentId: string) {
    const assignment = await this.prisma.agentAssignment.findUnique({
      where: { id: assignmentId },
      select: { ownerUserId: true, agentUserId: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (![assignment.ownerUserId, assignment.agentUserId].includes(userId)) {
      throw new ForbiddenException('Not a party to this assignment');
    }
    const contract = await this.prisma.contract.findFirst({ where: { assignmentId } });
    return contract ? this.detail(userId, contract.id) : null;
  }

  /**
   * Whether a signed mandate exists — read by the publish guard (§13.4) when
   * `mandate.required_before_publish` is on.
   */
  async assignmentMandateSigned(assignmentId: string): Promise<boolean> {
    const contract = await this.prisma.contract.findFirst({
      where: { assignmentId },
      select: { status: true },
    });
    return contract?.status === 'signed';
  }

  private async localeOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale ?? null;
  }

  private termsFor(deal: Awaited<ReturnType<ContractsService['loadDeal']>>) {
    const price = deal.snapshot ? Number(deal.snapshot.priceAgreed) : null;
    const region = (deal.property?.region.nameI18n as { en?: string })?.en ?? '';
    return {
      propertyTitle: (deal.property?.titleI18n as { en?: string })?.en ?? '',
      address: [deal.property?.district, region].filter(Boolean).join(', '),
      /** Same agreed figure; named per document so the PDF reads naturally. */
      rentAmount: price,
      priceAgreed: price,
      deedType: deal.property?.deedType ?? 'na',
      deliveryDate: deal.projectUnit?.project?.deliveryDate?.toISOString() ?? null,
      currency: deal.snapshot?.currency ?? 'GBP',
      /** TRNC residential tenancies are conventionally annual */
      termMonths: 12,
      /** one month, the market norm — recorded so the PDF and record agree */
      depositMonths: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Renders the current state of the contract and overwrites its document. */
  private async renderAndStore(contractId: string) {
    const contract = await this.prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: {
        signatures: { include: { user: { select: { phone: true, email: true } } } },
        document: true,
        deal: {
          include: {
            property: { select: { titleI18n: true, district: true, region: { select: { nameI18n: true } } } },
          },
        },
      },
    });

    // Role names are translated here rather than in each spec: they come from a
    // per-kind English map, and a Russian contract naming its parties "Buyer"
    // and "Seller" would be the same half-finished job the font fixed.
    const docLocale = contractLocale((contract.terms as { locale?: ContractLocale })?.locale);
    const roleNames = contractCopy(docLocale).labels;
    const parties = contract.signatures.map((sig) => {
      const english = partyLabels(contract.kind)[sig.partyRole] ?? sig.partyRole;
      return {
        role: roleNames[english] ?? english,
        name: sig.user.email ?? sig.user.phone ?? sig.userId,
        typedName: sig.typedName,
        signedAt: sig.signedAt,
      };
    });

    if (contract.kind === 'agent_mandate') {
      const buffer = await this.pdf.render(this.mandateSpec(contract, parties));
      await this.store(contract, buffer);
      return;
    }

    if (contract.kind === 'purchase_sale' || contract.kind === 'offplan_sale') {
      const buffer = await this.pdf.render(
        this.saleSpec(contract, parties, contract.kind === 'offplan_sale'),
      );
      await this.store(contract, buffer);
      return;
    }

    const terms = contract.terms as {
      propertyTitle: string;
      address: string;
      rentAmount: number | null;
      currency: string;
      termMonths: number;
      depositMonths: number;
      locale?: ContractLocale;
      requestedLocale?: string;
    };
    const money = (n: number | null) =>
      n === null ? '—' : `${terms.currency} ${n.toLocaleString('en-GB')}`;
    const copy = contractCopy(contractLocale(terms.locale));
    const label = (k: string) => copy.labels[k] ?? k;
    // Says so on the page when the reader's language could not be rendered,
    // rather than handing them English with no explanation.
    const fallbackNote = terms.requestedLocale
      ? NOT_IN_YOUR_LANGUAGE[terms.requestedLocale]
      : undefined;

    const spec: ContractSpec = {
      title: copy.tenancyTitle,
      reference: copy.reference(contract.id),
      intro: fallbackNote ? `${fallbackNote}

${copy.intro}` : copy.intro,
      facts: [
        [label('Property'), terms.propertyTitle || '—'],
        [label('Address'), terms.address || '—'],
        [label('Rent'), money(terms.rentAmount)],
        [label('Term'), copy.months(terms.termMonths)],
        [label('Deposit'), copy.depositMonths(terms.depositMonths)],
        [label('Agreement date'), new Date(contract.createdAt).toISOString().slice(0, 10)],
      ],
      clauses: copy.tenancyClauses({
        rent: money(terms.rentAmount),
        depositMonths: terms.depositMonths,
      }),
      parties,
      footer: copy.footer,
    };

    const buffer = await this.pdf.render(spec);
    await this.store(contract, buffer);
  }

  /** One storage path for every contract kind, so they cannot drift apart. */
  private async store(
    contract: { id: string; documentId: string; document: { storageKey: string } },
    buffer: Buffer,
  ) {
    const key = contract.document.storageKey || `contracts/${contract.id}.pdf`;
    await this.storage.putPrivateDocument(key, buffer, 'application/pdf');
    await this.prisma.document.update({
      where: { id: contract.documentId },
      data: {
        storageKey: key,
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      },
    });
  }

  /**
   * Sale agreement, resale or off-plan (§7 purchase pipelines).
   *
   * The deed type is stated as a named legal category rather than translated
   * into a description: in the TRNC it decides what a buyer actually receives,
   * and a loose paraphrase in a signed document would be worse than the term.
   */
  private saleSpec(
    contract: { id: string; createdAt: Date; terms: unknown },
    parties: ContractSpec['parties'],
    offPlan: boolean,
  ): ContractSpec {
    const terms = contract.terms as {
      propertyTitle: string;
      address: string;
      priceAgreed: number | null;
      currency: string;
      deedType: string;
      deliveryDate: string | null;
      locale?: ContractLocale;
      requestedLocale?: string;
    };
    const copy = contractCopy(contractLocale(terms.locale));
    const label = (k: string) => copy.labels[k] ?? k;
    const fallbackNote = terms.requestedLocale
      ? NOT_IN_YOUR_LANGUAGE[terms.requestedLocale]
      : undefined;

    const price =
      terms.priceAgreed === null
        ? '—'
        : `${terms.currency ?? 'GBP'} ${terms.priceAgreed.toLocaleString('en-GB')}`;
    const deed = copy.deedTypes[terms.deedType] ?? copy.deedTypes.na;
    const delivery = terms.deliveryDate ? terms.deliveryDate.slice(0, 10) : label('On completion');

    const intro = offPlan ? copy.offplanIntro : copy.saleIntro;
    const facts: ContractSpec['facts'] = [
      [label('Property'), terms.propertyTitle || '—'],
      [label('Address'), terms.address || '—'],
      [label('Price'), price],
      [label('Deed'), deed],
      [label('Agreement date'), new Date(contract.createdAt).toISOString().slice(0, 10)],
    ];
    if (offPlan) {
      facts.splice(4, 0, [label('Delivery'), delivery]);
    }

    return {
      title: offPlan ? copy.offplanTitle : copy.saleTitle,
      reference: copy.reference(contract.id),
      intro: fallbackNote ? `${fallbackNote}\n\n${intro}` : intro,
      facts,
      clauses: offPlan
        ? copy.offplanClauses({ price, deedType: deed, delivery })
        : copy.saleClauses({ price, deedType: deed }),
      parties,
      footer: copy.footer,
    };
  }

  /**
   * The mandate PDF (§13.4). Its clauses record the three things that make the
   * arrangement unusual and are therefore worth stating in writing: the owner
   * stays anonymous, the agent's commission sits on top of the owner's asking
   * price rather than inside it, and the appointment lapses on a fixed date.
   */
  private mandateSpec(
    contract: { id: string; createdAt: Date; terms: unknown },
    parties: ContractSpec['parties'],
  ): ContractSpec {
    const terms = contract.terms as {
      propertyTitle: string;
      address: string;
      ownerAskGbp: number | null;
      termMonths: number;
      expiresAt: string;
      locale?: ContractLocale;
      requestedLocale?: string;
    };
    const ask =
      terms.ownerAskGbp === null ? '—' : `GBP ${terms.ownerAskGbp.toLocaleString('en-GB')}`;
    const copy = contractCopy(contractLocale(terms.locale));
    const label = (k: string) => copy.labels[k] ?? k;
    // Says so on the page when the reader's language could not be rendered,
    // rather than handing them English with no explanation.
    const fallbackNote = terms.requestedLocale
      ? NOT_IN_YOUR_LANGUAGE[terms.requestedLocale]
      : undefined;

    return {
      title: copy.mandateTitle,
      reference: copy.reference(contract.id),
      intro: fallbackNote ? `${fallbackNote}

${copy.mandateIntro}` : copy.mandateIntro,
      facts: [
        [label('Property'), terms.propertyTitle || '—'],
        [label('Address'), terms.address || '—'],
        [label("Owner's asking price"), ask],
        [label('Term'), copy.months(terms.termMonths)],
        [label('Expires'), terms.expiresAt.slice(0, 10)],
        [label('Mandate date'), new Date(contract.createdAt).toISOString().slice(0, 10)],
      ],
      clauses: copy.mandateClauses({ termMonths: terms.termMonths, ask }),
      parties,
      footer: copy.footer,
    };
  }
}
