/**
 * The constraint registry — the spine of the scoring model.
 *
 * A constraint is a specific physical thing that is scarce. Specificity is
 * the whole point: "HV transformers >100MVA" produces a usable exposure
 * estimate because you can ask, of any company, what fraction of revenue
 * rides on that exact item. "Power equipment" cannot be answered and
 * produces an exposure number that is really a vibe.
 *
 * These are definitions, not measurements. Nothing here asserts how tight
 * any of them currently is — that is `constraint_states`, and it is populated
 * from filings and transcripts, never from this file.
 *
 * Tiers, from raw input to the site itself:
 *   upstream_material — the feedstock
 *   component         — a part that goes into equipment
 *   equipment         — the finished machine that gets installed
 *   installation      — the labour-and-schedule of putting it in
 *   siting            — permission, land, water, grid rights
 *   labor             — the specific humans who are scarce
 */

/**
 * Deliberately imports nothing. server/supabase.ts throws at import time when
 * SUPABASE_URL is unset, so pulling the store in here would make the registry
 * — and its tests — unloadable without a live database. The seeding side
 * lives in seed-constraints.ts.
 */
export interface RegisteredConstraint {
  slug: string;
  name: string;
  tier: string;
  description: string;
}

export const CONSTRAINT_TIERS = [
  "upstream_material",
  "component",
  "equipment",
  "installation",
  "siting",
  "labor",
] as const;

export type ConstraintTier = (typeof CONSTRAINT_TIERS)[number];

