import {
  ACTIVITY_TYPES,
  type ActivityType,
  type Industry,
} from "@meridian/contracts";
import { hashPassword } from "../src/lib/auth.js";
import { prisma } from "../src/lib/db.js";

const WORKSPACE_SLUG = "meridian-studio";
const DEMO_EMAIL = "demo@meridian.studio";
const MEMBER_EMAIL = "member@meridian.studio";
const DEMO_PASSWORD = "Meridian2026!";

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY_MS);

/** Closed dates are pinned to UTC month boundaries to match dashboard grouping. */
function closedDate(spec: CloseDate): Date {
  if (spec.kind === "thisMonth") {
    const day = Math.max(1, now.getUTCDate() - spec.daysBack);
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  }
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + spec.offset, 1));
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(spec.day, daysInMonth)),
  );
}

interface CompanySeed {
  name: string;
  domain: string;
  industry: Industry;
  size: string;
  phone: string;
  website: string;
  address: string;
  notes: string;
  tags: string[];
}

const companySeeds: CompanySeed[] = [
  {
    name: "Northwind Atelier",
    domain: "northwindatelier.com",
    industry: "Agency",
    size: "11-50",
    phone: "+1 415 555 0113",
    website: "https://northwindatelier.com",
    address: "48 Clement St, San Francisco, CA",
    notes: "Boutique brand studio; annual retainer renews at the end of the quarter.",
    tags: ["design", "retainer"],
  },
  {
    name: "Cobalt & Co",
    domain: "cobaltandco.com",
    industry: "E-commerce",
    size: "51-200",
    phone: "+1 212 555 0188",
    website: "https://cobaltandco.com",
    address: "310 Bowery, New York, NY",
    notes: "Direct-to-consumer apparel label preparing a Shopify migration.",
    tags: ["dtc", "shopify"],
  },
  {
    name: "Fable House",
    domain: "fablehouse.studio",
    industry: "Media",
    size: "11-50",
    phone: "+44 20 7946 0321",
    website: "https://fablehouse.studio",
    address: "12 Hoxton Sq, London",
    notes: "Film and content studio; commissions work in quarterly campaigns.",
    tags: ["film", "content"],
  },
  {
    name: "Atlas Provisions",
    domain: "atlasprovisions.com",
    industry: "Hospitality",
    size: "201-500",
    phone: "+1 503 555 0164",
    website: "https://atlasprovisions.com",
    address: "88 SE Division St, Portland, OR",
    notes: "Restaurant group rolling out a new menu system across twelve sites.",
    tags: ["hospitality", "menu"],
  },
  {
    name: "Studio Noor",
    domain: "studionoor.design",
    industry: "Agency",
    size: "2-10",
    phone: "+31 20 555 0132",
    website: "https://studionoor.design",
    address: "Prinsengracht 412, Amsterdam",
    notes: "Identity studio that subcontracts overflow brand work to us.",
    tags: ["branding", "identity"],
  },
  {
    name: "Lark & Ledger",
    domain: "larkandledger.com",
    industry: "Financial Services",
    size: "51-200",
    phone: "+1 617 555 0140",
    website: "https://larkandledger.com",
    address: "75 State St, Boston, MA",
    notes: "Finance platform evaluating a reporting and analytics engagement.",
    tags: ["fintech", "reporting"],
  },
  {
    name: "Vantage Labs",
    domain: "vantagelabs.io",
    industry: "SaaS",
    size: "51-200",
    phone: "+1 206 555 0127",
    website: "https://vantagelabs.io",
    address: "1201 Western Ave, Seattle, WA",
    notes: "SaaS analytics vendor building out a revenue operations function.",
    tags: ["saas", "revops"],
  },
  {
    name: "Halcyon Goods",
    domain: "halcyongoods.com",
    industry: "E-commerce",
    size: "11-50",
    phone: "+1 312 555 0192",
    website: "https://halcyongoods.com",
    address: "401 N Morgan St, Chicago, IL",
    notes: "Homeware brand planning new packaging for the seasonal catalogue.",
    tags: ["packaging", "retail"],
  },
];

