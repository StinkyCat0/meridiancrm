import { type CustomerType, type Industry, type JobStatus } from "@meridian/contracts";
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

function atHour(dayOffset: number, hour: number, minute = 0): Date {
  const date = new Date(now.getTime() + dayOffset * DAY_MS);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

interface CustomerSeed {
  name: string;
  customerType: CustomerType;
  industry: Industry;
  phone: string;
  email: string;
  notes: string;
  tags: string[];
  locations: Array<{
    label: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    accessNotes?: string;
    gateCode?: string;
    isPrimary?: boolean;
  }>;
  contacts: Array<{ firstName: string; lastName: string; email: string; phone: string; title: string }>;
}

const customerSeeds: CustomerSeed[] = [
  {
    name: "Harborview Property Group",
    customerType: "PROPERTY_MANAGER",
    industry: "Property Management",
    phone: "+1 512 555 0110",
    email: "ops@harborviewgroup.com",
    notes: "Six-building portfolio. Window and common-area contract renews each spring.",
    tags: ["portfolio", "recurring", "key-account"],
    locations: [
      {
        label: "Harborview Tower",
        line1: "401 Congress Ave",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        accessNotes: "Loading dock on 4th. Sign in with security, ask for building engineer.",
        gateCode: "4412",
        isPrimary: true,
      },
      {
        label: "Harborview East",
        line1: "1201 E 6th St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        accessNotes: "Roof access code changes monthly; call the site lead.",
      },
    ],
    contacts: [
      { firstName: "Dana", lastName: "Whitfield", email: "dana@harborviewgroup.com", phone: "+1 512 555 0111", title: "Property Manager" },
      { firstName: "Luis", lastName: "Ortega", email: "luis@harborviewgroup.com", phone: "+1 512 555 0112", title: "Facilities Lead" },
    ],
  },
  {
    name: "Dr. Ellis Chen",
    customerType: "RESIDENTIAL",
    industry: "Healthcare",
    phone: "+1 512 555 0120",
    email: "ellis.chen@fastmail.com",
    notes: "Prefers text before arrival. Two dogs in the back yard.",
    tags: ["residential", "referral"],
    locations: [
      {
        label: "Home",
        line1: "908 W 22nd St",
        city: "Austin",
        state: "TX",
        postalCode: "78705",
        accessNotes: "Back gate is unlocked; do not let the dogs out.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Ellis", lastName: "Chen", email: "ellis.chen@fastmail.com", phone: "+1 512 555 0121", title: "Homeowner" },
    ],
  },
  {
    name: "Northgate Dental",
    customerType: "COMMERCIAL",
    industry: "Healthcare",
    phone: "+1 512 555 0130",
    email: "office@northgatedental.com",
    notes: "Clean after 6pm only. Invoice to the practice manager.",
    tags: ["commercial", "after-hours"],
    locations: [
      {
        label: "Northgate office",
        line1: "5600 Burnet Rd",
        city: "Austin",
        state: "TX",
        postalCode: "78756",
        accessNotes: "Key in lockbox. Alarm code provided by text each visit.",
        gateCode: "9081",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Priya", lastName: "Shah", email: "priya@northgatedental.com", phone: "+1 512 555 0131", title: "Practice Manager" },
    ],
  },
  {
    name: "Lumen Nail Bar",
    customerType: "COMMERCIAL",
    industry: "Salon & Spa",
    phone: "+1 512 555 0140",
    email: "hello@lumennailbar.com",
    notes: "Six stations, two pedicure rooms. Deep clean every other Monday.",
    tags: ["salon", "recurring"],
    locations: [
      {
        label: "Lumen South",
        line1: "1500 S Lamar Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        accessNotes: "Mop closet is behind the break room. Use the eco line only.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Mina", lastName: "Tran", email: "mina@lumennailbar.com", phone: "+1 512 555 0141", title: "Owner" },
    ],
  },
  {
    name: "Cedar & Co. Salon",
    customerType: "COMMERCIAL",
    industry: "Salon & Spa",
    phone: "+1 512 555 0150",
    email: "frontdesk@cedarandco.com",
    notes: "Tuesdays are closed; schedule early morning.",
    tags: ["salon", "weekly"],
    locations: [
      {
        label: "Cedar & Co.",
        line1: "2110 E Cesar Chavez St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        accessNotes: "Street parking only after 8am.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Rowan", lastName: "Bell", email: "rowan@cedarandco.com", phone: "+1 512 555 0151", title: "Studio Manager" },
    ],
  },
  {
    name: "Parkside HOA",
    customerType: "PROPERTY_MANAGER",
    industry: "Property Management",
    phone: "+1 512 555 0160",
    email: "board@parksidehoa.org",
    notes: "Quarterly pressure washing for 42 units. Board approves expenses over $500.",
    tags: ["hoa", "quarterly"],
    locations: [
      {
        label: "Parkside community",
        line1: "7400 Shoal Creek Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78757",
        accessNotes: "Use visitor lot by the clubhouse. Water spigot at the north fence.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Greta", lastName: "Lund", email: "greta@parksidehoa.org", phone: "+1 512 555 0161", title: "Board Treasurer" },
    ],
  },
  {
    name: "Marisol Vega",
    customerType: "RESIDENTIAL",
    industry: "Home Services",
    phone: "+1 512 555 0170",
    email: "marisol.vega@gmail.com",
    notes: "Gutters twice a year. Pays by card on completion.",
    tags: ["residential", "repeat"],
    locations: [
      {
        label: "Home",
        line1: "3305 Cherry Ln",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        accessNotes: "Side gate sticks; lift and pull.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Marisol", lastName: "Vega", email: "marisol.vega@gmail.com", phone: "+1 512 555 0171", title: "Homeowner" },
    ],
  },
  {
    name: "Ridgeline Utilities",
    customerType: "COMMERCIAL",
    industry: "Utilities",
    phone: "+1 512 555 0180",
    email: "facilities@ridgelineutilities.com",
    notes: "Requires certificate of insurance on file. Two substations.",
    tags: ["utilities", "compliance"],
    locations: [
      {
        label: "Substation A",
        line1: "9800 Research Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78759",
        accessNotes: "Escort required. Badge pickup at the north gate.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Wes", lastName: "Hollis", email: "wes@ridgelineutilities.com", phone: "+1 512 555 0181", title: "Facilities Supervisor" },
    ],
  },
  {
    name: "The Glass House",
    customerType: "COMMERCIAL",
    industry: "Hospitality",
    phone: "+1 512 555 0190",
    email: "events@glasshouseatx.com",
    notes: "Event venue. Post-event turnover clean, often same night.",
    tags: ["events", "priority"],
    locations: [
      {
        label: "Glass House venue",
        line1: "1100 E 5th St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        accessNotes: "Load-in through the alley. Event manager signs off on completion.",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Simone", lastName: "Park", email: "simone@glasshouseatx.com", phone: "+1 512 555 0191", title: "Event Director" },
    ],
  },
  {
    name: "Summit HVAC Partners",
    customerType: "COMMERCIAL",
    industry: "HVAC",
    phone: "+1 512 555 0200",
    email: "dispatch@summithvac.com",
    notes: "Subcontract overflow installs. Net 30.",
    tags: ["subcontractor", "net-30"],
    locations: [
      {
        label: "Summit yard",
        line1: "6401 Burnet Rd",
        city: "Austin",
        state: "TX",
        postalCode: "78757",
        isPrimary: true,
      },
    ],
    contacts: [
      { firstName: "Tobias", lastName: "Reed", email: "tobias@summithvac.com", phone: "+1 512 555 0201", title: "Dispatch" },
    ],
  },
];

interface ServiceSeed {
  name: string;
  category: string;
  description: string;
  unit: "VISIT" | "HOUR" | "SQFT" | "ROOM" | "UNIT" | "ITEM";
  durationMinutes: number;
  price: number;
  taxable: boolean;
}

const serviceSeeds: ServiceSeed[] = [
  { name: "Window cleaning — exterior", category: "Windows", description: "Exterior glass, frames and sills up to two storeys.", unit: "VISIT", durationMinutes: 120, price: 18_000, taxable: true },
  { name: "Window cleaning — interior", category: "Windows", description: "Interior glass, tracks and screens.", unit: "VISIT", durationMinutes: 90, price: 12_000, taxable: true },
  { name: "Gutter clearing", category: "Exterior", description: "Clear gutters and downspouts, bag and remove debris.", unit: "VISIT", durationMinutes: 120, price: 24_000, taxable: true },
  { name: "Pressure washing", category: "Exterior", description: "Driveways, walkways and siding with surface cleaner.", unit: "SQFT", durationMinutes: 180, price: 45, taxable: true },
  { name: "HVAC tune-up", category: "HVAC", description: "Seasonal inspection, filter change and coil check.", unit: "UNIT", durationMinutes: 90, price: 14_900, taxable: true },
  { name: "AC diagnostic", category: "HVAC", description: "Full diagnostic with refrigerant pressure test.", unit: "VISIT", durationMinutes: 60, price: 8_900, taxable: true },
  { name: "Duct cleaning", category: "HVAC", description: "Negative-pressure duct cleaning up to 12 vents.", unit: "VISIT", durationMinutes: 240, price: 42_000, taxable: true },
  { name: "Salon deep clean", category: "Salon", description: "Stations, floors, mirrors, wash basins and break room.", unit: "VISIT", durationMinutes: 150, price: 35_000, taxable: true },
  { name: "Nail station sanitising", category: "Salon", description: "Hospital-grade sanitising of stations, tools and pedicure chairs.", unit: "VISIT", durationMinutes: 75, price: 9_500, taxable: true },
  { name: "Office cleaning", category: "Commercial", description: "Trash, surfaces, floors and restrooms. Billed hourly per cleaner.", unit: "HOUR", durationMinutes: 120, price: 6_500, taxable: true },
  { name: "Post-event turnover", category: "Commercial", description: "Full venue reset after events, including restrooms.", unit: "VISIT", durationMinutes: 180, price: 28_000, taxable: true },
  { name: "Handyman hour", category: "General", description: "Small repairs and punch-list work. Parts billed separately.", unit: "HOUR", durationMinutes: 60, price: 9_500, taxable: true },
];

interface JobSeed {
  title: string;
  customer: number;
  location: number;
  contact: number;
  status: JobStatus;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  start: Date | null;
  assignee: "demo" | "member" | null;
  source: string;
  lines: Array<{ service: number; quantity: number }>;
  notes?: string;
  recurrence?: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";
}

const jobSeeds: JobSeed[] = [
  { title: "Harborview Tower windows", customer: 0, location: 0, contact: 0, status: "COMPLETED", priority: "NORMAL", start: atHour(0, 8), assignee: "demo", source: "Recurring contract", lines: [{ service: 0, quantity: 1 }, { service: 1, quantity: 1 }], recurrence: "MONTHLY", notes: "Tower lobby and east stairwell. Security signed off at 9:40." },
  { title: "Chen seasonal HVAC tune-up", customer: 1, location: 0, contact: 0, status: "SCHEDULED", priority: "NORMAL", start: atHour(0, 10, 30), assignee: "member", source: "Phone", lines: [{ service: 4, quantity: 1 }, { service: 5, quantity: 1 }], notes: "Text before arrival. Two dogs." },
  { title: "Lumen Nail Bar deep clean", customer: 3, location: 0, contact: 0, status: "IN_PROGRESS", priority: "HIGH", start: atHour(0, 13), assignee: "demo", source: "Recurring contract", lines: [{ service: 7, quantity: 1 }, { service: 8, quantity: 1 }], recurrence: "BIWEEKLY" },
  { title: "Northgate after-hours clean", customer: 2, location: 0, contact: 0, status: "SCHEDULED", priority: "NORMAL", start: atHour(0, 18), assignee: "member", source: "Referral", lines: [{ service: 9, quantity: 2 }], recurrence: "WEEKLY", notes: "Alarm code is texted the morning of the visit." },
  { title: "Cedar & Co. station reset", customer: 4, location: 0, contact: 0, status: "DISPATCHED", priority: "NORMAL", start: atHour(0, 17), assignee: "demo", source: "Recurring contract", lines: [{ service: 8, quantity: 1 }], recurrence: "WEEKLY" },
  { title: "Parkside clubhouse pressure wash", customer: 5, location: 0, contact: 0, status: "SCHEDULED", priority: "NORMAL", start: atHour(1, 9), assignee: "member", source: "Board approval", lines: [{ service: 3, quantity: 900 }], recurrence: "QUARTERLY", notes: "Board wants before/after photos." },
  { title: "Vega gutter clearing", customer: 6, location: 0, contact: 0, status: "COMPLETED", priority: "NORMAL", start: atHour(-1, 9), assignee: "demo", source: "Repeat customer", lines: [{ service: 2, quantity: 1 }], recurrence: "SEMIANNUAL" },
  { title: "Ridgeline substation wash", customer: 7, location: 0, contact: 0, status: "UNSCHEDULED", priority: "HIGH", start: null, assignee: null, source: "Phone", lines: [{ service: 3, quantity: 2200 }], notes: "Waiting on escort clearance and COI." },
  { title: "Glass House post-event reset", customer: 8, location: 0, contact: 0, status: "UNSCHEDULED", priority: "URGENT", start: null, assignee: null, source: "Event pipeline", lines: [{ service: 10, quantity: 1 }, { service: 11, quantity: 2 }], notes: "Confirm event end time; same-night turnover." },
  { title: "Summit overflow install support", customer: 9, location: 0, contact: 0, status: "COMPLETED", priority: "NORMAL", start: atHour(-3, 7, 30), assignee: "member", source: "Subcontract", lines: [{ service: 11, quantity: 6 }], notes: "Net 30." },
  { title: "Harborview East common areas", customer: 0, location: 1, contact: 1, status: "SCHEDULED", priority: "NORMAL", start: atHour(3, 8), assignee: "demo", source: "Recurring contract", lines: [{ service: 0, quantity: 1 }, { service: 1, quantity: 1 }], recurrence: "MONTHLY" },
  { title: "Lumen quarterly window detail", customer: 3, location: 0, contact: 0, status: "SCHEDULED", priority: "LOW", start: atHour(6, 9), assignee: "member", source: "Upsell", lines: [{ service: 1, quantity: 1 }], recurrence: "QUARTERLY" },
];

const TAX_BPS = 825;

function lineTotal(serviceIndex: number, quantity: number): number {
  return Math.round(serviceSeeds[serviceIndex]!.price * quantity);
}

function jobTotals(lines: JobSeed["lines"]) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line.service, line.quantity), 0);
  const tax = Math.round((subtotal * TAX_BPS) / 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

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
    data: { name: "Meridian Home Services", slug: WORKSPACE_SLUG, currency: "USD", createdAt: daysAgo(180) },
  });

  await prisma.membership.createMany({
    data: [
      { userId: demo.id, workspaceId: workspace.id, role: "OWNER", createdAt: daysAgo(180) },
      { userId: member.id, workspaceId: workspace.id, role: "MEMBER", createdAt: daysAgo(90) },
    ],
  });

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Service sales",
      isDefault: true,
      stages: {
        create: [
          { name: "New lead", order: 0, probability: 10, kind: "OPEN", targetDays: 7 },
          { name: "Site visit", order: 1, probability: 30, kind: "OPEN", targetDays: 10 },
          { name: "Quote sent", order: 2, probability: 55, kind: "OPEN", targetDays: 7 },
          { name: "Won", order: 3, probability: 100, kind: "WON", targetDays: 30 },
          { name: "Lost", order: 4, probability: 0, kind: "LOST", targetDays: 30 },
        ],
      },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });

  const customerIds: string[] = [];
  const locationIds: string[][] = [];
  const contactIds: string[][] = [];

  for (const seed of customerSeeds) {
    const customer = await prisma.company.create({
      data: {
        workspaceId: workspace.id,
        name: seed.name,
        customerType: seed.customerType,
        industry: seed.industry,
        phone: seed.phone,
        email: seed.email,
        address: `${seed.locations[0]!.line1}, ${seed.locations[0]!.city}, ${seed.locations[0]!.state}`,
        notes: seed.notes,
        tags: JSON.stringify(seed.tags),
        ownerId: demo.id,
        createdAt: daysAgo(150),
        updatedAt: daysAgo(1),
      },
    });
    customerIds.push(customer.id);

    const locs: string[] = [];
    for (const location of seed.locations) {
      const created = await prisma.location.create({
        data: {
          workspaceId: workspace.id,
          customerId: customer.id,
          label: location.label,
          line1: location.line1,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
          country: "US",
          accessNotes: location.accessNotes ?? null,
          gateCode: location.gateCode ?? null,
          isPrimary: location.isPrimary ?? false,
          createdAt: daysAgo(150),
        },
      });
      locs.push(created.id);
    }
    locationIds.push(locs);

    const contacts: string[] = [];
    for (const contact of seed.contacts) {
      const created = await prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          title: contact.title,
          companyId: customer.id,
          ownerId: demo.id,
          tags: JSON.stringify(["customer"]),
          createdAt: daysAgo(140),
        },
      });
      contacts.push(created.id);
    }
    contactIds.push(contacts);
  }

  const serviceIds: string[] = [];
  for (const service of serviceSeeds) {
    const created = await prisma.serviceItem.create({
      data: { workspaceId: workspace.id, ...service },
    });
    serviceIds.push(created.id);
  }

  let jobCounter = 1000;
  const jobRefs: Array<{ id: string; number: string; title: string; customerId: string; contactId: string; status: string }> = [];

  for (const seed of jobSeeds) {
    jobCounter += 1;
    const number = `JOB-${jobCounter}`;
    const totals = jobTotals(seed.lines);
    const duration = seed.lines.reduce(
      (sum, line) => sum + serviceSeeds[line.service]!.durationMinutes,
      0,
    );
    const start = seed.start;
    const end = start ? new Date(start.getTime() + Math.max(30, duration) * 60_000) : null;

    const job = await prisma.job.create({
      data: {
        workspaceId: workspace.id,
        number,
        title: seed.title,
        status: seed.status,
        priority: seed.priority,
        source: seed.source,
        customerId: customerIds[seed.customer]!,
        locationId: locationIds[seed.customer]![seed.location]!,
        contactId: contactIds[seed.customer]![seed.contact]!,
        assigneeId:
          seed.assignee === "demo" ? demo.id : seed.assignee === "member" ? member.id : null,
        scheduledStart: start,
        scheduledEnd: end,
        arrivedAt:
          seed.status === "IN_PROGRESS" || seed.status === "COMPLETED"
            ? start ?? daysAgo(1)
            : null,
        completedAt: seed.status === "COMPLETED" ? (end ?? daysAgo(1)) : null,
        durationMinutes: Math.max(30, duration),
        taxRate: TAX_BPS,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        deposit: 0,
        notes: seed.notes ?? null,
        recurrence: seed.recurrence ?? null,
        createdAt: start ? new Date(start.getTime() - 5 * DAY_MS) : daysAgo(2),
        lineItems: {
          create: seed.lines.map((line, index) => ({
            serviceId: serviceIds[line.service]!,
            name: serviceSeeds[line.service]!.name,
            quantity: line.quantity,
            unitPrice: serviceSeeds[line.service]!.price,
            total: lineTotal(line.service, line.quantity),
            position: index,
          })),
        },
      },
    });
    jobRefs.push({
      id: job.id,
      number: job.number,
      title: job.title,
      customerId: job.customerId,
      contactId: job.contactId ?? "",
      status: job.status,
    });
  }

  // Estimates -------------------------------------------------------------

  const estimateSeeds = [
    {
      title: "Harborview annual window contract",
      customer: 0,
      location: 0,
      contact: 0,
      status: "SENT",
      expiresInDays: 14,
      taxRate: TAX_BPS,
      notes: "Covers six buildings, monthly cadence, priority scheduling.",
      lines: [
        { service: 0, quantity: 6 },
        { service: 1, quantity: 6 },
      ],
    },
    {
      title: "Lumen quarterly window detail",
      customer: 3,
      location: 0,
      contact: 0,
      status: "DRAFT",
      expiresInDays: 30,
      taxRate: TAX_BPS,
      notes: "Interior detail across twelve panes.",
      lines: [{ service: 1, quantity: 1 }],
    },
    {
      title: "Chen duct cleaning + tune-up",
      customer: 1,
      location: 0,
      contact: 0,
      status: "APPROVED",
      expiresInDays: 21,
      taxRate: TAX_BPS,
      notes: "Approved by text; schedule with the customer.",
      lines: [
        { service: 6, quantity: 1 },
        { service: 4, quantity: 1 },
      ],
    },
    {
      title: "Cedar & Co. full refresh",
      customer: 4,
      location: 0,
      contact: 0,
      status: "DECLINED",
      expiresInDays: -10,
      taxRate: TAX_BPS,
      notes: "Declined — budget moved to Q3.",
      lines: [{ service: 7, quantity: 1 }],
    },
  ] as const;

  let estimateCounter = 1000;
  for (const seed of estimateSeeds) {
    estimateCounter += 1;
    const lines = seed.lines.map((line, index) => ({
      serviceId: serviceIds[line.service]!,
      name: serviceSeeds[line.service]!.name,
      quantity: line.quantity,
      unitPrice: serviceSeeds[line.service]!.price,
      total: lineTotal(line.service, line.quantity),
      position: index,
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
    const tax = Math.round((subtotal * seed.taxRate) / 10_000);

    await prisma.estimate.create({
      data: {
        workspaceId: workspace.id,
        number: `EST-${estimateCounter}`,
        title: seed.title,
        status: seed.status,
        customerId: customerIds[seed.customer]!,
        locationId: locationIds[seed.customer]![seed.location]!,
        contactId: contactIds[seed.customer]![seed.contact]!,
        ownerId: demo.id,
        issuedAt: seed.status === "DRAFT" ? null : daysAgo(4),
        expiresAt: daysFromNow(seed.expiresInDays),
        taxRate: seed.taxRate,
        subtotal,
        tax,
        total: subtotal + tax,
        notes: seed.notes,
        createdAt: daysAgo(6),
        lineItems: { create: lines },
      },
    });
  }

  // Invoices --------------------------------------------------------------

  const completedToday = jobRefs.find((job) => job.status === "COMPLETED" && job.number === "JOB-1001")!;
  const completedYesterday = jobRefs.find((job) => job.number === "JOB-1007")!;
  const completedInstall = jobRefs.find((job) => job.number === "JOB-1010")!;

  const invoiceSeeds = [
    { title: "Harborview Tower windows — May", job: completedToday, status: "SENT", amount: 33_750, paid: 0, issued: 0, due: 14 },
    { title: "Vega gutter clearing", job: completedYesterday, status: "PAID", amount: 25_980, paid: 25_980, issued: -1, due: 13 },
    { title: "Summit overflow install", job: completedInstall, status: "PARTIAL", amount: 61_830, paid: 30_000, issued: -3, due: 27 },
    { title: "Parkside quarterly pressure wash", job: null, status: "SENT", amount: 43_060, paid: 0, issued: -10, due: -5 },
    { title: "Northgate weekly clean", job: null, status: "DRAFT", amount: 14_040, paid: 0, issued: 0, due: 30 },
  ];

  let invoiceCounter = 1000;
  for (const seed of invoiceSeeds) {
    invoiceCounter += 1;
    await prisma.invoice.create({
      data: {
        workspaceId: workspace.id,
        number: `INV-${invoiceCounter}`,
        title: seed.title,
        status: seed.status,
        customerId: seed.job ? seed.job.customerId : customerIds[seed.title.startsWith("Parkside") ? 5 : 2]!,
        locationId: seed.job ? undefined : locationIds[seed.title.startsWith("Parkside") ? 5 : 2]![0],
        jobId: seed.job?.id ?? null,
        amount: seed.amount,
        amountPaid: seed.paid,
        issuedAt: seed.issued === 0 ? daysAgo(0) : daysAgo(Math.abs(seed.issued)),
        dueAt: daysFromNow(seed.due),
        paidAt: seed.status === "PAID" ? daysAgo(1) : null,
        notes: null,
        createdAt: daysAgo(Math.abs(seed.issued) + 1),
      },
    });
  }

  // Pipeline deals --------------------------------------------------------

  const dealSeeds = [
    { title: "Annual window contract — Harborview", customer: 0, contact: 0, stage: 2, value: 480_000, inDays: 14, created: 12, description: "Six buildings, monthly service. Awaiting board signature." },
    { title: "HVAC maintenance agreement — Northgate", customer: 2, contact: 0, stage: 1, value: 216_000, inDays: 21, created: 9, description: "Quarterly tune-ups across two rooftop units." },
    { title: "Salon group cleaning — Lumen + Cedar", customer: 3, contact: 0, stage: 0, value: 168_000, inDays: 30, created: 4, description: "Multi-site recurring clean bundled across both salons." },
    { title: "Utility substation program", customer: 7, contact: 0, stage: 1, value: 900_000, inDays: 45, created: 20, description: "Quarterly wash program with compliance documentation." },
    { title: "HOA common-area contract", customer: 5, contact: 0, stage: 2, value: 132_000, inDays: 10, created: 15, description: "Year-round maintenance for 42 units." },
    { title: "Event venue retainer", customer: 8, contact: 0, stage: 3, value: 240_000, inDays: null, created: 60, description: "Scheduled turnover crew for the season." },
  ];

  for (const seed of dealSeeds) {
    const closed = seed.inDays === null;
    await prisma.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[seed.stage]!.id,
        title: seed.title,
        value: seed.value,
        currency: "USD",
        contactId: contactIds[seed.customer]![seed.contact]!,
        companyId: customerIds[seed.customer]!,
        ownerId: demo.id,
        expectedCloseDate: closed ? null : daysFromNow(seed.inDays),
        closedAt: closed ? daysAgo(3) : null,
        description: seed.description,
        tags: JSON.stringify(["service"]),
        stageChangedAt: closed ? daysAgo(3) : daysAgo(2),
        createdAt: daysAgo(seed.created),
        updatedAt: daysAgo(2),
      },
    });
  }

  // Customer timeline -----------------------------------------------------

  const activitySeeds = [
    { customer: 0, contact: 0, title: "Walkthrough with Dana at Harborview Tower", body: "Confirmed loading dock access and monthly cadence." },
    { customer: 1, contact: 0, title: "Texted arrival window for HVAC tune-up", body: "Customer confirmed 10:30 and asked us to avoid the back yard." },
    { customer: 3, contact: 0, title: "Mina approved biweekly deep clean", body: "Keep the eco line in the mop closet stocked." },
    { customer: 5, contact: 0, title: "Board requested before/after photos", body: "Send to Greta after the pressure wash." },
    { customer: 2, contact: 0, title: "Alarm code updated", body: "New code texted the morning of each visit." },
    { customer: 8, contact: 0, title: "Event calendar shared", body: "Six events in the next month; confirm same-night turnover." },
  ];

  for (let index = 0; index < activitySeeds.length; index += 1) {
    const seed = activitySeeds[index]!;
    const createdAt = daysAgo(index + 1);
    await prisma.activity.create({
      data: {
        workspaceId: workspace.id,
        type: "NOTE",
        title: seed.title,
        body: seed.body,
        completedAt: createdAt,
        companyId: customerIds[seed.customer]!,
        contactId: contactIds[seed.customer]![seed.contact]!,
        ownerId: demo.id,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  const taskSeeds = [
    { customer: 7, contact: 0, title: "Collect certificate of insurance — Ridgeline", dueAt: daysAgo(1) },
    { customer: 8, contact: 0, title: "Confirm event end time for turnover crew", dueAt: daysFromNow(1) },
    { customer: 0, contact: 0, title: "Send revised window contract to board", dueAt: daysFromNow(3) },
    { customer: 5, contact: 0, title: "Order pressure-wash fuel for Parkside", dueAt: daysFromNow(5) },
  ];

  for (const seed of taskSeeds) {
    await prisma.activity.create({
      data: {
        workspaceId: workspace.id,
        type: "TASK",
        title: seed.title,
        dueAt: seed.dueAt,
        companyId: customerIds[seed.customer]!,
        contactId: contactIds[seed.customer]![seed.contact]!,
        ownerId: member.id,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
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
        createdAt: daysAgo(180),
      },
      {
        workspaceId: workspace.id,
        actorId: demo.id,
        action: "job.completed",
        entityType: "job",
        entityId: completedToday.id,
        metadata: JSON.stringify({ number: completedToday.number }),
        createdAt: daysAgo(0),
      },
      {
        workspaceId: workspace.id,
        actorId: demo.id,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: null,
        metadata: JSON.stringify({ number: "INV-1002", amountPaid: 25_980 }),
        createdAt: daysAgo(1),
      },
    ],
  });

  const jobCount = await prisma.job.count({ where: { workspaceId: workspace.id } });
  console.log(
    `Seeded ${workspace.name}: ${customerIds.length} customers, ${serviceIds.length} services, ` +
      `${jobCount} jobs, ${estimateSeeds.length} estimates, ${invoiceSeeds.length} invoices, ${dealSeeds.length} deals.`,
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