export const CONSTRAINT_REGISTRY: RegisteredConstraint[] = [
  /* ---- upstream_material ---------------------------------------- */
  {
    slug: "grain-oriented-electrical-steel",
    name: "Grain-oriented electrical steel (GOES) for transformer cores",
    tier: "upstream_material",
    description:
      "Cold-rolled silicon steel with grain structure aligned to the rolling direction, used for the laminated cores of power and distribution transformers. Cannot be substituted with ordinary electrical steel without large core-loss penalties. Global production is concentrated in a small number of mills, and adding a line is a multi-year capital project, so core availability sets a hard floor on transformer output regardless of winding or tank capacity.",
  },
  // Deliberately NOT included: copper rod / busbar / winding wire. It is a
  // real fabrication bottleneck, but it sits a layer below where our exposure
  // data can resolve — no 10-K lets you attribute a revenue fraction to
  // "copper busbar sold into data centres" specifically. GOES survives the
  // same test because transformer core steel is near-single-use.

  /* ---- component ------------------------------------------------- */
  {
    slug: "hbm-dram",
    name: "High-bandwidth memory (HBM3E / HBM4) stacks",
    tier: "component",
    description:
      "Stacked DRAM with through-silicon vias, co-packaged with AI accelerators. Supply is set by DRAM wafer allocation plus TSV and stacking yield, and capacity is typically contracted a year or more ahead. Because HBM consumes far more wafer area per bit than commodity DRAM, allocation decisions here propagate into conventional memory pricing as well.",
  },
  {
    slug: "advanced-packaging-cowos",
    name: "Advanced 2.5D/3D packaging capacity (CoWoS-class)",
    tier: "component",
    description:
      "Interposer-based packaging that places logic die and HBM stacks on a common substrate. For most of the AI accelerator supply chain this, not front-end wafer capacity, has been the binding step. Capacity additions require new cleanroom space and specialised bonders with their own long lead times, and qualification of a second source takes quarters.",
  },
  {
    slug: "optical-transceivers-800g",
    name: "800G / 1.6T optical transceivers and their DSPs",
    tier: "component",
    description:
      "Pluggable optics connecting accelerator racks into leaf-spine fabrics, plus the retimer/DSP silicon inside them. Volume per cluster scales super-linearly with cluster size because larger fabrics need more switch tiers. Constrained by DSP silicon supply, laser (EML/CW) output, and the hand-assembly steps that still dominate high-speed optical module production.",
  },
  {
    slug: "hv-cable-and-conductor",
    name: "HV/EHV underground cable and overhead conductor",
    tier: "component",
    description:
      "Extruded XLPE cable for 110kV and above, plus bare overhead conductor (ACSR/ACSS/ACCC) for transmission line builds and reconductoring. Extrusion lines are few and slot allocation runs years out; cable also competes directly with offshore wind and grid-hardening programmes for the same production slots, so data-centre demand is not the only claim on it.",
  },

  /* ---- equipment ------------------------------------------------- */
  {
    slug: "hv-power-transformers-100mva-plus",
    name: "HV power transformers rated above 100 MVA",
    tier: "equipment",
    description:
      "Large three-phase step-down and generator step-up transformers for substations serving data-centre campuses. Bespoke per order, dependent on GOES cores and heavy-gauge copper windings, and constrained further by the specialised test bays and heavy-haul logistics needed to move a unit that can exceed 200 tonnes. The single most-cited long-lead item in interconnect schedules.",
  },
  {
    slug: "medium-voltage-switchgear",
    name: "Medium-voltage switchgear and circuit breakers (5-38 kV)",
    tier: "equipment",
    description:
      "Metal-clad switchgear lineups, vacuum breakers, and protective relaying that sit between the utility service entrance and the building distribution. Ordered per project, assembled to order, and gated by busbar fabrication and breaker supply. Distinct from transformers in that a shortage here can be worked around with design changes at cost, which is why capture matters as much as scarcity.",
  },
  {
    slug: "gas-turbines-for-onsite-generation",
    name: "Aeroderivative and heavy-duty gas turbines for on-site generation",
    tier: "equipment",
    description:
      "Turbine sets ordered for behind-the-meter or bridge generation where grid interconnection cannot arrive on the required schedule. Order books for the major OEMs are effectively a queue, and slot availability rather than list price is what determines whether a campus can be energised. A direct substitute for interconnect capacity, which means it tightens when interconnect tightens.",
  },
  {
    slug: "liquid-cooling-cdu-and-coldplate",
    name: "Liquid cooling distribution units and cold plates for >100 kW racks",
    tier: "equipment",
    description:
      "Coolant distribution units, manifolds, quick-disconnects, and direct-to-chip cold plates required once rack density passes what air can remove. Demand is new rather than cyclical — the installed base was near zero — so supply is set by how fast a young supplier set can add assembly and leak-test capacity, and qualification cycles with hyperscalers are long.",
  },
  {
    slug: "backup-gensets-2mw-plus",
    name: "Diesel and gas backup generator sets, 2 MW and above",
    tier: "equipment",
    description:
      "Standby generation sized for whole-hall backup, plus the paralleling switchgear and fuel systems around them. Constrained by large-bore engine block casting and machining capacity, and increasingly by local air-permit limits on runtime hours, which couples this constraint to the siting tier rather than leaving it purely industrial.",
  },

  /* ---- installation ---------------------------------------------- */
  {
    slug: "datacenter-shell-epc-capacity",
    name: "Data-centre shell construction and EPC contractor capacity",
    tier: "installation",
    description:
      "The general contractors and engineering-procurement-construction firms able to deliver a hyperscale shell to schedule, including structural steel, precast, and the mechanical/electrical trades stack. The binding input is qualified crews and project-management depth in the specific metro, so this constraint is regional in a way the equipment tiers are not.",
  },

  /* ---- siting ----------------------------------------------------- */
  {
    slug: "grid-interconnect-queue-position",
    name: "Utility interconnection queue position and large-load tariff approval",
    tier: "siting",
    description:
      "The right to draw large load at a given substation: queue position in the relevant ISO/RTO process, completion of system impact and facilities studies, and where applicable a state-commission-approved large-load tariff or special contract. Not a manufactured good and cannot be bought forward, which is what makes it the hardest constraint in the stack to relieve with capital.",
  },
  {
    slug: "cooling-water-allocation",
    name: "Water allocation and discharge rights for evaporative cooling",
    tier: "siting",
    description:
      "Permitted withdrawal volume and discharge authorisation for evaporative or hybrid cooling in water-stressed metros. Granted by local and state authorities, increasingly contested politically, and where refused it forces a design shift to air-cooled or closed-loop systems at a material efficiency and capex penalty — which routes demand into the liquid-cooling and power constraints instead.",
  },

  /* ---- labor ------------------------------------------------------ */
  {
    slug: "electrical-labor-and-commissioning",
    name: "Licensed electricians and substation commissioning crews",
    tier: "labor",
    description:
      "Journeyman and master electricians for MV/LV installation, plus the much smaller pool of relay technicians and commissioning engineers qualified to energise substation equipment. Supply is set by apprenticeship pipelines measured in years and cannot be flexed by capital in-cycle. Competes with reshored manufacturing and grid-hardening programmes for the same crews.",
  },
];

/** Fails loudly at import time rather than producing an unusable registry. */
export function validateRegistry(rows: RegisteredConstraint[]): void {
  const seen = new Set<string>();
  for (const c of rows) {
    if (seen.has(c.slug)) throw new Error(`duplicate constraint slug: ${c.slug}`);
    seen.add(c.slug);
    if (!(CONSTRAINT_TIERS as readonly string[]).includes(c.tier)) {
      throw new Error(`unknown tier "${c.tier}" on constraint ${c.slug}`);
    }
    if (!/^[a-z0-9-]+$/.test(c.slug)) {
      throw new Error(`slug must be kebab-case: ${c.slug}`);
    }
  }
}
validateRegistry(CONSTRAINT_REGISTRY);