interface ContactSeed {
  company: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  tags: string[];
}

const contactSeeds: ContactSeed[] = [
  { company: 0, firstName: "Elena", lastName: "Marsh", email: "elena@northwindatelier.com", phone: "+1 415 555 0114", title: "Founder", tags: ["champion"] },
  { company: 0, firstName: "Theo", lastName: "Brandt", email: "theo@northwindatelier.com", phone: "+1 415 555 0115", title: "Creative Director", tags: ["design"] },
  { company: 1, firstName: "Priya", lastName: "Raman", email: "priya@cobaltandco.com", phone: "+1 212 555 0189", title: "VP Growth", tags: ["decision-maker"] },
  { company: 1, firstName: "Marcus", lastName: "Webb", email: "marcus@cobaltandco.com", phone: "+1 212 555 0190", title: "Head of Operations", tags: ["operations"] },
  { company: 2, firstName: "Sofia", lastName: "Lindberg", email: "sofia@fablehouse.studio", phone: "+44 20 7946 0322", title: "Executive Producer", tags: ["champion"] },
  { company: 2, firstName: "Daniel", lastName: "Okoye", email: "daniel@fablehouse.studio", phone: "+44 20 7946 0323", title: "Marketing Lead", tags: ["marketing"] },
  { company: 3, firstName: "Hannah", lastName: "Pike", email: "hannah@atlasprovisions.com", phone: "+1 503 555 0165", title: "Owner", tags: ["decision-maker"] },
  { company: 3, firstName: "Victor", lastName: "Salas", email: "victor@atlasprovisions.com", phone: "+1 503 555 0166", title: "General Manager", tags: ["operations"] },
  { company: 4, firstName: "Noor", lastName: "Haddad", email: "noor@studionoor.design", phone: "+31 20 555 0133", title: "Principal", tags: ["partner"] },
  { company: 4, firstName: "Amara", lastName: "Sousa", email: "amara@studionoor.design", phone: "+31 20 555 0134", title: "Studio Manager", tags: ["design"] },
  { company: 5, firstName: "Julian", lastName: "Crane", email: "julian@larkandledger.com", phone: "+1 617 555 0141", title: "CFO", tags: ["budget"] },
  { company: 5, firstName: "Renee", lastName: "Alvarez", email: "renee@larkandledger.com", phone: "+1 617 555 0142", title: "Head of Partnerships", tags: ["champion"] },
  { company: 6, firstName: "Kaito", lastName: "Mori", email: "kaito@vantagelabs.io", phone: "+1 206 555 0128", title: "CEO", tags: ["decision-maker"] },
  { company: 6, firstName: "Lena", lastName: "Fischer", email: "lena@vantagelabs.io", phone: "+1 206 555 0129", title: "Product Lead", tags: ["product"] },
  { company: 7, firstName: "Owen", lastName: "Blake", email: "owen@halcyongoods.com", phone: "+1 312 555 0193", title: "Head of Brand", tags: ["brand"] },
  { company: 7, firstName: "Greta", lastName: "Vollmer", email: "greta@halcyongoods.com", phone: "+1 312 555 0194", title: "E-commerce Manager", tags: ["ecommerce"] },
  { company: 1, firstName: "Sam", lastName: "Rivera", email: "sam@cobaltandco.com", phone: "+1 212 555 0191", title: "Merchandising Lead", tags: ["merch"] },
  { company: 6, firstName: "Iris", lastName: "Chen", email: "iris@vantagelabs.io", phone: "+1 206 555 0130", title: "RevOps Manager", tags: ["revops"] },
];

type CloseDate =
  | { kind: "thisMonth"; daysBack: number }
  | { kind: "month"; offset: number; day: number };

