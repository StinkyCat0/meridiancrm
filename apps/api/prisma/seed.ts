import {
  type AutomationAction,
  type AutomationTrigger,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationIntent,
  type CommunicationSentiment,
  type CommunicationStatus,
  type CustomerType,
  type EstimateStatus,
  type ExpenseCategory,
  type Industry,
  type InvoiceStatus,
  type JobPriority,
  type JobStatus,
  type PaymentMethod,
  type RecurrenceFrequency,
  type ServiceUnit,
} from "@meridian/contracts";
import { hashPassword } from "../src/lib/auth.js";
import { prisma } from "../src/lib/db.js";
import { priceLineItems, toLineItemCreate, totalsFor } from "../src/lib/service-ops.js";

const WORKSPACE_SLUG = "meridian-studio";
const DEMO_EMAIL = "demo@meridian.studio";
const MEMBER_EMAIL = "member@meridian.studio";
const DEMO_PASSWORD = "Meridian2026!";

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const TAX_BPS = 825;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY_MS);

const BUSINESS_TIME_ZONE = "America/Chicago";

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const businessClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function dateParts(date: Date): Record<string, number> {
  return Object.fromEntries(
    businessClockFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)] as const),
  );
}

/** Milliseconds the Chicago wall clock differs from UTC at a given instant. */
function chicagoOffsetMs(date: Date): number {
  const parts = dateParts(date);
  const asIfUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return asIfUtc - date.getTime();
}

/** Austin wall-clock time to the equivalent UTC instant, DST included. */
function chicagoWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = wallClock - chicagoOffsetMs(new Date(wallClock));
  instant = wallClock - chicagoOffsetMs(new Date(instant));
  return new Date(instant);
}

/**
 * Seed schedule times are authored as America/Chicago wall-clock business
 * hours; store the equivalent UTC instant so every browser sees the same
 * 8am-6pm Central slot regardless of its own timezone.
 */
function atHour(dayOffset: number, hour: number, minute = 0): Date {
  const base = new Date(now.getTime() + dayOffset * DAY_MS);
  const parts = businessDateFormatter
    .formatToParts(base)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)] as const);
  const values = Object.fromEntries(parts) as Record<string, number>;
  return chicagoWallClockToUtc(values.year!, values.month!, values.day!, hour, minute);
}

/** Communications and tasks should never carry a timestamp in the future. */
function inPast(dayOffset: number, hour: number, minute = 0): Date {
  const date = atHour(dayOffset, hour, minute);
  if (date.getTime() > now.getTime()) {
    return new Date(now.getTime() - (minute + 15) * 60_000);
  }
  return date;
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Seed data missing: ${label}`);
  return value;
}

type UserKey = "demo" | "jordan" | "maya" | "chris" | "sofia";

const userSeeds: Array<{ key: UserKey; email: string; name: string; role: string; joinedDaysAgo: number }> = [
  { key: "demo", email: DEMO_EMAIL, name: "Avery Meridian", role: "OWNER", joinedDaysAgo: 210 },
  { key: "jordan", email: MEMBER_EMAIL, name: "Jordan Reyes", role: "ADMIN", joinedDaysAgo: 180 },
  { key: "maya", email: "maya@meridian.studio", name: "Maya Patel", role: "MEMBER", joinedDaysAgo: 140 },
  { key: "chris", email: "chris@meridian.studio", name: "Chris Nguyen", role: "MEMBER", joinedDaysAgo: 120 },
  { key: "sofia", email: "sofia@meridian.studio", name: "Sofia Brooks", role: "MEMBER", joinedDaysAgo: 95 },
];

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

interface LocationSeed {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  accessNotes?: string;
  gateCode?: string;
  contactName?: string;
  contactPhone?: string;
  isPrimary: boolean;
}

interface ContactSeed {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
}

interface CustomerSeed {
  name: string;
  customerType: CustomerType;
  industry: Industry;
  phone: string;
  email: string;
  website?: string;
  notes: string;
  tags: string[];
  owner: UserKey;
  createdDaysAgo: number;
  locations: LocationSeed[];
  contacts: ContactSeed[];
}

const customerSeeds: CustomerSeed[] = [
  {
    name: "Harborview Property Group",
    customerType: "PROPERTY_MANAGER",
    industry: "Property Management",
    phone: "+1 512 555 0110",
    email: "ops@harborviewgroup.com",
    website: "harborviewgroup.com",
    notes: "Six-building portfolio. Window and common-area contract renews each spring.",
    tags: ["portfolio", "recurring", "key-account"],
    owner: "demo",
    createdDaysAgo: 205,
    locations: [
      {
        label: "Harborview Tower",
        line1: "401 Congress Ave",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        latitude: 30.2669,
        longitude: -97.7428,
        accessNotes: "Loading dock on 4th. Sign in with security, ask for the building engineer.",
        gateCode: "4412",
        contactName: "Dana Whitfield",
        contactPhone: "+1 512 555 0111",
        isPrimary: true,
      },
      {
        label: "Harborview East",
        line1: "1201 E 6th St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        latitude: 30.2657,
        longitude: -97.7273,
        accessNotes: "Roof access code changes monthly; call the site lead before arrival.",
        gateCode: "7781",
        isPrimary: false,
      },
    ],
    contacts: [
      {
        firstName: "Dana",
        lastName: "Whitfield",
        email: "dana@harborviewgroup.com",
        phone: "+1 512 555 0111",
        title: "Property Manager",
      },
      {
        firstName: "Luis",
        lastName: "Ortega",
        email: "luis@harborviewgroup.com",
        phone: "+1 512 555 0112",
        title: "Facilities Lead",
      },
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
    owner: "jordan",
    createdDaysAgo: 160,
    locations: [
      {
        label: "Home",
        line1: "908 W 22nd St",
        city: "Austin",
        state: "TX",
        postalCode: "78705",
        latitude: 30.2862,
        longitude: -97.7465,
        accessNotes: "Back gate is unlocked; do not let the dogs out.",
        gateCode: "1908",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Ellis",
        lastName: "Chen",
        email: "ellis.chen@fastmail.com",
        phone: "+1 512 555 0121",
        title: "Homeowner",
      },
    ],
  },
  {
    name: "Northgate Dental",
    customerType: "COMMERCIAL",
    industry: "Healthcare",
    phone: "+1 512 555 0130",
    email: "office@northgatedental.com",
    website: "northgatedental.com",
    notes: "Clean after close (5:30pm) only. Invoice to the practice manager.",
    tags: ["commercial", "after-hours"],
    owner: "demo",
    createdDaysAgo: 190,
    locations: [
      {
        label: "Northgate office",
        line1: "5600 Burnet Rd",
        city: "Austin",
        state: "TX",
        postalCode: "78756",
        latitude: 30.3311,
        longitude: -97.7397,
        accessNotes: "Key in lockbox. Alarm code is texted each visit.",
        gateCode: "9081",
        contactName: "Anika Rao",
        contactPhone: "+1 512 555 0131",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Anika",
        lastName: "Rao",
        email: "anika@northgatedental.com",
        phone: "+1 512 555 0131",
        title: "Practice Manager",
      },
    ],
  },
  {
    name: "Lumen Nail Bar",
    customerType: "COMMERCIAL",
    industry: "Salon & Spa",
    phone: "+1 512 555 0140",
    email: "hello@lumennailbar.com",
    website: "lumennailbar.com",
    notes: "Six stations, two pedicure rooms. Deep clean every other Monday.",
    tags: ["salon", "recurring"],
    owner: "jordan",
    createdDaysAgo: 150,
    locations: [
      {
        label: "Lumen South",
        line1: "1500 S Lamar Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        latitude: 30.2489,
        longitude: -97.7644,
        accessNotes: "Mop closet is behind the break room. Use the eco line only.",
        gateCode: "2214",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Mina",
        lastName: "Tran",
        email: "mina@lumennailbar.com",
        phone: "+1 512 555 0141",
        title: "Owner",
      },
    ],
  },
  {
    name: "Cedar & Co. Salon",
    customerType: "COMMERCIAL",
    industry: "Salon & Spa",
    phone: "+1 512 555 0150",
    email: "frontdesk@cedarandco.com",
    website: "cedarandco.com",
    notes: "Closed Tuesdays; schedule early morning.",
    tags: ["salon", "weekly"],
    owner: "sofia",
    createdDaysAgo: 130,
    locations: [
      {
        label: "Cedar & Co.",
        line1: "2110 E Cesar Chavez St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        latitude: 30.2547,
        longitude: -97.7198,
        accessNotes: "Street parking only after 8am. Keypad at the side door.",
        gateCode: "5150",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Rowan",
        lastName: "Bell",
        email: "rowan@cedarandco.com",
        phone: "+1 512 555 0151",
        title: "Studio Manager",
      },
    ],
  },
  {
    name: "Parkside HOA",
    customerType: "PROPERTY_MANAGER",
    industry: "Property Management",
    phone: "+1 512 555 0160",
    email: "board@parksidehoa.org",
    notes: "Quarterly pressure washing for 42 units. The board approves expenses over $500.",
    tags: ["hoa", "quarterly"],
    owner: "demo",
    createdDaysAgo: 175,
    locations: [
      {
        label: "Parkside community",
        line1: "7400 Shoal Creek Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78757",
        latitude: 30.3493,
        longitude: -97.7388,
        accessNotes: "Use visitor lot by the clubhouse. Water spigot at the north fence.",
        gateCode: "1102",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Greta",
        lastName: "Lund",
        email: "greta@parksidehoa.org",
        phone: "+1 512 555 0161",
        title: "Board Treasurer",
      },
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
    owner: "chris",
    createdDaysAgo: 145,
    locations: [
      {
        label: "Home",
        line1: "3305 Cherry Ln",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        latitude: 30.304,
        longitude: -97.7507,
        accessNotes: "Side gate sticks; lift and pull.",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Marisol",
        lastName: "Vega",
        email: "marisol.vega@gmail.com",
        phone: "+1 512 555 0171",
        title: "Homeowner",
      },
    ],
  },
  {
    name: "Ridgeline Utilities",
    customerType: "COMMERCIAL",
    industry: "Utilities",
    phone: "+1 512 555 0180",
    email: "facilities@ridgelineutilities.com",
    website: "ridgelineutilities.com",
    notes: "Requires a certificate of insurance on file. Two substations.",
    tags: ["utilities", "compliance"],
    owner: "demo",
    createdDaysAgo: 200,
    locations: [
      {
        label: "Substation A",
        line1: "9800 Research Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78759",
        latitude: 30.3833,
        longitude: -97.7419,
        accessNotes: "Escort required. Badge pickup at the north gate.",
        gateCode: "3301",
        contactName: "Wes Hollis",
        contactPhone: "+1 512 555 0181",
        isPrimary: true,
      },
      {
        label: "Substation B",
        line1: "8700 N Lamar Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78753",
        latitude: 30.3615,
        longitude: -97.7173,
        accessNotes: "Wash pad behind the service building. Bring the long hose.",
        gateCode: "3302",
        isPrimary: false,
      },
    ],
    contacts: [
      {
        firstName: "Wes",
        lastName: "Hollis",
        email: "wes@ridgelineutilities.com",
        phone: "+1 512 555 0181",
        title: "Facilities Supervisor",
      },
      {
        firstName: "Tara",
        lastName: "Okafor",
        email: "tara@ridgelineutilities.com",
        phone: "+1 512 555 0182",
        title: "Compliance Coordinator",
      },
    ],
  },
  {
    name: "The Glass House",
    customerType: "COMMERCIAL",
    industry: "Hospitality",
    phone: "+1 512 555 0190",
    email: "events@glasshouseatx.com",
    website: "glasshouseatx.com",
    notes: "Event venue. Post-event turnover clean, often same night.",
    tags: ["events", "priority"],
    owner: "jordan",
    createdDaysAgo: 165,
    locations: [
      {
        label: "Glass House venue",
        line1: "1100 E 5th St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        latitude: 30.2627,
        longitude: -97.7311,
        accessNotes: "Load-in through the alley. Event manager signs off on completion.",
        gateCode: "8805",
        contactName: "Simone Park",
        contactPhone: "+1 512 555 0191",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Simone",
        lastName: "Park",
        email: "simone@glasshouseatx.com",
        phone: "+1 512 555 0191",
        title: "Event Director",
      },
    ],
  },
  {
    name: "Easton Ridge Apartments",
    customerType: "PROPERTY_MANAGER",
    industry: "Real Estate",
    phone: "+1 512 555 0200",
    email: "manager@eastonridgeatx.com",
    notes: "180-unit complex. Unit turns invoiced per apartment.",
    tags: ["portfolio", "unit-turns"],
    owner: "jordan",
    createdDaysAgo: 120,
    locations: [
      {
        label: "Easton Ridge leasing office",
        line1: "2201 E Riverside Dr",
        city: "Austin",
        state: "TX",
        postalCode: "78741",
        latitude: 30.2377,
        longitude: -97.722,
        accessNotes: "Check in at leasing office for unit keys and parking pass.",
        gateCode: "6140",
        isPrimary: true,
      },
      {
        label: "Easton Ridge Building C",
        line1: "1900 S 1st St",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        latitude: 30.247,
        longitude: -97.758,
        accessNotes: "Building C service closet on the second floor. Code at the call box.",
        gateCode: "6141",
        isPrimary: false,
      },
    ],
    contacts: [
      {
        firstName: "Nadia",
        lastName: "Brooks",
        email: "nadia@eastonridgeatx.com",
        phone: "+1 512 555 0201",
        title: "Community Manager",
      },
      {
        firstName: "Owen",
        lastName: "Frost",
        email: "owen@eastonridgeatx.com",
        phone: "+1 512 555 0202",
        title: "Maintenance Supervisor",
      },
    ],
  },
  {
    name: "Priya Shah",
    customerType: "RESIDENTIAL",
    industry: "Home Services",
    phone: "+1 512 555 0210",
    email: "priya.shah.atx@gmail.com",
    notes: "New homeowner. Signed up for the seasonal maintenance plan.",
    tags: ["residential", "maintenance-plan"],
    owner: "maya",
    createdDaysAgo: 85,
    locations: [
      {
        label: "Home",
        line1: "4512 Avenue B",
        city: "Austin",
        state: "TX",
        postalCode: "78751",
        latitude: 30.3055,
        longitude: -97.74,
        accessNotes: "Driveway parking. Attic access in the hallway closet.",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Priya",
        lastName: "Shah",
        email: "priya.shah.atx@gmail.com",
        phone: "+1 512 555 0210",
        title: "Homeowner",
      },
    ],
  },
  {
    name: "Willow & Vine Salon",
    customerType: "COMMERCIAL",
    industry: "Salon & Spa",
    phone: "+1 512 555 0220",
    email: "hello@willowandvine.com",
    website: "willowandvine.com",
    notes: "Nine chairs and two treatment rooms. Prefers morning service windows.",
    tags: ["salon", "recurring"],
    owner: "sofia",
    createdDaysAgo: 110,
    locations: [
      {
        label: "Willow & Vine",
        line1: "3801 N Lamar Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78756",
        latitude: 30.307,
        longitude: -97.7395,
        accessNotes: "Back door code rotates quarterly; ask front desk for the current code.",
        gateCode: "4127",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Ivy",
        lastName: "Castillo",
        email: "ivy@willowandvine.com",
        phone: "+1 512 555 0221",
        title: "Owner",
      },
    ],
  },
  {
    name: "Zilker Bistro",
    customerType: "COMMERCIAL",
    industry: "Hospitality",
    phone: "+1 512 555 0230",
    email: "ops@zilkerbistro.com",
    website: "zilkerbistro.com",
    notes: "Kitchen remodel finishing next quarter. Duct work deferred until then.",
    tags: ["commercial", "deferred"],
    owner: "chris",
    createdDaysAgo: 95,
    locations: [
      {
        label: "Zilker Bistro",
        line1: "1700 S Lamar Blvd",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        latitude: 30.2507,
        longitude: -97.7704,
        accessNotes: "Service entrance on the alley. Ask for the kitchen manager.",
        gateCode: "9090",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Marco",
        lastName: "Diaz",
        email: "marco@zilkerbistro.com",
        phone: "+1 512 555 0231",
        title: "General Manager",
      },
    ],
  },
  {
    name: "Marcus Bell",
    customerType: "RESIDENTIAL",
    industry: "Other",
    phone: "+1 512 555 0240",
    email: "marcus.bell@proton.me",
    notes: "No-showed one tune-up. Confirmed twice for the next visit.",
    tags: ["residential", "needs-confirmation"],
    owner: "chris",
    createdDaysAgo: 70,
    locations: [
      {
        label: "Home",
        line1: "6103 Highland Hills Dr",
        city: "Austin",
        state: "TX",
        postalCode: "78731",
        latitude: 30.354,
        longitude: -97.762,
        accessNotes: "Gate sticks in humid weather. Dog is friendly but keep the gate shut.",
        isPrimary: true,
      },
    ],
    contacts: [
      {
        firstName: "Marcus",
        lastName: "Bell",
        email: "marcus.bell@proton.me",
        phone: "+1 512 555 0240",
        title: "Homeowner",
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Service price book                                                         */
/* -------------------------------------------------------------------------- */

interface ServiceSeed {
  name: string;
  category: string;
  description: string;
  unit: ServiceUnit;
  durationMinutes: number;
  price: number;
  cost: number;
  taxable: boolean;
}

const serviceSeeds: ServiceSeed[] = [
  {
    name: "AC diagnostic",
    category: "HVAC",
    description: "Full diagnostic with refrigerant pressure and electrical check.",
    unit: "VISIT",
    durationMinutes: 60,
    price: 8_900,
    cost: 3_200,
    taxable: true,
  },
  {
    name: "HVAC seasonal tune-up",
    category: "HVAC",
    description: "Seasonal inspection, filter change, coil rinse and thermostat check.",
    unit: "UNIT",
    durationMinutes: 90,
    price: 14_900,
    cost: 5_200,
    taxable: true,
  },
  {
    name: "AC repair labor",
    category: "HVAC",
    description: "Repair labor billed hourly. Parts quoted separately.",
    unit: "HOUR",
    durationMinutes: 60,
    price: 12_500,
    cost: 4_800,
    taxable: true,
  },
  {
    name: "Duct cleaning",
    category: "HVAC",
    description: "Negative-pressure duct cleaning up to 12 vents, including returns.",
    unit: "VISIT",
    durationMinutes: 240,
    price: 42_000,
    cost: 14_500,
    taxable: true,
  },
  {
    name: "Smart thermostat install",
    category: "HVAC",
    description: "Supply and install a smart thermostat, including app setup.",
    unit: "ITEM",
    durationMinutes: 45,
    price: 18_500,
    cost: 9_000,
    taxable: true,
  },
  {
    name: "HVAC maintenance plan",
    category: "HVAC",
    description: "Annual plan with two tune-ups, priority dispatch and no trip fees.",
    unit: "UNIT",
    durationMinutes: 60,
    price: 24_900,
    cost: 6_000,
    taxable: false,
  },
  {
    name: "Window cleaning — exterior",
    category: "Windows",
    description: "Exterior glass, frames and sills up to two storeys.",
    unit: "VISIT",
    durationMinutes: 120,
    price: 18_000,
    cost: 6_200,
    taxable: true,
  },
  {
    name: "Window cleaning — interior",
    category: "Windows",
    description: "Interior glass, tracks and screens.",
    unit: "VISIT",
    durationMinutes: 90,
    price: 12_000,
    cost: 4_100,
    taxable: true,
  },
  {
    name: "High-rise pane detail",
    category: "Windows",
    description: "Per-pane detail work on high-rise glass with harness access.",
    unit: "ITEM",
    durationMinutes: 30,
    price: 4_500,
    cost: 1_600,
    taxable: true,
  },
  {
    name: "Gutter clearing",
    category: "Exterior",
    description: "Clear gutters and downspouts, bag and remove debris.",
    unit: "VISIT",
    durationMinutes: 120,
    price: 24_000,
    cost: 7_000,
    taxable: true,
  },
  {
    name: "Pressure washing",
    category: "Exterior",
    description: "Driveways, walkways and siding with a surface cleaner.",
    unit: "SQFT",
    durationMinutes: 180,
    price: 45,
    cost: 12,
    taxable: true,
  },
  {
    name: "Salon deep clean",
    category: "Salon",
    description: "Stations, floors, mirrors, wash basins and break room.",
    unit: "VISIT",
    durationMinutes: 150,
    price: 35_000,
    cost: 12_000,
    taxable: true,
  },
  {
    name: "Nail station sanitizing",
    category: "Salon",
    description: "Hospital-grade sanitizing of stations, tools and pedicure chairs.",
    unit: "VISIT",
    durationMinutes: 75,
    price: 9_500,
    cost: 3_100,
    taxable: true,
  },
  {
    name: "Salon recurring maintenance",
    category: "Salon",
    description: "Weekly surface clean, mirror polish and product restock.",
    unit: "VISIT",
    durationMinutes: 90,
    price: 18_500,
    cost: 6_000,
    taxable: true,
  },
  {
    name: "Janitorial service",
    category: "Commercial",
    description: "Trash, surfaces, floors and restrooms. Billed hourly per cleaner.",
    unit: "HOUR",
    durationMinutes: 60,
    price: 6_500,
    cost: 2_800,
    taxable: true,
  },
  {
    name: "Post-event turnover",
    category: "Commercial",
    description: "Full venue reset after events, including restrooms and bar area.",
    unit: "VISIT",
    durationMinutes: 180,
    price: 28_000,
    cost: 9_500,
    taxable: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

interface LineSeed {
  service: number;
  quantity: number;
}

interface JobSeed {
  key: string;
  title: string;
  customer: number;
  location: number;
  contact: number;
  status: JobStatus;
  priority: JobPriority;
  dayOffset: number | null;
  hour?: number;
  minute?: number;
  durationMinutes: number;
  assignee: UserKey | null;
  source: string;
  lines: LineSeed[];
  notes?: string;
  cancelReason?: string;
  rating?: number;
  ratingNote?: string;
  recurrence?: RecurrenceFrequency;
  recurrenceUntilDays?: number;
  deposit?: number;
}

const jobSeeds: JobSeed[] = [
  {
    key: "job-harborview-annual",
    title: "Harborview Tower exterior windows",
    customer: 0,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -86,
    hour: 9,
    durationMinutes: 240,
    assignee: "chris",
    source: "Recurring contract",
    lines: [{ service: 6, quantity: 4 }],
    notes: "Tower lobby and east stairwell. Security signed off at 12:40.",
    rating: 5,
    ratingNote: "Dana called out how clear the lobby glass looked.",
    recurrence: "MONTHLY",
    recurrenceUntilDays: 180,
  },
  {
    key: "job-lumen-deep-clean",
    title: "Lumen Nail Bar deep clean",
    customer: 3,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -74,
    hour: 10,
    durationMinutes: 150,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 11, quantity: 1 }],
    rating: 5,
    recurrence: "BIWEEKLY",
    recurrenceUntilDays: 120,
  },
  {
    key: "job-chen-ac-tuneup",
    title: "Chen seasonal HVAC tune-up",
    customer: 1,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -63,
    hour: 13,
    durationMinutes: 150,
    assignee: "maya",
    source: "Phone",
    lines: [
      { service: 0, quantity: 1 },
      { service: 1, quantity: 1 },
    ],
    notes: "Text before arrival. Two dogs.",
    rating: 4,
  },
  {
    key: "job-parkside-pressure-wash",
    title: "Parkside clubhouse pressure wash",
    customer: 5,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -55,
    hour: 8,
    minute: 30,
    durationMinutes: 300,
    assignee: "jordan",
    source: "Board approval",
    lines: [{ service: 10, quantity: 900 }],
    notes: "Board wants before/after photos.",
    rating: 4,
    recurrence: "QUARTERLY",
    recurrenceUntilDays: 365,
  },
  {
    key: "job-northgate-janitorial",
    title: "Northgate after-hours clean",
    customer: 2,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -46,
    hour: 17,
    minute: 30,
    durationMinutes: 120,
    assignee: "maya",
    source: "Referral",
    lines: [{ service: 14, quantity: 2 }],
    notes: "Alarm code is texted the morning of the visit.",
    rating: 5,
    recurrence: "WEEKLY",
    recurrenceUntilDays: 90,
  },
  {
    key: "job-easton-window-turn",
    title: "Easton Ridge window turnover",
    customer: 9,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -38,
    hour: 9,
    durationMinutes: 180,
    assignee: "chris",
    source: "Recurring contract",
    lines: [
      { service: 6, quantity: 1 },
      { service: 7, quantity: 1 },
    ],
    rating: 3,
    ratingNote: "Sills needed a second pass.",
    recurrence: "MONTHLY",
    recurrenceUntilDays: 120,
  },
  {
    key: "job-cedar-deep-clean",
    title: "Cedar & Co. station reset",
    customer: 4,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -31,
    hour: 8,
    durationMinutes: 150,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 11, quantity: 1 }],
    rating: 5,
    recurrence: "WEEKLY",
    recurrenceUntilDays: 90,
  },
  {
    key: "job-glasshouse-turnover",
    title: "Glass House post-event reset",
    customer: 8,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -25,
    hour: 17,
    durationMinutes: 180,
    assignee: "jordan",
    source: "Event pipeline",
    lines: [{ service: 15, quantity: 1 }],
    notes: "Same-night turnover after the fall gala.",
    rating: 5,
  },
  {
    key: "job-zilker-duct-cancel",
    title: "Zilker Bistro duct cleaning",
    customer: 12,
    location: 0,
    contact: 0,
    status: "CANCELED",
    priority: "HIGH",
    dayOffset: -21,
    hour: 10,
    durationMinutes: 240,
    assignee: "maya",
    source: "Phone",
    lines: [{ service: 3, quantity: 1 }],
    cancelReason: "Kitchen remodel delayed; revisit next quarter.",
  },
  {
    key: "job-marcus-tuneup-noshow",
    title: "Marcus Bell HVAC tune-up",
    customer: 13,
    location: 0,
    contact: 0,
    status: "NO_SHOW",
    priority: "NORMAL",
    dayOffset: -17,
    hour: 11,
    durationMinutes: 90,
    assignee: "chris",
    source: "Website",
    lines: [{ service: 1, quantity: 1 }],
    notes: "Customer not home; door hanger left with a rebooking code.",
  },
  {
    key: "job-willow-deep-clean",
    title: "Willow & Vine deep clean",
    customer: 11,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -13,
    hour: 9,
    minute: 30,
    durationMinutes: 150,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 11, quantity: 1 }],
    rating: 4,
    recurrence: "MONTHLY",
    recurrenceUntilDays: 180,
  },
  {
    key: "job-ridgeline-wash",
    title: "Ridgeline substation wash",
    customer: 7,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -10,
    hour: 8,
    minute: 30,
    durationMinutes: 360,
    assignee: "jordan",
    source: "Contract",
    lines: [{ service: 10, quantity: 2200 }],
    notes: "Escort required; compliance photos archived.",
    rating: 4,
    recurrence: "QUARTERLY",
    recurrenceUntilDays: 365,
  },
  {
    key: "job-priya-tuneup",
    title: "Priya Shah seasonal tune-up",
    customer: 10,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -7,
    hour: 13,
    durationMinutes: 90,
    assignee: "maya",
    source: "Maintenance plan",
    lines: [{ service: 1, quantity: 1 }],
    rating: 5,
    recurrence: "SEMIANNUAL",
    recurrenceUntilDays: 180,
  },
  {
    key: "job-easton-turn-clean",
    title: "Easton Ridge unit turn clean",
    customer: 9,
    location: 1,
    contact: 1,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -3,
    hour: 9,
    durationMinutes: 120,
    assignee: "chris",
    source: "Recurring contract",
    lines: [
      { service: 6, quantity: 1 },
      { service: 7, quantity: 1 },
    ],
    rating: 4,
  },
  {
    key: "job-northgate-week45",
    title: "Northgate weekly clean — week 45",
    customer: 2,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -2,
    hour: 17,
    minute: 30,
    durationMinutes: 120,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 14, quantity: 2 }],
    rating: 5,
  },
  {
    key: "job-harborview-tower-nov",
    title: "Harborview Tower windows — November",
    customer: 0,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -1,
    hour: 8,
    durationMinutes: 210,
    assignee: "chris",
    source: "Recurring contract",
    lines: [
      { service: 6, quantity: 1 },
      { service: 7, quantity: 1 },
    ],
    notes: "Lobby and stairwell glass. Signed off by Luis.",
    rating: 5,
    recurrence: "MONTHLY",
    recurrenceUntilDays: 180,
  },
  {
    key: "job-lumen-today",
    title: "Lumen Nail Bar deep clean",
    customer: 3,
    location: 0,
    contact: 0,
    status: "IN_PROGRESS",
    priority: "HIGH",
    dayOffset: 0,
    hour: 8,
    durationMinutes: 150,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 11, quantity: 1 }],
    notes: "Mina asked for extra attention on the pedicure chairs.",
    recurrence: "BIWEEKLY",
    recurrenceUntilDays: 120,
  },
  {
    key: "job-chen-today",
    title: "Chen seasonal HVAC tune-up",
    customer: 1,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 0,
    hour: 10,
    minute: 30,
    durationMinutes: 90,
    assignee: "maya",
    source: "Phone",
    lines: [{ service: 1, quantity: 1 }],
    notes: "Text before arrival; two dogs.",
  },
  {
    key: "job-cedar-today",
    title: "Cedar & Co. nail station sanitizing",
    customer: 4,
    location: 0,
    contact: 0,
    status: "DISPATCHED",
    priority: "NORMAL",
    dayOffset: 0,
    hour: 13,
    durationMinutes: 75,
    assignee: "chris",
    source: "Recurring contract",
    lines: [{ service: 12, quantity: 1 }],
    recurrence: "WEEKLY",
    recurrenceUntilDays: 90,
  },
  {
    key: "job-northgate-today",
    title: "Northgate after-hours clean",
    customer: 2,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 0,
    hour: 15,
    durationMinutes: 120,
    assignee: "jordan",
    source: "Recurring contract",
    lines: [{ service: 14, quantity: 2 }],
    recurrence: "WEEKLY",
    recurrenceUntilDays: 90,
  },
  {
    key: "job-harborview-east",
    title: "Harborview East common areas",
    customer: 0,
    location: 1,
    contact: 1,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 1,
    hour: 8,
    minute: 30,
    durationMinutes: 180,
    assignee: "chris",
    source: "Recurring contract",
    lines: [
      { service: 6, quantity: 1 },
      { service: 7, quantity: 1 },
    ],
    notes: "Roof code changes monthly; confirm with Luis.",
    recurrence: "MONTHLY",
    recurrenceUntilDays: 180,
    deposit: 5_000,
  },
  {
    key: "job-parkside-quarterly",
    title: "Parkside quarterly pressure wash",
    customer: 5,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 2,
    hour: 9,
    durationMinutes: 300,
    assignee: "jordan",
    source: "Board approval",
    lines: [{ service: 10, quantity: 900 }],
    notes: "Board wants before/after photos sent to Greta.",
    recurrence: "QUARTERLY",
    recurrenceUntilDays: 365,
  },
  {
    key: "job-easton-turns",
    title: "Easton Ridge unit turns — Building C",
    customer: 9,
    location: 1,
    contact: 1,
    status: "SCHEDULED",
    priority: "HIGH",
    dayOffset: 3,
    hour: 10,
    durationMinutes: 180,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 14, quantity: 3 }],
    notes: "Three units: 204, 207 and 311.",
  },
  {
    key: "job-zilker-windows",
    title: "Zilker Bistro window cleaning",
    customer: 12,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "LOW",
    dayOffset: 4,
    hour: 9,
    minute: 30,
    durationMinutes: 120,
    assignee: "maya",
    source: "Upsell",
    lines: [{ service: 6, quantity: 1 }],
  },
  {
    key: "job-glasshouse-event",
    title: "Glass House post-event turnover",
    customer: 8,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "HIGH",
    dayOffset: 6,
    hour: 17,
    durationMinutes: 180,
    assignee: "jordan",
    source: "Event pipeline",
    lines: [{ service: 15, quantity: 1 }],
    notes: "Confirm event end time; same-night turnover.",
  },
  {
    key: "job-willow-maintenance",
    title: "Willow & Vine salon maintenance",
    customer: 11,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 8,
    hour: 9,
    durationMinutes: 90,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 13, quantity: 1 }],
    recurrence: "MONTHLY",
    recurrenceUntilDays: 180,
  },
  {
    key: "job-ridgeline-substation",
    title: "Ridgeline Substation B wash",
    customer: 7,
    location: 1,
    contact: 1,
    status: "SCHEDULED",
    priority: "HIGH",
    dayOffset: 10,
    hour: 8,
    minute: 30,
    durationMinutes: 360,
    assignee: "chris",
    source: "Contract",
    lines: [{ service: 10, quantity: 2200 }],
    notes: "Escort confirmed; badge pickup at the north gate.",
  },
  {
    key: "job-priya-duct",
    title: "Priya Shah duct cleaning",
    customer: 10,
    location: 0,
    contact: 0,
    status: "SCHEDULED",
    priority: "NORMAL",
    dayOffset: 13,
    hour: 10,
    durationMinutes: 240,
    assignee: "maya",
    source: "Estimate",
    lines: [{ service: 3, quantity: 1 }],
    notes: "Approved from estimate EST-1003.",
  },
  {
    key: "job-glasshouse-urgent",
    title: "Glass House urgent post-event reset",
    customer: 8,
    location: 0,
    contact: 0,
    status: "UNSCHEDULED",
    priority: "URGENT",
    dayOffset: null,
    durationMinutes: 180,
    assignee: null,
    source: "Event pipeline",
    lines: [
      { service: 15, quantity: 1 },
      { service: 14, quantity: 2 },
    ],
    notes: "Same-night turnover; confirm event end time.",
  },
  {
    key: "job-marcus-thermostat",
    title: "Marcus Bell thermostat install",
    customer: 13,
    location: 0,
    contact: 0,
    status: "UNSCHEDULED",
    priority: "NORMAL",
    dayOffset: null,
    durationMinutes: 45,
    assignee: null,
    source: "Website",
    lines: [{ service: 4, quantity: 1 }],
    notes: "Waiting on the customer to pick a thermostat model.",
  },
  {
    key: "job-harborview-pane-detail",
    title: "Harborview high-rise pane detail",
    customer: 0,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -60,
    hour: 9,
    durationMinutes: 300,
    assignee: "chris",
    source: "Recurring contract",
    lines: [{ service: 8, quantity: 180 }],
    notes: "Harness crew detailed the north and east elevations; Luis signed off.",
    rating: 5,
  },
  {
    key: "job-glasshouse-janitorial",
    title: "Glass House event-season janitorial",
    customer: 8,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -77,
    hour: 8,
    durationMinutes: 480,
    assignee: "jordan",
    source: "Event pipeline",
    lines: [{ service: 14, quantity: 120 }],
    notes: "Full venue reset crew for the fall event block.",
    rating: 5,
  },
  {
    key: "job-northgate-duct-special",
    title: "Northgate Dental duct cleaning",
    customer: 2,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -66,
    hour: 9,
    durationMinutes: 240,
    assignee: "maya",
    source: "Maintenance plan",
    lines: [{ service: 3, quantity: 2 }],
    notes: "Two air handlers cleaned; compliance photos filed.",
    rating: 5,
  },
  {
    key: "job-chen-ac-repair",
    title: "Chen AC repair — compressor circuit",
    customer: 1,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "HIGH",
    dayOffset: -52,
    hour: 9,
    durationMinutes: 300,
    assignee: "maya",
    source: "Maintenance plan",
    lines: [
      { service: 0, quantity: 1 },
      { service: 2, quantity: 4 },
    ],
    notes: "Replaced the start capacitor and verified the refrigerant charge.",
    rating: 4,
  },
  {
    key: "job-easton-window-ext",
    title: "Easton Ridge window cleaning — Building C",
    customer: 9,
    location: 1,
    contact: 1,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -44,
    hour: 9,
    durationMinutes: 240,
    assignee: "chris",
    source: "Recurring contract",
    lines: [
      { service: 6, quantity: 4 },
      { service: 7, quantity: 2 },
    ],
    notes: "Exterior and interior glass for the Building C turn block.",
    rating: 5,
  },
  {
    key: "job-willow-deep-refresh",
    title: "Willow & Vine quarterly deep clean",
    customer: 11,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -67,
    hour: 9,
    durationMinutes: 240,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 11, quantity: 2 }],
    notes: "Stations, mirrors and wash basins detailed across both floors.",
    rating: 5,
  },
  {
    key: "job-cedar-maint-quarter",
    title: "Cedar & Co. quarterly maintenance",
    customer: 4,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -41,
    hour: 9,
    durationMinutes: 180,
    assignee: "sofia",
    source: "Recurring contract",
    lines: [{ service: 13, quantity: 4 }],
    notes: "Four weekly maintenance visits bundled into one invoice.",
    rating: 4,
  },
  {
    key: "job-marisol-gutters",
    title: "Marisol Vega gutter clearing",
    customer: 6,
    location: 0,
    contact: 0,
    status: "COMPLETED",
    priority: "NORMAL",
    dayOffset: -34,
    hour: 9,
    durationMinutes: 240,
    assignee: "jordan",
    source: "Phone",
    lines: [{ service: 9, quantity: 2 }],
    notes: "Front and rear rooflines cleared; downspouts flushed.",
    rating: 5,
  },
];

interface ResolvedJobSeed {
  seed: JobSeed;
  start: Date | null;
  end: Date | null;
}

function resolveJobStart(seed: JobSeed): Date | null {
  if (seed.dayOffset === null) return null;
  return atHour(seed.dayOffset, seed.hour ?? 9, seed.minute ?? 0);
}

function assertNoOverlappingJobs(): void {
  const resolved: ResolvedJobSeed[] = jobSeeds.map((seed) => {
    const start = resolveJobStart(seed);
    const end = start ? new Date(start.getTime() + seed.durationMinutes * 60_000) : null;
    return { seed, start, end };
  });
  for (let a = 0; a < resolved.length; a += 1) {
    for (let b = a + 1; b < resolved.length; b += 1) {
      const left = resolved[a]!;
      const right = resolved[b]!;
      if (!left.seed.assignee || left.seed.assignee !== right.seed.assignee) continue;
      if (!left.start || !left.end || !right.start || !right.end) continue;
      if (left.start.getTime() < right.end.getTime() && left.end.getTime() > right.start.getTime()) {
        throw new Error(
          `Overlapping jobs for ${left.seed.assignee}: ${left.seed.key} and ${right.seed.key}`,
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Estimates, invoices, documents                                             */
/* -------------------------------------------------------------------------- */

interface EstimateSeed {
  key: string;
  title: string;
  customer: number;
  location: number;
  contact: number;
  status: EstimateStatus;
  owner: UserKey;
  issuedDaysAgo: number | null;
  expiresInDays: number;
  lines: LineSeed[];
  notes?: string;
  convertedJob?: string;
}

const estimateSeeds: EstimateSeed[] = [
  {
    key: "est-harborview-annual",
    title: "Harborview annual window contract",
    customer: 0,
    location: 0,
    contact: 0,
    status: "SENT",
    owner: "demo",
    issuedDaysAgo: 6,
    expiresInDays: 14,
    lines: [
      { service: 6, quantity: 6 },
      { service: 7, quantity: 6 },
    ],
    notes: "Covers six buildings, monthly cadence and priority scheduling.",
  },
  {
    key: "est-lumen-detail",
    title: "Lumen interior window detail",
    customer: 3,
    location: 0,
    contact: 0,
    status: "DRAFT",
    owner: "jordan",
    issuedDaysAgo: null,
    expiresInDays: 30,
    lines: [{ service: 7, quantity: 1 }],
    notes: "Interior detail across twelve panes.",
  },
  {
    key: "est-priya-duct",
    title: "Priya Shah duct cleaning",
    customer: 10,
    location: 0,
    contact: 0,
    status: "APPROVED",
    owner: "maya",
    issuedDaysAgo: 11,
    expiresInDays: 9,
    lines: [{ service: 3, quantity: 1 }],
    notes: "Approved by text; duct cleaning scheduled.",
    convertedJob: "job-priya-duct",
  },
  {
    key: "est-cedar-refresh",
    title: "Cedar & Co. full refresh",
    customer: 4,
    location: 0,
    contact: 0,
    status: "DECLINED",
    owner: "demo",
    issuedDaysAgo: 22,
    expiresInDays: -2,
    lines: [
      { service: 11, quantity: 1 },
      { service: 13, quantity: 1 },
    ],
    notes: "Declined — budget moved to Q3.",
  },
  {
    key: "est-northgate-agreement",
    title: "Northgate HVAC maintenance agreement",
    customer: 2,
    location: 0,
    contact: 0,
    status: "EXPIRED",
    owner: "jordan",
    issuedDaysAgo: 45,
    expiresInDays: -12,
    lines: [{ service: 1, quantity: 4 }],
    notes: "No response after two follow-ups.",
  },
  {
    key: "est-zilker-duct",
    title: "Zilker Bistro duct cleaning",
    customer: 12,
    location: 0,
    contact: 0,
    status: "SENT",
    owner: "demo",
    issuedDaysAgo: 4,
    expiresInDays: 18,
    lines: [
      { service: 3, quantity: 1 },
      { service: 0, quantity: 1 },
    ],
    notes: "Hold until the kitchen remodel is finished.",
  },
  {
    key: "est-zilker-windows",
    title: "Zilker Bistro exterior windows",
    customer: 12,
    location: 0,
    contact: 0,
    status: "APPROVED",
    owner: "chris",
    issuedDaysAgo: 10,
    expiresInDays: 8,
    lines: [{ service: 6, quantity: 1 }],
    notes: "Approved after the dining-room refresh; booked for next week.",
    convertedJob: "job-zilker-windows",
  },
];

interface PaymentSeed {
  amount: number;
  method: PaymentMethod;
  reference?: string;
  receivedDaysAgo: number;
  recordedBy: UserKey;
}

interface InvoiceSeed {
  key: string;
  title: string;
  customer: number;
  location: number;
  job?: string;
  amount?: number;
  amountPaid: number;
  status: InvoiceStatus;
  issuedDaysAgo: number | null;
  dueInDays: number | null;
  paidDaysAgo?: number;
  notes?: string;
  payments: PaymentSeed[];
}

const invoiceSeeds: InvoiceSeed[] = [
  {
    key: "inv-harborview-nov",
    title: "Harborview Tower windows — November",
    customer: 0,
    location: 0,
    job: "job-harborview-tower-nov",
    amountPaid: 32_475,
    status: "PAID",
    issuedDaysAgo: 4,
    dueInDays: 10,
    paidDaysAgo: 1,
    payments: [
      {
        amount: 30_000,
        method: "ACH",
        reference: "ACH-88213",
        receivedDaysAgo: 2,
        recordedBy: "jordan",
      },
      {
        amount: 2_475,
        method: "CARD",
        reference: "ch_3QzTowerNov",
        receivedDaysAgo: 1,
        recordedBy: "demo",
      },
    ],
  },
  {
    key: "inv-northgate-week45",
    title: "Northgate weekly clean — week 45",
    customer: 2,
    location: 0,
    job: "job-northgate-week45",
    amountPaid: 0,
    status: "SENT",
    issuedDaysAgo: 12,
    dueInDays: -3,
    notes: "Second reminder queued by the overdue-invoice automation.",
    payments: [],
  },
  {
    key: "inv-easton-turn",
    title: "Easton Ridge unit turn clean",
    customer: 9,
    location: 1,
    job: "job-easton-turn-clean",
    amountPaid: 20_000,
    status: "PARTIAL",
    issuedDaysAgo: 3,
    dueInDays: 27,
    notes: "Tenant damage credit applied against the balance.",
    payments: [
      {
        amount: 17_500,
        method: "CARD",
        reference: "ch_3QzEastonTurn",
        receivedDaysAgo: 2,
        recordedBy: "chris",
      },
      {
        amount: 2_500,
        method: "ADJUSTMENT",
        reference: "Service credit — gate delay",
        receivedDaysAgo: 2,
        recordedBy: "jordan",
      },
    ],
  },
  {
    key: "inv-ridgeline-wash",
    title: "Ridgeline substation wash",
    customer: 7,
    location: 0,
    job: "job-ridgeline-wash",
    amountPaid: 107_168,
    status: "PAID",
    issuedDaysAgo: 8,
    dueInDays: 22,
    paidDaysAgo: 5,
    notes: "Compliance package accepted; payment released the same week.",
    payments: [
      {
        amount: 107_168,
        method: "ACH",
        reference: "ACH-88377",
        receivedDaysAgo: 5,
        recordedBy: "jordan",
      },
    ],
  },
  {
    key: "inv-willow-void",
    title: "Willow & Vine deep clean",
    customer: 11,
    location: 0,
    job: "job-willow-deep-clean",
    amountPaid: 0,
    status: "VOID",
    issuedDaysAgo: 9,
    dueInDays: 21,
    notes: "Voided — superseded by the corrected Willow invoice after a scheduling change.",
    payments: [],
  },
  {
    key: "inv-priya-tuneup",
    title: "Priya Shah seasonal tune-up",
    customer: 10,
    location: 0,
    job: "job-priya-tuneup",
    amountPaid: 16_129,
    status: "PAID",
    issuedDaysAgo: 8,
    dueInDays: 22,
    paidDaysAgo: 6,
    payments: [
      {
        amount: 16_129,
        method: "CARD",
        reference: "ch_3QzPriyaTune",
        receivedDaysAgo: 6,
        recordedBy: "demo",
      },
    ],
  },
  {
    key: "inv-harborview-retainer",
    title: "Harborview monthly common-area retainer",
    customer: 0,
    location: 0,
    amount: 48_000,
    amountPaid: 0,
    status: "SENT",
    issuedDaysAgo: 5,
    dueInDays: 9,
    notes: "Monthly retainer for lobby and stairwell glass.",
    payments: [],
  },
  {
    key: "inv-harborview-pane-detail",
    title: "Harborview high-rise pane detail",
    customer: 0,
    location: 0,
    job: "job-harborview-pane-detail",
    amountPaid: 876_825,
    status: "PAID",
    issuedDaysAgo: 58,
    dueInDays: 12,
    paidDaysAgo: 55,
    payments: [
      {
        amount: 876_825,
        method: "ACH",
        reference: "ACH-88410",
        receivedDaysAgo: 55,
        recordedBy: "jordan",
      },
    ],
  },
  {
    key: "inv-glasshouse-janitorial",
    title: "Glass House event-season janitorial",
    customer: 8,
    location: 0,
    job: "job-glasshouse-janitorial",
    amountPaid: 844_350,
    status: "PAID",
    issuedDaysAgo: 75,
    dueInDays: 15,
    paidDaysAgo: 72,
    payments: [
      {
        amount: 844_350,
        method: "ACH",
        reference: "ACH-88502",
        receivedDaysAgo: 72,
        recordedBy: "jordan",
      },
    ],
  },
  {
    key: "inv-northgate-duct-special",
    title: "Northgate Dental duct cleaning",
    customer: 2,
    location: 0,
    job: "job-northgate-duct-special",
    amountPaid: 90_930,
    status: "PAID",
    issuedDaysAgo: 64,
    dueInDays: 10,
    paidDaysAgo: 61,
    payments: [
      {
        amount: 90_930,
        method: "ACH",
        reference: "ACH-88456",
        receivedDaysAgo: 61,
        recordedBy: "demo",
      },
    ],
  },
  {
    key: "inv-chen-ac-repair",
    title: "Chen AC repair — compressor circuit",
    customer: 1,
    location: 0,
    job: "job-chen-ac-repair",
    amountPaid: 63_759,
    status: "PAID",
    issuedDaysAgo: 50,
    dueInDays: 14,
    paidDaysAgo: 47,
    payments: [
      {
        amount: 63_759,
        method: "CARD",
        reference: "ch_3QzChenRepair",
        receivedDaysAgo: 47,
        recordedBy: "maya",
      },
    ],
  },
  {
    key: "inv-easton-window-ext",
    title: "Easton Ridge window cleaning — Building C",
    customer: 9,
    location: 1,
    job: "job-easton-window-ext",
    amountPaid: 103_920,
    status: "PAID",
    issuedDaysAgo: 42,
    dueInDays: 21,
    paidDaysAgo: 39,
    payments: [
      {
        amount: 103_920,
        method: "ACH",
        reference: "ACH-88489",
        receivedDaysAgo: 39,
        recordedBy: "chris",
      },
    ],
  },
  {
    key: "inv-willow-quarterly",
    title: "Willow & Vine quarterly deep clean",
    customer: 11,
    location: 0,
    job: "job-willow-deep-refresh",
    amountPaid: 60_000,
    status: "PARTIAL",
    issuedDaysAgo: 65,
    dueInDays: 18,
    paidDaysAgo: 62,
    notes: "Balance held pending the mirror replacement credit.",
    payments: [
      {
        amount: 60_000,
        method: "ACH",
        reference: "ACH-88463",
        receivedDaysAgo: 62,
        recordedBy: "sofia",
      },
    ],
  },
  {
    key: "inv-cedar-maint-quarter",
    title: "Cedar & Co. quarterly maintenance",
    customer: 4,
    location: 0,
    job: "job-cedar-maint-quarter",
    amountPaid: 0,
    status: "DRAFT",
    issuedDaysAgo: null,
    dueInDays: 30,
    notes: "Held for review against the quarterly salon agreement.",
    payments: [],
  },
  {
    key: "inv-marisol-gutters",
    title: "Marisol Vega gutter clearing",
    customer: 6,
    location: 0,
    job: "job-marisol-gutters",
    amountPaid: 0,
    status: "SENT",
    issuedDaysAgo: 32,
    dueInDays: -6,
    notes: "Second statement sent; balance is now past due.",
    payments: [],
  },
];

/* -------------------------------------------------------------------------- */
/* Supporting data                                                            */
/* -------------------------------------------------------------------------- */

interface ExpenseSeed {
  category: ExpenseCategory;
  vendor: string;
  description: string;
  amount: number;
  incurredDaysAgo: number;
  job?: string;
  user: UserKey;
}

const expenseSeeds: ExpenseSeed[] = [
  { category: "SUPPLIES", vendor: "Austin Window Supply", description: "Squeegees, blades and microfiber pads", amount: 12_400, incurredDaysAgo: 60, job: "job-harborview-annual", user: "chris" },
  { category: "FUEL", vendor: "Shell", description: "Van fuel — north route", amount: 9_200, incurredDaysAgo: 58, user: "jordan" },
  { category: "PAYROLL", vendor: "Gusto", description: "Technician payroll — period 10", amount: 175_000, incurredDaysAgo: 56, user: "demo" },
  { category: "SUPPLIES", vendor: "Eco Cleaning Co", description: "Eco floor cleaner and mop heads", amount: 18_600, incurredDaysAgo: 50, job: "job-lumen-deep-clean", user: "sofia" },
  { category: "EQUIPMENT", vendor: "Grainger", description: "Commercial wet/dry vacuum", amount: 52_000, incurredDaysAgo: 44, user: "sofia" },
  { category: "INSURANCE", vendor: "Next Insurance", description: "General liability premium", amount: 64_000, incurredDaysAgo: 42, user: "demo" },
  { category: "RENT", vendor: "East Austin Storage", description: "Equipment storage unit", amount: 120_000, incurredDaysAgo: 40, user: "demo" },
  { category: "FUEL", vendor: "Chevron", description: "Van fuel — south route", amount: 8_400, incurredDaysAgo: 35, user: "maya" },
  { category: "SOFTWARE", vendor: "Jobber", description: "Field service software subscription", amount: 14_200, incurredDaysAgo: 33, user: "demo" },
  { category: "MARKETING", vendor: "Google Ads", description: "Local HVAC search campaign", amount: 42_000, incurredDaysAgo: 28, user: "demo" },
  { category: "SUPPLIES", vendor: "HVAC Parts Direct", description: "Capacitors and filters", amount: 28_000, incurredDaysAgo: 26, job: "job-chen-ac-tuneup", user: "maya" },
  { category: "FUEL", vendor: "Shell", description: "Van fuel — central route", amount: 10_800, incurredDaysAgo: 22, user: "chris" },
  { category: "SUPPLIES", vendor: "Salon Supply ATX", description: "Sanitizer concentrate and gloves", amount: 13_500, incurredDaysAgo: 18, job: "job-cedar-deep-clean", user: "sofia" },
  { category: "EQUIPMENT", vendor: "Home Depot", description: "Pressure-wash surface cleaner replacement", amount: 24_000, incurredDaysAgo: 12, job: "job-glasshouse-turnover", user: "jordan" },
  { category: "PAYROLL", vendor: "Gusto", description: "Technician payroll — period 11", amount: 180_000, incurredDaysAgo: 10, user: "demo" },
  { category: "OTHER", vendor: "Downtown Parking", description: "Parking for tower service", amount: 3_600, incurredDaysAgo: 6, job: "job-harborview-tower-nov", user: "chris" },
  { category: "SUPPLIES", vendor: "Austin Window Supply", description: "Replacement glass scraper blades", amount: 9_800, incurredDaysAgo: 2, job: "job-harborview-tower-nov", user: "chris" },
  { category: "FUEL", vendor: "Chevron", description: "Van fuel — east route", amount: 7_300, incurredDaysAgo: 1, user: "jordan" },
  { category: "SOFTWARE", vendor: "Twilio", description: "SMS and voice usage", amount: 5_600, incurredDaysAgo: 1, user: "demo" },
  { category: "MARKETING", vendor: "Yelp Ads", description: "Salon and property-manager lead campaign", amount: 22_000, incurredDaysAgo: 4, user: "demo" },
];

interface CommunicationSeed {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  status: CommunicationStatus;
  intent: CommunicationIntent;
  sentiment: CommunicationSentiment;
  subject?: string;
  body: string;
  customer: number;
  contact: number;
  job?: string;
  user: UserKey;
  aiGenerated?: boolean;
  aiRationale?: string;
  unread?: boolean;
  dayOffset: number;
  hour: number;
  minute?: number;
}

const communicationSeeds: CommunicationSeed[] = [
  { channel: "CALL", direction: "INBOUND", status: "MISSED", intent: "RESCHEDULE", sentiment: "NEGATIVE", body: "Missed call from Simone about moving Saturday's turnover to Sunday.", customer: 8, contact: 0, job: "job-glasshouse-event", user: "jordan", unread: true, dayOffset: 0, hour: 9, minute: 12 },
  { channel: "CALL", direction: "OUTBOUND", status: "SENT", intent: "REMINDER", sentiment: "POSITIVE", body: "Called Ellis to confirm the 10:30 tune-up window; he asked for a text on arrival.", customer: 1, contact: 0, job: "job-chen-today", user: "maya", dayOffset: 0, hour: 10, minute: 5 },
  { channel: "CALL", direction: "OUTBOUND", status: "SENT", intent: "FOLLOW_UP", sentiment: "NEUTRAL", body: "Called Marisol about the semi-annual gutter visit. Voicemail left.", customer: 6, contact: 0, user: "chris", dayOffset: 0, hour: 11, minute: 20 },
  { channel: "CALL", direction: "INBOUND", status: "RECEIVED", intent: "QUOTE", sentiment: "POSITIVE", body: "Dana asked for the annual window proposal to go to the board packet.", customer: 0, contact: 0, user: "demo", dayOffset: -1, hour: 15, minute: 40 },
  { channel: "CALL", direction: "OUTBOUND", status: "SENT", intent: "PAYMENT", sentiment: "NEGATIVE", body: "Called Northgate about the past-due balance; practice manager will review Friday.", customer: 2, contact: 0, user: "jordan", unread: true, dayOffset: -3, hour: 9, minute: 35 },
  { channel: "CALL", direction: "INBOUND", status: "MISSED", intent: "GENERAL", sentiment: "NEUTRAL", body: "Missed call from Marcus about thermostat options.", customer: 13, contact: 0, user: "chris", unread: true, dayOffset: -1, hour: 16, minute: 10 },
  { channel: "CALL", direction: "OUTBOUND", status: "SENT", intent: "REMINDER", sentiment: "POSITIVE", body: "Reminded Greta that the crew arrives Thursday at nine for the quarterly wash.", customer: 5, contact: 0, job: "job-parkside-quarterly", user: "jordan", dayOffset: -2, hour: 13, minute: 5 },
  { channel: "CALL", direction: "INBOUND", status: "RECEIVED", intent: "REVIEW", sentiment: "POSITIVE", body: "Ivy called to say the salon looked great after the last deep clean.", customer: 11, contact: 0, user: "sofia", dayOffset: -5, hour: 10, minute: 15 },
  { channel: "CALL", direction: "OUTBOUND", status: "SENT", intent: "GENERAL", sentiment: "POSITIVE", body: "Walked Wes through the substation access checklist for next week.", customer: 7, contact: 0, job: "job-ridgeline-substation", user: "chris", dayOffset: -6, hour: 14, minute: 30 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "REMINDER", sentiment: "POSITIVE", body: "Hi Ellis, Maya is on the way and will arrive around 10:30. We'll text before we pull in.", customer: 1, contact: 0, job: "job-chen-today", user: "maya", aiGenerated: true, aiRationale: "Customer prefers a text heads-up before arrival.", dayOffset: 0, hour: 8, minute: 45 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "RESCHEDULE", sentiment: "NEUTRAL", body: "Can we push to 11? The dentist is running behind.", customer: 1, contact: 0, job: "job-chen-today", user: "maya", dayOffset: 0, hour: 9, minute: 2 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "PAYMENT", sentiment: "NEUTRAL", body: "Northgate reminder: invoice INV-1002 is past due. Reply if you need a copy.", customer: 2, contact: 0, job: "job-northgate-week45", user: "jordan", aiGenerated: true, aiRationale: "Overdue-invoice automation, second nudge.", dayOffset: 0, hour: 9, minute: 30 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "NEGATIVE", body: "Still deciding on the thermostat. Please stop the reminders for now.", customer: 13, contact: 0, user: "chris", unread: true, dayOffset: -1, hour: 17, minute: 25 },
  { channel: "SMS", direction: "OUTBOUND", status: "SENT", intent: "REVIEW", sentiment: "POSITIVE", body: "Thanks for having us at Lumen! A quick review helps our small crew a lot.", customer: 3, contact: 0, user: "sofia", aiGenerated: true, aiRationale: "Review request sent after a completed recurring clean.", dayOffset: -1, hour: 18, minute: 5 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "RESCHEDULE", sentiment: "NEUTRAL", body: "Nadia here — can the Building C turns move one day later?", customer: 9, contact: 0, job: "job-easton-turns", user: "sofia", dayOffset: -3, hour: 11, minute: 45 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "REMINDER", sentiment: "POSITIVE", body: "Parkside reminder: crew arrives Thursday at 9 for the quarterly pressure wash.", customer: 5, contact: 0, job: "job-parkside-quarterly", user: "jordan", aiGenerated: true, aiRationale: "Appointment reminder with gate instructions omitted for brevity.", dayOffset: -2, hour: 12, minute: 0 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "FOLLOW_UP", sentiment: "POSITIVE", body: "Hi Ivy, checking that Thursday mornings still work for the recurring maintenance visit.", customer: 11, contact: 0, job: "job-willow-maintenance", user: "sofia", dayOffset: -4, hour: 9, minute: 10 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "REVIEW", sentiment: "POSITIVE", body: "Rowan: five stars, the team was great. Leaving a Google review now.", customer: 4, contact: 0, user: "sofia", dayOffset: -5, hour: 15, minute: 55 },
  { channel: "SMS", direction: "OUTBOUND", status: "SENT", intent: "QUOTE", sentiment: "NEUTRAL", body: "Dana, the revised annual window proposal is in your inbox. Happy to walk the board through it.", customer: 0, contact: 0, user: "demo", dayOffset: -6, hour: 10, minute: 25 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "POSITIVE", body: "Priya: the tune-up was quick and the house already feels better. Thank you!", customer: 10, contact: 0, user: "maya", dayOffset: -8, hour: 13, minute: 40 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "REMINDER", sentiment: "NEUTRAL", body: "Simone, confirming the post-event reset for Saturday at 9pm.", customer: 8, contact: 0, job: "job-glasshouse-event", user: "jordan", dayOffset: -9, hour: 16, minute: 0 },
  { channel: "SMS", direction: "OUTBOUND", status: "FAILED", intent: "GENERAL", sentiment: "NEGATIVE", body: "Attempted thermostat follow-up; the number on file rejected the message.", customer: 13, contact: 0, user: "chris", dayOffset: -10, hour: 11, minute: 5 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "PAYMENT", sentiment: "NEGATIVE", body: "Anika from Northgate: please resend the statement to the new billing address.", customer: 2, contact: 0, user: "jordan", unread: true, dayOffset: -12, hour: 14, minute: 20 },
  { channel: "SMS", direction: "OUTBOUND", status: "SENT", intent: "WINBACK", sentiment: "POSITIVE", body: "Marisol, we have a fall gutter special if you'd like to lock in a visit before the holidays.", customer: 6, contact: 0, user: "chris", aiGenerated: true, aiRationale: "No completed job in 90 days; winback offer drafted.", dayOffset: -20, hour: 10, minute: 50 },
  { channel: "SMS", direction: "OUTBOUND", status: "DELIVERED", intent: "REVIEW", sentiment: "POSITIVE", body: "Thanks for the Parkside pressure wash! Before/after photos are in the shared folder.", customer: 5, contact: 0, user: "jordan", dayOffset: -22, hour: 17, minute: 15 },
  { channel: "SMS", direction: "INBOUND", status: "RECEIVED", intent: "QUOTE", sentiment: "POSITIVE", body: "Marco: the window quote looks good, but hold the duct work until the remodel wraps.", customer: 12, contact: 0, user: "maya", dayOffset: -24, hour: 12, minute: 35 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "QUOTE", sentiment: "NEUTRAL", subject: "Annual window contract — revised proposal", body: "Hi Dana, attached is the revised proposal for six buildings on a monthly cadence. It includes priority scheduling and quarterly high-rise detail.", customer: 0, contact: 0, user: "demo", aiGenerated: true, aiRationale: "Proposal recap generated from estimate EST-1001.", dayOffset: -1, hour: 8, minute: 30 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "PAYMENT", sentiment: "NEGATIVE", subject: "Invoice INV-1002 past due", body: "Hi Anika, invoice INV-1002 is now three days past due. The balance is $140.73 and can be settled from the link below.", customer: 2, contact: 0, job: "job-northgate-week45", user: "jordan", aiGenerated: true, aiRationale: "Overdue-invoice automation escalation after the SMS nudge.", dayOffset: -2, hour: 9, minute: 0 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "POSITIVE", subject: "December event calendar", body: "Sharing our December calendar so you can hold the turnover dates. Six events, two of them back-to-back weekends.", customer: 8, contact: 0, user: "jordan", dayOffset: -3, hour: 14, minute: 5 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "FOLLOW_UP", sentiment: "NEUTRAL", subject: "Before/after photos from the pressure wash", body: "Hi Greta, the photos from the clubhouse wash are attached. The board asked for the north walkway close-up as well.", customer: 5, contact: 0, user: "jordan", dayOffset: -4, hour: 10, minute: 45 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "QUOTE", sentiment: "POSITIVE", subject: "Unit turn cleaning proposal", body: "Hi Nadia, the per-unit turn cleaning proposal is attached. We can start with Building C and scale to the rest of the portfolio.", customer: 9, contact: 0, user: "sofia", aiGenerated: true, aiRationale: "Portfolio upsell based on recurring unit-turn demand.", dayOffset: -5, hour: 11, minute: 20 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "NEUTRAL", subject: "Gutter appointment question", body: "Marisol here — is the semi-annual gutter visit still happening this month? The side gate sticks so I'll leave it open.", customer: 6, contact: 0, user: "chris", unread: true, dayOffset: -6, hour: 9, minute: 50 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "REMINDER", sentiment: "NEUTRAL", subject: "Tuesday early-morning access", body: "Hi Rowan, confirming the 8am Tuesday slot. The side door keypad code is on file and the front desk will leave the mop closet open.", customer: 4, contact: 0, user: "sofia", dayOffset: -7, hour: 16, minute: 30 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "REVIEW", sentiment: "POSITIVE", subject: "How did we do?", body: "Hi Ivy, thanks for the kind words on the phone. If you have a moment, a short review would help other local businesses find us.", customer: 11, contact: 0, user: "sofia", aiGenerated: true, aiRationale: "Review request following a positive inbound call.", dayOffset: -8, hour: 9, minute: 40 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "NEGATIVE", subject: "Thermostat quote follow-up", body: "Please pause the thermostat reminders. I'll reach out when I've picked a model.", customer: 13, contact: 0, user: "chris", unread: true, dayOffset: -9, hour: 13, minute: 15 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "WINBACK", sentiment: "POSITIVE", subject: "Fall gutter special — Marisol", body: "Hi Marisol, our fall gutter special is open for the last two weeks of the month. Reply with a day that works and we'll hold it.", customer: 6, contact: 0, user: "chris", dayOffset: -15, hour: 10, minute: 0 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "FOLLOW_UP", sentiment: "NEUTRAL", subject: "Duct cleaning recommendation", body: "Hi Ellis, after the tune-up we recommend a duct cleaning. The estimate is attached and there is no pressure to book this week.", customer: 1, contact: 0, user: "maya", aiGenerated: true, aiRationale: "Upsell generated from completed tune-up and air-quality notes.", dayOffset: -16, hour: 15, minute: 10 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "QUOTE", sentiment: "POSITIVE", subject: "Annual maintenance agreement", body: "Anika here — the maintenance agreement looks reasonable. Can we split it into two payments?", customer: 2, contact: 0, user: "jordan", dayOffset: -18, hour: 11, minute: 25 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "FOLLOW_UP", sentiment: "NEUTRAL", subject: "Easton Ridge turn schedule", body: "Hi Nadia, proposed schedule for the Building C turns is attached. We can hold the Tuesday slot for three units.", customer: 9, contact: 0, user: "sofia", dayOffset: -11, hour: 14, minute: 45 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "GENERAL", sentiment: "POSITIVE", subject: "Thank you from Priya", body: "The duct cleaning crew was tidy and explained everything. Please put us on the semi-annual list.", customer: 10, contact: 0, user: "maya", dayOffset: -13, hour: 10, minute: 30 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "REVIEW", sentiment: "POSITIVE", subject: "Zilker Bistro review request", body: "Hi Marco, thanks for the window cleaning booking. If you're happy with the result, a quick review would mean a lot.", customer: 12, contact: 0, user: "maya", dayOffset: -14, hour: 17, minute: 0 },
  { channel: "EMAIL", direction: "INBOUND", status: "MISSED", intent: "GENERAL", sentiment: "NEUTRAL", subject: "Access code rotation", body: "Ivy here — the back door code rotates next week. Call the front desk before the next visit.", customer: 11, contact: 0, user: "sofia", unread: true, dayOffset: -17, hour: 8, minute: 55 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "QUOTE", sentiment: "NEUTRAL", subject: "Easton Ridge common-area windows", body: "Hi Owen, quoting the common-area windows for Building C. This is separate from the unit-turn work.", customer: 9, contact: 1, user: "sofia", dayOffset: -19, hour: 12, minute: 15 },
  { channel: "EMAIL", direction: "INBOUND", status: "RECEIVED", intent: "PAYMENT", sentiment: "NEGATIVE", subject: "Remittance question", body: "Tara from Ridgeline — the wash invoice needs a PO number before we can release payment.", customer: 7, contact: 1, job: "job-ridgeline-wash", user: "jordan", unread: true, dayOffset: -21, hour: 13, minute: 5 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "DELIVERED", intent: "REMINDER", sentiment: "POSITIVE", subject: "Saturday turnover checklist", body: "Hi Simone, attached is the turnover checklist for Saturday. We'll confirm the event end time on Friday.", customer: 8, contact: 0, job: "job-glasshouse-event", user: "jordan", dayOffset: -26, hour: 9, minute: 35 },
  { channel: "EMAIL", direction: "OUTBOUND", status: "SENT", intent: "FOLLOW_UP", sentiment: "NEUTRAL", subject: "Harborview retainer renewal", body: "Hi Dana, the monthly common-area retainer renews next month. The invoice is already in your portal.", customer: 0, contact: 0, user: "demo", dayOffset: -28, hour: 10, minute: 20 },
];

interface RuleSeed {
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>;
  actions: AutomationAction[];
  enabled: boolean;
  runCount: number;
  lastRunDaysAgo: number | null;
  runs: Array<{
    trigger: AutomationTrigger;
    status: "SUCCESS" | "SKIPPED" | "FAILED";
    entityType: string;
    entityKey?: string;
    entityId?: string;
    detail: string;
    daysAgo: number;
  }>;
}

const automationRuleSeeds: RuleSeed[] = [
  {
    name: "Review request after every completed job",
    description: "Sends a review request by text once a job is marked complete, then creates a task to log the response.",
    trigger: "JOB_COMPLETED",
    conditions: {},
    actions: [
      { type: "REQUEST_REVIEW", channel: "SMS" },
      { type: "CREATE_TASK", title: "Log review outcome", dueInHours: 48 },
    ],
    enabled: true,
    runCount: 128,
    lastRunDaysAgo: 0,
    runs: [
      { trigger: "JOB_COMPLETED", status: "SUCCESS", entityType: "job", entityKey: "job-harborview-tower-nov", detail: "Review request sent to Dana Whitfield.", daysAgo: 1 },
      { trigger: "JOB_COMPLETED", status: "SUCCESS", entityType: "job", entityKey: "job-northgate-week45", detail: "Review request sent to Anika Rao.", daysAgo: 2 },
      { trigger: "JOB_COMPLETED", status: "SKIPPED", entityType: "job", entityKey: "job-easton-turn-clean", detail: "Skipped — customer already reviewed this month.", daysAgo: 3 },
    ],
  },
  {
    name: "Overdue invoice nudge",
    description: "Emails the billing contact and opens a collection task when an invoice is past due.",
    trigger: "INVOICE_OVERDUE",
    conditions: { minTotal: 10_000 },
    actions: [
      { type: "SEND_MESSAGE", channel: "EMAIL", intent: "PAYMENT", body: "Friendly reminder that your invoice is past due." },
      { type: "CREATE_TASK", title: "Call about overdue invoice", body: "Confirm the billing contact received the statement.", dueInHours: 24 },
    ],
    enabled: true,
    runCount: 34,
    lastRunDaysAgo: 2,
    runs: [
      { trigger: "INVOICE_OVERDUE", status: "SUCCESS", entityType: "invoice", entityKey: "inv-northgate-week45", detail: "Email sent to office@northgatedental.com.", daysAgo: 2 },
      { trigger: "INVOICE_OVERDUE", status: "SKIPPED", entityType: "invoice", entityKey: "inv-cedar-maint-quarter", detail: "Skipped — invoice is still a draft.", daysAgo: 6 },
      { trigger: "INVOICE_OVERDUE", status: "FAILED", entityType: "invoice", entityKey: "inv-harborview-retainer", detail: "Provider rejected the email address on file.", daysAgo: 9 },
    ],
  },
  {
    name: "Quote follow-up sequence",
    description: "Creates a follow-up task and texts the customer three days after a quote is sent.",
    trigger: "QUOTE_SENT",
    conditions: { customerTypes: ["COMMERCIAL", "PROPERTY_MANAGER"] },
    actions: [
      { type: "CREATE_TASK", title: "Follow up on sent quote", dueInHours: 72 },
      { type: "SEND_MESSAGE", channel: "SMS", intent: "FOLLOW_UP", body: "Checking in on the quote we sent — happy to adjust the scope." },
    ],
    enabled: true,
    runCount: 52,
    lastRunDaysAgo: 4,
    runs: [
      { trigger: "QUOTE_SENT", status: "SUCCESS", entityType: "estimate", entityKey: "est-harborview-annual", detail: "Follow-up task created for Avery Meridian.", daysAgo: 4 },
      { trigger: "QUOTE_SENT", status: "SUCCESS", entityType: "estimate", entityKey: "est-zilker-duct", detail: "Follow-up task created for Avery Meridian.", daysAgo: 3 },
    ],
  },
  {
    name: "Upcoming appointment reminder",
    description: "Sends a reminder 24 hours before a scheduled appointment. Paused while the message templates are revised.",
    trigger: "APPOINTMENT_UPCOMING",
    conditions: { priorities: ["HIGH", "URGENT"] },
    actions: [
      { type: "SEND_MESSAGE", channel: "SMS", intent: "REMINDER", body: "Reminder: your service appointment is tomorrow." },
      { type: "ADD_TAG", tag: "reminder-sent" },
    ],
    enabled: false,
    runCount: 19,
    lastRunDaysAgo: 12,
    runs: [
      { trigger: "APPOINTMENT_UPCOMING", status: "SUCCESS", entityType: "job", entityKey: "job-parkside-quarterly", detail: "Reminder sent to Greta Lund.", daysAgo: 12 },
      { trigger: "APPOINTMENT_UPCOMING", status: "SKIPPED", entityType: "job", entityKey: "job-ridgeline-substation", detail: "Rule disabled — no message sent.", daysAgo: 13 },
    ],
  },
];

interface ActivitySeed {
  type: "NOTE" | "CALL" | "EMAIL" | "MEETING" | "TASK";
  title: string;
  body?: string;
  customer: number;
  contact: number;
  owner: UserKey;
  createdDaysAgo: number;
  dueInDays?: number;
  completedDaysAgo?: number;
}

const activitySeeds: ActivitySeed[] = [
  { type: "NOTE", title: "Walkthrough with Dana at Harborview Tower", body: "Confirmed loading dock access and the monthly cadence.", customer: 0, contact: 0, owner: "demo", createdDaysAgo: 5, completedDaysAgo: 5 },
  { type: "CALL", title: "Called Ellis about duct cleaning", body: "He wants the estimate by email and will decide after the holidays.", customer: 1, contact: 0, owner: "maya", createdDaysAgo: 4, completedDaysAgo: 4 },
  { type: "NOTE", title: "Mina approved the biweekly deep clean", body: "Keep the eco line stocked in the mop closet.", customer: 3, contact: 0, owner: "sofia", createdDaysAgo: 6, completedDaysAgo: 6 },
  { type: "NOTE", title: "Board requested before/after photos", body: "Send to Greta after the pressure wash.", customer: 5, contact: 0, owner: "jordan", createdDaysAgo: 7, completedDaysAgo: 7 },
  { type: "EMAIL", title: "Sent alarm-code update instructions", body: "New code is texted the morning of each visit.", customer: 2, contact: 0, owner: "jordan", createdDaysAgo: 8, completedDaysAgo: 8 },
  { type: "MEETING", title: "Event calendar walkthrough with Simone", body: "Six events in the next month; two back-to-back weekends.", customer: 8, contact: 0, owner: "jordan", createdDaysAgo: 9, completedDaysAgo: 9 },
  { type: "CALL", title: "Easton Ridge turn scope confirmed", body: "Three units in Building C: 204, 207 and 311.", customer: 9, contact: 0, owner: "sofia", createdDaysAgo: 3, completedDaysAgo: 3 },
  { type: "NOTE", title: "Escort clearance renewed for Ridgeline", body: "Badge pickup at the north gate, valid through next quarter.", customer: 7, contact: 0, owner: "chris", createdDaysAgo: 11, completedDaysAgo: 11 },
  { type: "NOTE", title: "Priya approved the duct cleaning estimate", body: "Schedule after the tune-up; she prefers morning windows.", customer: 10, contact: 0, owner: "maya", createdDaysAgo: 10, completedDaysAgo: 10 },
  { type: "NOTE", title: "Willow asked to shift visits to mornings", body: "Front desk opens at 8:30; back door code rotates quarterly.", customer: 11, contact: 0, owner: "sofia", createdDaysAgo: 12, completedDaysAgo: 12 },
  { type: "EMAIL", title: "Zilker window quote sent", body: "Hold the duct work until the remodel finishes.", customer: 12, contact: 0, owner: "chris", createdDaysAgo: 2, completedDaysAgo: 2 },
  { type: "CALL", title: "Left voicemail about thermostat options", body: "Customer asked to pause reminders until they choose a model.", customer: 13, contact: 0, owner: "chris", createdDaysAgo: 1, completedDaysAgo: 1 },
  { type: "NOTE", title: "Harborview retainer renewal conversation", body: "Dana wants the renewal invoice routed to the board portal.", customer: 0, contact: 0, owner: "demo", createdDaysAgo: 1, completedDaysAgo: 1 },
  { type: "NOTE", title: "Cedar requested the eco product list", body: "Rowan wants a copy for their own supplier comparison.", customer: 4, contact: 0, owner: "sofia", createdDaysAgo: 14, completedDaysAgo: 14 },
  { type: "TASK", title: "Send Zilker quote", customer: 12, contact: 0, owner: "chris", createdDaysAgo: 4, dueInDays: -3, completedDaysAgo: 3 },
  { type: "TASK", title: "Collect certificate of insurance — Ridgeline", customer: 7, contact: 1, owner: "jordan", createdDaysAgo: 6, dueInDays: -1 },
  { type: "TASK", title: "Confirm event end time for Saturday turnover", customer: 8, contact: 0, owner: "jordan", createdDaysAgo: 2, dueInDays: 1 },
  { type: "TASK", title: "Send revised window contract to Harborview board", customer: 0, contact: 0, owner: "demo", createdDaysAgo: 3, dueInDays: 3 },
  { type: "TASK", title: "Order pressure-wash fuel for Parkside", customer: 5, contact: 0, owner: "jordan", createdDaysAgo: 2, dueInDays: 4 },
  { type: "TASK", title: "Confirm alarm code rotation with Northgate", customer: 2, contact: 0, owner: "jordan", createdDaysAgo: 1, dueInDays: 2 },
  { type: "TASK", title: "Schedule unit-turn crew for Easton Ridge", customer: 9, contact: 0, owner: "sofia", createdDaysAgo: 2, dueInDays: 5 },
  { type: "TASK", title: "Follow up on thermostat model selection", customer: 13, contact: 0, owner: "chris", createdDaysAgo: 5, dueInDays: -2 },
  { type: "TASK", title: "Book duct cleaning reminder call", customer: 10, contact: 0, owner: "maya", createdDaysAgo: 1, dueInDays: 6 },
];

interface DealSeed {
  title: string;
  customer: number;
  contact: number;
  stage: number;
  value: number;
  expectedInDays: number | null;
  createdDaysAgo: number;
  description: string;
  owner: UserKey;
  closedDaysAgo?: number;
}

const dealSeeds: DealSeed[] = [
  { title: "Annual window contract — Harborview", customer: 0, contact: 0, stage: 2, value: 11_640_000, expectedInDays: 14, createdDaysAgo: 12, description: "Six buildings on a monthly cadence. Awaiting board signature.", owner: "demo" },
  { title: "HVAC maintenance agreement — Northgate", customer: 2, contact: 0, stage: 1, value: 2_160_000, expectedInDays: 21, createdDaysAgo: 9, description: "Quarterly tune-ups across two rooftop units.", owner: "jordan" },
  { title: "Salon group cleaning — Lumen + Cedar", customer: 3, contact: 0, stage: 0, value: 1_680_000, expectedInDays: 30, createdDaysAgo: 4, description: "Multi-site recurring clean bundled across both salons.", owner: "sofia" },
  { title: "Ridgeline substation compliance program", customer: 7, contact: 0, stage: 1, value: 9_000_000, expectedInDays: 45, createdDaysAgo: 20, description: "Quarterly wash program with compliance documentation.", owner: "demo" },
  { title: "Parkside HOA common-area contract", customer: 5, contact: 0, stage: 2, value: 1_320_000, expectedInDays: 10, createdDaysAgo: 15, description: "Year-round maintenance for 42 units.", owner: "jordan" },
  { title: "Glass House event retainer", customer: 8, contact: 0, stage: 3, value: 2_400_000, expectedInDays: null, createdDaysAgo: 60, description: "Scheduled turnover crew for the season.", owner: "jordan", closedDaysAgo: 3 },
  { title: "Easton Ridge unit-turn program", customer: 9, contact: 0, stage: 0, value: 860_000, expectedInDays: 25, createdDaysAgo: 6, description: "Per-unit turnover pricing across the portfolio.", owner: "sofia" },
  { title: "Cedar & Co. quarterly refresh", customer: 4, contact: 0, stage: 4, value: 540_000, expectedInDays: null, createdDaysAgo: 40, description: "Lost on price; revisit at renewal.", owner: "demo", closedDaysAgo: 20 },
];

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  assertNoOverlappingJobs();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await prisma.workspace.deleteMany({ where: { slug: WORKSPACE_SLUG } });

  const userByKey = new Map<UserKey, { id: string; name: string }>();
  for (const seed of userSeeds) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      update: { name: seed.name, passwordHash },
      create: { email: seed.email, name: seed.name, passwordHash },
      select: { id: true, name: true },
    });
    userByKey.set(seed.key, user);
  }

  const owner = must(userByKey.get("demo"), "demo user");

  const workspace = await prisma.workspace.create({
    data: {
      name: "Meridian Home Services",
      slug: WORKSPACE_SLUG,
      currency: "USD",
      businessType: "HVAC",
      timezone: "America/Chicago",
      serviceArea: "Austin, TX",
      depotLatitude: 30.2672,
      depotLongitude: -97.7431,
      createdAt: daysAgo(210),
      updatedAt: now,
    },
  });

  await prisma.membership.createMany({
    data: userSeeds.map((seed) => ({
      userId: must(userByKey.get(seed.key), seed.key).id,
      workspaceId: workspace.id,
      role: seed.role,
      createdAt: daysAgo(seed.joinedDaysAgo),
    })),
  });

  // Pipeline ---------------------------------------------------------------

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: "Growth",
      isDefault: true,
      createdAt: daysAgo(205),
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

  const stageIds = pipeline.stages.map((stage) => stage.id);

  // Customers, locations and contacts --------------------------------------

  const customerIds: string[] = [];
  const locationIds: string[][] = [];
  const contactIds: string[][] = [];

  for (const seed of customerSeeds) {
    const primaries = seed.locations.filter((location) => location.isPrimary);
    if (primaries.length !== 1) {
      throw new Error(`Customer ${seed.name} must have exactly one primary location`);
    }

    const primary = must(primaries[0], `${seed.name} primary location`);
    const customer = await prisma.company.create({
      data: {
        workspaceId: workspace.id,
        name: seed.name,
        customerType: seed.customerType,
        industry: seed.industry,
        phone: seed.phone,
        email: seed.email,
        website: seed.website ?? null,
        address: `${primary.line1}, ${primary.city}, ${primary.state} ${primary.postalCode}`,
        notes: seed.notes,
        tags: JSON.stringify(seed.tags),
        ownerId: must(userByKey.get(seed.owner), seed.owner).id,
        createdAt: daysAgo(seed.createdDaysAgo),
        updatedAt: daysAgo(2),
      },
    });
    customerIds.push(customer.id);

    const locations: string[] = [];
    for (const location of seed.locations) {
      const created = await prisma.location.create({
        data: {
          workspaceId: workspace.id,
          customerId: customer.id,
          label: location.label,
          line1: location.line1,
          line2: location.line2 ?? null,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
          country: "US",
          accessNotes: location.accessNotes ?? null,
          gateCode: location.gateCode ?? null,
          contactName: location.contactName ?? null,
          contactPhone: location.contactPhone ?? null,
          latitude: location.latitude,
          longitude: location.longitude,
          isPrimary: location.isPrimary,
          createdAt: daysAgo(seed.createdDaysAgo),
          updatedAt: daysAgo(2),
        },
      });
      locations.push(created.id);
    }
    locationIds.push(locations);

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
          ownerId: owner.id,
          tags: JSON.stringify(["customer"]),
          createdAt: daysAgo(seed.createdDaysAgo - 2),
          updatedAt: daysAgo(4),
        },
      });
      contacts.push(created.id);
    }
    contactIds.push(contacts);
  }

  // Pipeline deals ---------------------------------------------------------

  for (const seed of dealSeeds) {
    const closed = seed.expectedInDays === null;
    const currentStageId = must(stageIds[seed.stage], `deal stage ${seed.stage}`);
    const history = [
      {
        stageId: must(stageIds[0], "stage 0"),
        changedById: owner.id,
        changedAt: daysAgo(seed.createdDaysAgo),
      },
    ];
    if (seed.stage > 0) {
      history.push({
        stageId: currentStageId,
        changedById: owner.id,
        changedAt: closed
          ? daysAgo(seed.closedDaysAgo ?? 3)
          : daysAgo(Math.max(1, Math.round(seed.createdDaysAgo / 2))),
      });
    }
    await prisma.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: currentStageId,
        title: seed.title,
        value: seed.value,
        currency: "USD",
        contactId: must(contactIds[seed.customer]![seed.contact], "deal contact"),
        companyId: must(customerIds[seed.customer], `deal customer ${seed.customer}`),
        ownerId: must(userByKey.get(seed.owner), seed.owner).id,
        expectedCloseDate: seed.expectedInDays === null ? null : daysFromNow(seed.expectedInDays),
        closedAt: closed ? daysAgo(seed.closedDaysAgo ?? 3) : null,
        description: seed.description,
        tags: JSON.stringify(["service"]),
        stageChangedAt: closed
          ? daysAgo(seed.closedDaysAgo ?? 3)
          : daysAgo(Math.max(1, Math.round(seed.createdDaysAgo / 2))),
        createdAt: daysAgo(seed.createdDaysAgo),
        updatedAt: daysAgo(1),
        history: { create: history },
      },
    });
  }

  // Service price book -----------------------------------------------------

  const serviceIds: string[] = [];
  for (const service of serviceSeeds) {
    const created = await prisma.serviceItem.create({
      data: {
        workspaceId: workspace.id,
        name: service.name,
        category: service.category,
        description: service.description,
        unit: service.unit,
        durationMinutes: service.durationMinutes,
        price: service.price,
        cost: service.cost,
        taxable: service.taxable,
        createdAt: daysAgo(190),
        updatedAt: daysAgo(20),
      },
    });
    serviceIds.push(created.id);
  }

  function buildLines(lines: LineSeed[]) {
    const items = lines.map((line) => {
      const service = must(serviceSeeds[line.service], `service ${line.service}`);
      const serviceId = must(serviceIds[line.service], `service id ${line.service}`);
      return {
        serviceId,
        name: service.name,
        quantity: line.quantity,
        unitPrice: service.price,
        unitCost: service.cost,
      };
    });
    return priceLineItems(items);
  }

  // Jobs -------------------------------------------------------------------

  interface JobRef {
    id: string;
    number: string;
    title: string;
    customerId: string;
    locationId: string;
    contactId: string | null;
    status: string;
    total: number;
  }

  const jobRefs = new Map<string, JobRef>();

  for (const [index, seed] of jobSeeds.entries()) {
    const priced = buildLines(seed.lines);
    const totals = totalsFor(priced.subtotal, TAX_BPS);
    const start = resolveJobStart(seed);
    const end = start ? new Date(start.getTime() + seed.durationMinutes * 60_000) : null;
    const number = `JOB-${1001 + index}`;
    const createdAt = start
      ? new Date(Math.min(now.getTime() - DAY_MS, start.getTime() - 6 * DAY_MS))
      : daysAgo(2);
    const completedAt = seed.status === "COMPLETED" ? end : null;

    const job = await prisma.job.create({
      data: {
        workspaceId: workspace.id,
        number,
        title: seed.title,
        status: seed.status,
        priority: seed.priority,
        source: seed.source,
        customerId: must(customerIds[seed.customer], `customer ${seed.customer}`),
        locationId: must(locationIds[seed.customer]![seed.location], `location ${seed.location}`),
        contactId: must(contactIds[seed.customer]![seed.contact], `contact ${seed.contact}`),
        assigneeId: seed.assignee ? must(userByKey.get(seed.assignee), seed.assignee).id : null,
        scheduledStart: start,
        scheduledEnd: end,
        arrivedAt:
          start && (seed.status === "COMPLETED" || seed.status === "IN_PROGRESS")
            ? new Date(start.getTime() + 5 * 60_000)
            : null,
        completedAt,
        durationMinutes: seed.durationMinutes,
        taxRate: TAX_BPS,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        deposit: seed.deposit ?? 0,
        notes: seed.notes ?? null,
        cancelReason: seed.cancelReason ?? null,
        rating: seed.rating ?? null,
        ratingNote: seed.ratingNote ?? null,
        recurrence: seed.recurrence ?? null,
        recurrenceUntil:
          seed.recurrence && seed.recurrenceUntilDays
            ? daysFromNow(seed.recurrenceUntilDays)
            : null,
        createdAt,
        updatedAt: completedAt ?? daysAgo(1),
        lineItems: { create: toLineItemCreate(priced.lines) },
      },
    });

    jobRefs.set(seed.key, {
      id: job.id,
      number: job.number,
      title: job.title,
      customerId: job.customerId,
      locationId: job.locationId,
      contactId: job.contactId,
      status: job.status,
      total: job.total,
    });
  }

  // Estimates --------------------------------------------------------------

  const estimateRefs = new Map<string, string>();

  for (const [index, seed] of estimateSeeds.entries()) {
    const priced = buildLines(seed.lines);
    const totals = totalsFor(priced.subtotal, TAX_BPS);
    const estimate = await prisma.estimate.create({
      data: {
        workspaceId: workspace.id,
        number: `EST-${1001 + index}`,
        title: seed.title,
        status: seed.status,
        customerId: must(customerIds[seed.customer], `estimate customer ${seed.customer}`),
        locationId: must(locationIds[seed.customer]![seed.location], "estimate location"),
        contactId: must(contactIds[seed.customer]![seed.contact], "estimate contact"),
        ownerId: must(userByKey.get(seed.owner), seed.owner).id,
        jobId: seed.convertedJob ? must(jobRefs.get(seed.convertedJob), seed.convertedJob).id : null,
        issuedAt: seed.issuedDaysAgo === null ? null : atHour(-seed.issuedDaysAgo, 10),
        expiresAt: atHour(seed.expiresInDays, 17),
        taxRate: TAX_BPS,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        notes: seed.notes ?? null,
        createdAt: daysAgo((seed.issuedDaysAgo ?? 1) + 1),
        updatedAt: daysAgo(1),
        lineItems: { create: toLineItemCreate(priced.lines) },
      },
    });
    estimateRefs.set(seed.key, estimate.id);
  }

  const estimateStatuses = new Set(estimateSeeds.map((seed) => seed.status));
  for (const status of ["DRAFT", "SENT", "APPROVED", "DECLINED", "EXPIRED"] as const) {
    if (!estimateStatuses.has(status)) throw new Error(`Estimate seed missing status ${status}`);
  }

  // Invoices and payments --------------------------------------------------

  const invoiceRefs = new Map<string, string>();

  for (const [index, seed] of invoiceSeeds.entries()) {
    const jobRef = seed.job ? must(jobRefs.get(seed.job), seed.job) : undefined;
    const amount = jobRef ? jobRef.total : must(seed.amount, `${seed.key} amount`);
    const paymentTotal = seed.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paymentTotal !== seed.amountPaid) {
      throw new Error(`Invoice ${seed.key} payments ${paymentTotal} != amountPaid ${seed.amountPaid}`);
    }
    if (seed.status === "PAID" && seed.amountPaid !== amount) {
      throw new Error(`Paid invoice ${seed.key} does not settle the full amount`);
    }
    if (seed.status === "PARTIAL" && !(seed.amountPaid > 0 && seed.amountPaid < amount)) {
      throw new Error(`Partial invoice ${seed.key} has an inconsistent amountPaid`);
    }
    if ((seed.status === "SENT" || seed.status === "DRAFT") && seed.amountPaid !== 0) {
      throw new Error(`${seed.status} invoice ${seed.key} should not carry payments`);
    }
    if (seed.status === "DRAFT" && seed.issuedDaysAgo !== null) {
      throw new Error(`Draft invoice ${seed.key} must not have issuedAt`);
    }

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: workspace.id,
        number: `INV-${1001 + index}`,
        title: seed.title,
        status: seed.status,
        customerId: jobRef?.customerId ?? must(customerIds[seed.customer], "invoice customer"),
        locationId: jobRef?.locationId ?? must(locationIds[seed.customer]![seed.location], "invoice location"),
        jobId: jobRef?.id ?? null,
        amount,
        amountPaid: seed.amountPaid,
        issuedAt: seed.issuedDaysAgo === null ? null : atHour(-seed.issuedDaysAgo, 9),
        dueAt: seed.dueInDays === null ? null : atHour(seed.dueInDays, 17),
        paidAt: seed.paidDaysAgo === undefined ? null : atHour(-seed.paidDaysAgo, 16),
        notes: seed.notes ?? null,
        createdAt: atHour(-((seed.issuedDaysAgo ?? 1) + 1), 9),
        updatedAt: daysAgo(1),
      },
    });

    invoiceRefs.set(seed.key, invoice.id);

    if (seed.payments.length > 0) {
      await prisma.payment.createMany({
        data: seed.payments.map((payment) => {
          const receivedAt = atHour(-payment.receivedDaysAgo, 10);
          return {
            workspaceId: workspace.id,
            invoiceId: invoice.id,
            amount: payment.amount,
            method: payment.method,
            reference: payment.reference ?? null,
            receivedAt,
            recordedById: must(userByKey.get(payment.recordedBy), payment.recordedBy).id,
            createdAt: receivedAt,
          };
        }),
      });
    }
  }

  // Expenses ---------------------------------------------------------------

  for (const seed of expenseSeeds) {
    await prisma.expense.create({
      data: {
        workspaceId: workspace.id,
        category: seed.category,
        vendor: seed.vendor,
        description: seed.description,
        amount: seed.amount,
        incurredAt: atHour(-seed.incurredDaysAgo, 12),
        jobId: seed.job ? must(jobRefs.get(seed.job), seed.job).id : null,
        userId: must(userByKey.get(seed.user), seed.user).id,
        createdAt: atHour(-seed.incurredDaysAgo, 12),
        updatedAt: atHour(-seed.incurredDaysAgo, 12),
      },
    });
  }

  // Communications ---------------------------------------------------------

  if (communicationSeeds.length < 40) {
    throw new Error("Seed needs at least 40 communications");
  }

  for (const seed of communicationSeeds) {
    const occurredAt = inPast(seed.dayOffset, seed.hour, seed.minute ?? 0);
    await prisma.communication.create({
      data: {
        workspaceId: workspace.id,
        channel: seed.channel,
        direction: seed.direction,
        status: seed.status,
        intent: seed.intent,
        sentiment: seed.sentiment,
        subject: seed.subject ?? null,
        body: seed.body,
        customerId: must(customerIds[seed.customer], `communication customer ${seed.customer}`),
        contactId: must(contactIds[seed.customer]![seed.contact], "communication contact"),
        jobId: seed.job ? must(jobRefs.get(seed.job), seed.job).id : null,
        userId: must(userByKey.get(seed.user), seed.user).id,
        provider: "log",
        externalId: null,
        aiGenerated: seed.aiGenerated ?? false,
        aiRationale: seed.aiGenerated ? (seed.aiRationale ?? null) : null,
        readAt: seed.unread ? null : new Date(occurredAt.getTime() + 10 * 60_000),
        occurredAt,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    });
  }

  // Automation -------------------------------------------------------------

  function resolveRunEntityId(entityType: string, entityKey?: string, entityId?: string): string | null {
    if (!entityKey) return entityId ?? null;
    if (entityType === "job") return must(jobRefs.get(entityKey), entityKey).id;
    if (entityType === "invoice") return must(invoiceRefs.get(entityKey), entityKey);
    if (entityType === "estimate") return must(estimateRefs.get(entityKey), entityKey);
    return entityId ?? null;
  }

  for (const seed of automationRuleSeeds) {
    await prisma.automationRule.create({
      data: {
        workspaceId: workspace.id,
        name: seed.name,
        description: seed.description,
        trigger: seed.trigger,
        conditions: JSON.stringify(seed.conditions),
        actions: JSON.stringify(seed.actions),
        enabled: seed.enabled,
        runCount: seed.runCount,
        lastRunAt: seed.lastRunDaysAgo === null ? null : daysAgo(seed.lastRunDaysAgo),
        createdAt: daysAgo(60),
        updatedAt: daysAgo(seed.lastRunDaysAgo ?? 30),
        runs: {
          create: seed.runs.map((run) => ({
            workspaceId: workspace.id,
            trigger: run.trigger,
            status: run.status,
            entityType: run.entityType,
            entityId: resolveRunEntityId(run.entityType, run.entityKey, run.entityId),
            detail: run.detail,
            createdAt: daysAgo(run.daysAgo),
          })),
        },
      },
    });
  }

  // Activities and tasks ---------------------------------------------------

  for (const seed of activitySeeds) {
    const createdAt = daysAgo(seed.createdDaysAgo);
    await prisma.activity.create({
      data: {
        workspaceId: workspace.id,
        type: seed.type,
        title: seed.title,
        body: seed.body ?? null,
        dueAt: seed.dueInDays === undefined ? null : daysFromNow(seed.dueInDays),
        completedAt:
          seed.completedDaysAgo === undefined ? null : daysAgo(seed.completedDaysAgo),
        companyId: must(customerIds[seed.customer], `activity customer ${seed.customer}`),
        contactId: must(contactIds[seed.customer]![seed.contact], "activity contact"),
        ownerId: must(userByKey.get(seed.owner), seed.owner).id,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  // Audit trail ------------------------------------------------------------

  await prisma.auditLog.createMany({
    data: [
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: "workspace.created",
        entityType: "workspace",
        entityId: workspace.id,
        metadata: JSON.stringify({ name: workspace.name, slug: workspace.slug }),
        createdAt: daysAgo(210),
      },
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: "job.completed",
        entityType: "job",
        entityId: must(jobRefs.get("job-harborview-tower-nov"), "audit job").id,
        metadata: JSON.stringify({ number: "JOB-1016", total: 32_475 }),
        createdAt: daysAgo(2),
      },
      {
        workspaceId: workspace.id,
        actorId: must(userByKey.get("jordan"), "jordan").id,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: null,
        metadata: JSON.stringify({ number: "INV-1001", amount: 30_000, method: "ACH" }),
        createdAt: daysAgo(2),
      },
      {
        workspaceId: workspace.id,
        actorId: must(userByKey.get("jordan"), "jordan").id,
        action: "invoice.payment",
        entityType: "invoice",
        entityId: null,
        metadata: JSON.stringify({ number: "INV-1001", amount: 2_475, method: "CARD" }),
        createdAt: daysAgo(1),
      },
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: "estimate.sent",
        entityType: "estimate",
        entityId: null,
        metadata: JSON.stringify({ number: "EST-1001", total: 194_850 }),
        createdAt: daysAgo(6),
      },
      {
        workspaceId: workspace.id,
        actorId: must(userByKey.get("jordan"), "jordan").id,
        action: "job.dispatched",
        entityType: "job",
        entityId: must(jobRefs.get("job-cedar-today"), "audit job").id,
        metadata: JSON.stringify({ number: "JOB-1019", assignee: "Chris Nguyen" }),
        createdAt: daysAgo(0),
      },
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        action: "automation.rule.updated",
        entityType: "automationRule",
        entityId: null,
        metadata: JSON.stringify({ name: "Upcoming appointment reminder", enabled: false }),
        createdAt: daysAgo(12),
      },
      {
        workspaceId: workspace.id,
        actorId: must(userByKey.get("sofia"), "sofia").id,
        action: "expense.created",
        entityType: "expense",
        entityId: null,
        metadata: JSON.stringify({ vendor: "Salon Supply ATX", amount: 13_500 }),
        createdAt: daysAgo(18),
      },
    ],
  });

  // Finance invariants -----------------------------------------------------

  const seededInvoices = await prisma.invoice.findMany({
    where: { workspaceId: workspace.id },
    select: {
      number: true,
      status: true,
      amountPaid: true,
      issuedAt: true,
      payments: { select: { amount: true } },
      job: {
        select: {
          number: true,
          subtotal: true,
          tax: true,
          total: true,
          lineItems: { select: { total: true } },
        },
      },
    },
  });

  for (const invoice of seededInvoices) {
    const paymentTotal = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (paymentTotal !== invoice.amountPaid) {
      throw new Error(
        `Invoice ${invoice.number} payments ${paymentTotal} do not match amountPaid ${invoice.amountPaid}`,
      );
    }
    if (invoice.status === "DRAFT" && invoice.issuedAt !== null) {
      throw new Error(`Draft invoice ${invoice.number} must not have issuedAt`);
    }
    if (invoice.job) {
      const lineTotal = invoice.job.lineItems.reduce((sum, line) => sum + line.total, 0);
      if (
        invoice.job.subtotal !== lineTotal ||
        invoice.job.total !== invoice.job.subtotal + invoice.job.tax
      ) {
        throw new Error(`Job ${invoice.job.number} totals do not match its line items and tax`);
      }
    }
  }

  const seededJobs = await prisma.job.findMany({
    where: { workspaceId: workspace.id },
    select: {
      number: true,
      subtotal: true,
      tax: true,
      total: true,
      lineItems: { select: { total: true } },
    },
  });

  for (const job of seededJobs) {
    const lineTotal = job.lineItems.reduce((sum, line) => sum + line.total, 0);
    if (job.subtotal !== lineTotal || job.total !== job.subtotal + job.tax) {
      throw new Error(`Job ${job.number} totals do not match its line items and tax`);
    }
  }

  const rangeStart = daysAgo(90);
  const [revenueAggregate, expenseAggregate, recentPayments] = await Promise.all([
    prisma.payment.aggregate({
      where: { workspaceId: workspace.id, receivedAt: { gte: rangeStart } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { workspaceId: workspace.id, incurredAt: { gte: rangeStart } },
      _sum: { amount: true },
    }),
    prisma.payment.findMany({
      where: { workspaceId: workspace.id, receivedAt: { gte: rangeStart } },
      select: {
        amount: true,
        invoice: {
          select: {
            amount: true,
            job: {
              select: {
                assigneeId: true,
                lineItems: {
                  select: {
                    quantity: true,
                    unitCost: true,
                    service: { select: { category: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const revenue = revenueAggregate._sum.amount ?? 0;
  const expenses = expenseAggregate._sum.amount ?? 0;
  let cogs = 0;
  const revenueTechnicians = new Set<string>();
  const revenueCategories = new Set<string>();

  for (const payment of recentPayments) {
    const job = payment.invoice.job;
    if (!job) continue;
    if (job.assigneeId) revenueTechnicians.add(job.assigneeId);
    const jobCost = job.lineItems.reduce(
      (sum, line) => sum + Math.round(line.quantity * line.unitCost),
      0,
    );
    for (const line of job.lineItems) {
      const category = line.service?.category?.trim();
      if (category) revenueCategories.add(category);
    }
    if (payment.invoice.amount > 0 && jobCost > 0) {
      const ratio = Math.max(-1, Math.min(1, payment.amount / payment.invoice.amount));
      cogs += Math.round(jobCost * ratio);
    }
  }

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

  if (revenue < 1_800_000 || revenue > 3_500_000) {
    throw new Error(`Collected revenue ${revenue} is outside the expected 90-day range`);
  }
  if (expenses < 600_000 || expenses > 1_100_000) {
    throw new Error(`Operating expenses ${expenses} are outside the expected 90-day range`);
  }
  if (grossProfit <= 0 || netProfit <= 0) {
    throw new Error(`Finance summary must be profitable: gross ${grossProfit}, net ${netProfit}`);
  }
  if (grossMarginPct < 55 || grossMarginPct > 75) {
    throw new Error(`Gross margin ${grossMarginPct.toFixed(1)}% is outside the 55-75% target`);
  }
  if (revenueTechnicians.size < 4) {
    throw new Error(
      `Expected at least four technicians with revenue, found ${revenueTechnicians.size}`,
    );
  }
  if (revenueCategories.size < 4) {
    throw new Error(
      `Expected at least four service categories with revenue, found ${revenueCategories.size}`,
    );
  }

  const [jobCount, invoiceCount, communicationCount, expenseCount] = await Promise.all([
    prisma.job.count({ where: { workspaceId: workspace.id } }),
    prisma.invoice.count({ where: { workspaceId: workspace.id } }),
    prisma.communication.count({ where: { workspaceId: workspace.id } }),
    prisma.expense.count({ where: { workspaceId: workspace.id } }),
  ]);

  console.log(
    `Seeded ${workspace.name}: ${customerIds.length} customers, ${serviceSeeds.length} services, ` +
      `${jobCount} jobs, ${estimateSeeds.length} estimates, ${invoiceCount} invoices, ` +
      `${expenseCount} expenses, ${communicationCount} communications, ${dealSeeds.length} deals.`,
  );
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Team login: ${MEMBER_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