interface DealSeed {
  title: string;
  company: number;
  contact: number;
  stage: number;
  value: number;
  expectedInDays: number | null;
  closed: CloseDate | null;
  createdDaysAgo: number;
  stageChangedDaysAgo?: number;
  description: string;
  tags: string[];
}

const dealSeeds: DealSeed[] = [
  { title: "Brand system refresh", company: 0, contact: 0, stage: 0, value: 2_400_000, expectedInDays: 30, closed: null, createdDaysAgo: 40, stageChangedDaysAgo: 12, description: "Full visual identity refresh ahead of the spring launch.", tags: ["branding"] },
  { title: "E-commerce replatform", company: 1, contact: 2, stage: 0, value: 8_500_000, expectedInDays: 45, closed: null, createdDaysAgo: 35, stageChangedDaysAgo: 9, description: "Shopify migration plus a new checkout experience.", tags: ["ecommerce", "shopify"] },
  { title: "Campaign film series", company: 2, contact: 4, stage: 1, value: 5_200_000, expectedInDays: 21, closed: null, createdDaysAgo: 52, stageChangedDaysAgo: 18, description: "Three short films for the autumn brand campaign.", tags: ["video"] },
  { title: "Menu system rollout", company: 3, contact: 6, stage: 1, value: 1_850_000, expectedInDays: 18, closed: null, createdDaysAgo: 47, stageChangedDaysAgo: 15, description: "Menu design system across twelve restaurant sites.", tags: ["hospitality"] },
  { title: "Identity sprint", company: 4, contact: 8, stage: 2, value: 3_600_000, expectedInDays: 14, closed: null, createdDaysAgo: 60, stageChangedDaysAgo: 8, description: "Two-week identity sprint for a boutique hotel group.", tags: ["identity"] },
  { title: "Reporting dashboard", company: 5, contact: 10, stage: 2, value: 7_400_000, expectedInDays: 28, closed: null, createdDaysAgo: 55, stageChangedDaysAgo: 6, description: "Client reporting dashboard with exportable board packs.", tags: ["reporting"] },
  { title: "RevOps retainer", company: 6, contact: 12, stage: 3, value: 9_600_000, expectedInDays: 10, closed: null, createdDaysAgo: 72, stageChangedDaysAgo: 5, description: "Ongoing revenue operations support for the go-to-market team.", tags: ["retainer", "revops"] },
  { title: "Packaging refresh", company: 7, contact: 14, stage: 3, value: 4_800_000, expectedInDays: 7, closed: null, createdDaysAgo: 66, stageChangedDaysAgo: 3, description: "New packaging system for the seasonal homeware range.", tags: ["packaging"] },
  { title: "Website rebuild", company: 0, contact: 1, stage: 4, value: 6_000_000, expectedInDays: null, closed: { kind: "thisMonth", daysBack: 2 }, createdDaysAgo: 95, description: "Marketing site rebuild on a new design system.", tags: ["web"] },
  { title: "Growth retainer", company: 1, contact: 2, stage: 4, value: 12_000_000, expectedInDays: null, closed: { kind: "thisMonth", daysBack: 6 }, createdDaysAgo: 140, description: "Twelve-month growth retainer covering paid and lifecycle.", tags: ["retainer"] },
  { title: "Launch campaign", company: 2, contact: 5, stage: 4, value: 2_800_000, expectedInDays: null, closed: { kind: "month", offset: -1, day: 14 }, createdDaysAgo: 165, description: "Integrated launch campaign for a new documentary slate.", tags: ["campaign"] },
  { title: "Hospitality audit", company: 3, contact: 7, stage: 4, value: 1_200_000, expectedInDays: null, closed: { kind: "month", offset: -2, day: 9 }, createdDaysAgo: 190, description: "Brand and guest experience audit across the group.", tags: ["research"] },
  { title: "Brand film", company: 4, contact: 9, stage: 5, value: 3_200_000, expectedInDays: null, closed: { kind: "thisMonth", daysBack: 4 }, createdDaysAgo: 80, description: "Brand film for a design week installation.", tags: ["video"] },
  { title: "Platform redesign", company: 5, contact: 11, stage: 5, value: 5_500_000, expectedInDays: null, closed: { kind: "month", offset: -1, day: 20 }, createdDaysAgo: 120, description: "Redesign of the client-facing investment platform.", tags: ["product"] },
  { title: "Product microsite", company: 6, contact: 13, stage: 0, value: 2_100_000, expectedInDays: 60, closed: null, createdDaysAgo: 10, stageChangedDaysAgo: 10, description: "Launch microsite for the new analytics product line.", tags: ["web"] },
  { title: "Seasonal catalogue", company: 7, contact: 15, stage: 5, value: 1_600_000, expectedInDays: null, closed: { kind: "month", offset: -2, day: 22 }, createdDaysAgo: 175, description: "Print and digital catalogue for the holiday season.", tags: ["print"] },
];

const activityTitles: Record<ActivityType, (dealTitle: string, companyName: string) => string> = {
  NOTE: (dealTitle) => `Call notes: ${dealTitle}`,
  CALL: (_dealTitle, companyName) => `Discovery call with ${companyName}`,
  EMAIL: (_dealTitle, companyName) => `Follow-up email to ${companyName}`,
  MEETING: (_dealTitle, companyName) => `Working session with ${companyName}`,
  TASK: (dealTitle, _companyName) => `Send revised estimate — ${dealTitle}`,
};

const activityBodies: Record<ActivityType, string> = {
  NOTE: "Walked through priorities for the quarter and agreed the next steps.",
  CALL: "Discussed budget range, decision process and timelines.",
  EMAIL: "Shared the updated scope, timeline and commercial summary.",
  MEETING: "Reviewed work in progress and unblocked the approval chain.",
  TASK: "Owner assigned and due date agreed with the client.",
};

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await prisma.workspace.deleteMany({ where: { slug: WORKSPACE_SLUG } });

  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { name: "Avery Meridian", passwordHash },
    create: { email: DEMO_EMAIL, name: "Avery Meridian", passwordHash },
  });
  const member = await prisma.user.upsert({
    where: { email: MEMBER_EMAIL },
    update: { name: "Jordan Vale", passwordHash },
    create: { email: MEMBER_EMAIL, name: "Jordan Vale", passwordHash },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: "Meridian Studio",
      slug: WORKSPACE_SLUG,
      currency: "USD",
      createdAt: daysAgo(120),
    },
  });

  await prisma.membership.createMany({
    data: [
      { userId: demo.id, workspaceId: workspace.id, role: "OWNER", createdAt: daysAgo(120) },
      { userId: member.id, workspaceId: workspace.id, role: "MEMBER", createdAt: daysAgo(58) },
    ],
  });

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Growth",
      isDefault: true,
      stages: {
        create: [
          { name: "Discovery", order: 0, probability: 10, kind: "OPEN", targetDays: 14 },
          { name: "Qualified", order: 1, probability: 25, kind: "OPEN", targetDays: 21 },
          { name: "Proposal", order: 2, probability: 50, kind: "OPEN", targetDays: 14 },
          { name: "Negotiation", order: 3, probability: 75, kind: "OPEN", targetDays: 10 },
          { name: "Won", order: 4, probability: 100, kind: "WON", targetDays: 30 },
          { name: "Lost", order: 5, probability: 0, kind: "LOST", targetDays: 30 },
        ],
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const companyIds: string[] = [];
  for (const seed of companySeeds) {
    const company = await prisma.company.create({
      data: {
        workspaceId: workspace.id,
        name: seed.name,
        domain: seed.domain,
        industry: seed.industry,
        size: seed.size,
        phone: seed.phone,
        website: seed.website,
        address: seed.address,
        notes: seed.notes,
        tags: JSON.stringify(seed.tags),
        ownerId: demo.id,
        createdAt: daysAgo(110),
        updatedAt: daysAgo(5),
      },
    });
    companyIds.push(company.id);
  }

  const contactIds: string[] = [];
  for (const seed of contactSeeds) {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: workspace.id,
        firstName: seed.firstName,
        lastName: seed.lastName,
        email: seed.email,
        phone: seed.phone,
        title: seed.title,
        companyId: companyIds[seed.company]!,
        ownerId: demo.id,
        tags: JSON.stringify(seed.tags),
        createdAt: daysAgo(100),
        updatedAt: daysAgo(2),
      },
    });
    contactIds.push(contact.id);
  }

  interface DealRef {
    id: string;
    title: string;
    companyId: string;
    contactId: string;
    companyName: string;
    closedAt: Date | null;
  }
  const dealRefs: DealRef[] = [];

  for (const seed of dealSeeds) {
    const closedAt = seed.closed ? closedDate(seed.closed) : null;
    const deal = await prisma.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[seed.stage]!.id,
        title: seed.title,
        value: seed.value,
        currency: "USD",
        contactId: contactIds[seed.contact]!,
        companyId: companyIds[seed.company]!,
        ownerId: demo.id,
        expectedCloseDate: seed.expectedInDays === null ? null : daysFromNow(seed.expectedInDays),
        closedAt,
        description: seed.description,
        tags: JSON.stringify(seed.tags),
        stageChangedAt: closedAt ?? daysAgo(seed.stageChangedDaysAgo ?? 0),
        createdAt: daysAgo(seed.createdDaysAgo),
        updatedAt: closedAt ?? daysAgo(Math.min(seed.stageChangedDaysAgo ?? 4, 4)),
      },
      include: { company: true },
    });
    dealRefs.push({
      id: deal.id,
      title: deal.title,
      companyId: companyIds[seed.company]!,
      contactId: contactIds[seed.contact]!,
      companyName: deal.company?.name ?? "the client",
      closedAt,
    });
  }

  for (let i = 0; i < 45; i += 1) {
    const type: ActivityType = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length]!;
    const deal = dealRefs[i % dealRefs.length]!;
    const createdAt = daysAgo(i % 45);

    let dueAt: Date | null = null;
    let completedAt: Date | null = null;
    if (type === "TASK") {
      if (i % 4 === 0) {
        dueAt = daysAgo(2 + (i % 5));
        completedAt = daysAgo(1 + (i % 5));
      } else {
        dueAt = daysFromNow((i % 7) - 3);
      }
    } else if (i % 3 !== 0) {
      completedAt = createdAt;
    }

    await prisma.activity.create({
      data: {
        workspaceId: workspace.id,
        type,
        title: activityTitles[type](deal.title, deal.companyName),
        body: activityBodies[type],
        dueAt,
        completedAt,
        contactId: deal.contactId,
        companyId: deal.companyId,
        dealId: deal.id,
        ownerId: demo.id,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId: workspace.id,
        actorId: demo.id,
        action: "workspace.created",
        entityType: "workspace",
        entityId: workspace.id,
        metadata: JSON.stringify({ name: workspace.name, slug: workspace.slug }),
        createdAt: daysAgo(120),
      },
      {
        workspaceId: workspace.id,
        actorId: demo.id,
        action: "invite.created",
        entityType: "invite",
        entityId: null,
        metadata: JSON.stringify({ email: MEMBER_EMAIL, role: "MEMBER" }),
        createdAt: daysAgo(58),
      },
      {
        workspaceId: workspace.id,
        actorId: demo.id,
        action: "deal.stage_changed",
        entityType: "deal",
        entityId: dealRefs[8]!.id,
        metadata: JSON.stringify({ stage: "Won", previousStage: "Negotiation" }),
        createdAt: dealRefs[8]!.closedAt ?? daysAgo(12),
      },
    ],
  });

  console.log(
    `Seeded ${workspace.name}: ${companyIds.length} companies, ${contactIds.length} contacts, ` +
      `${dealRefs.length} deals, 45 activities, 3 audit entries.`,
  );
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
