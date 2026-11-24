// Part names: how a Part is shown to people, after its Owner label ("B3 · Left side").
// Display only: never unique, never a key. Part ids are never parsed; the Part path in `name` is.

export interface NamingOwner {
  kind: 'cabinet' | 'generatedItem';
  id: string;
  label: string;
  /** A Generated Item's kind (`toeKick`). A Part name that only repeats it is dropped. */
  itemKind?: string;
}

export interface NamingPart {
  id: string;
  /** The export's raw `name`: the Part path (`s0.shelf[2]`) or the Generated Item kind. */
  name: string;
  ownerId: string;
  /** The export's optional Part `label` (a future v1 minor: the Library Part's Cut-list text). */
  label?: string;
}

export interface NamedPart {
  id: string;
  /** The Part name, or `""` when it only repeated its Generated Item's kind. */
  partName: string;
}

/** A Part path key the derive table doesn't know, so it is shown with spaces added. */
export interface UnknownKey {
  key: string;
  partIds: string[];
}

export interface Naming {
  /** In the order given. */
  parts: NamedPart[];
  /** In order of first appearance. */
  unknownKeys: UnknownKey[];
}

/**
 * The derive table: Part path keys (without Section path or copy indices) and Generated Item kinds.
 * Generated roles and their words follow cabinet-planner's Section compiler (cabinet-engine
 * `src/compiler`, f2da2ce); Author names are the usual carcass Parts. Grow it from the import summary.
 */
const DERIVED: Readonly<Record<string, string>> = {
  // Author Parts (no dots in the name)
  leftSide: 'Left side',
  rightSide: 'Right side',
  top: 'Top',
  bottom: 'Bottom',
  back: 'Back',
  frontRail: 'Front rail',
  backRail: 'Back rail',
  topRail: 'Top rail',
  // Section compiler roles
  shelf: 'Shelf',
  'shelf.wing': 'Shelf wing',
  divider: 'Divider',
  'door.leaf': 'Door',
  'drawer.face': 'Drawer front',
  'pullout.face': 'Pull-out front',
  flap: 'Flap',
  panel: 'Panel',
  sliding: 'Sliding door',
  bifold: 'Bi-fold door',
  'bifold.wing': 'Bi-fold door',
  'drawer.side': 'Drawer side',
  'drawer.front': 'Box front',
  'drawer.back': 'Box back',
  'drawer.bottom': 'Drawer bottom',
  'drawer.metal.bottom': 'Drawer bottom',
  'drawer.metal.back': 'Drawer back',
  'pullout.upright': 'Pull-out upright',
  'pullout.tray.bottom': 'Tray bottom',
  'pullout.tray.side': 'Tray side',
  'pullout.tray.back': 'Tray back',
  // Generated Item kinds
  filler: 'Filler',
  endPanel: 'End panel',
  islandPanel: 'Island panel',
  toeKick: 'Toe kick',
  crown: 'Crown',
  lightRail: 'Light rail',
};

/**
 * A Part path (Parts Export guide §3; Library guide §7 Violations and §10 Section compiler): a Library
 * Part name, then the copy indices of every repeated entry on the way, outermost first (`[2]`, `[0,1]`).
 * Author names have no dots. A generated name is `<Section path>.<role>`, the Section path being `s0`,
 * `s0.1.0`, ... or `<interior>.s0.1` when the Cabinet has several Interiors.
 */
const PATH = /^(?<key>[^[\]]+?)(?:\[\d+(?:,\d+)*\])?$/;
const SECTION = /^(?<section>(?:[A-Za-z][A-Za-z0-9_]*\.)?s0(?:\.\d+)*)\.(?<role>[A-Za-z].*)$/;

interface ParsedPath {
  /** The Library Part name without its Section path: an Author name, a generated role or a kind. */
  key: string;
  /** The Section path (`s0.1`, `b.s0`), or `null` outside any Section. */
  section: string | null;
}

function parsePath(name: string): ParsedPath {
  const key = PATH.exec(name)?.groups?.key ?? name;
  const groups = SECTION.exec(key)?.groups;
  return groups?.role && groups.section
    ? { key: groups.role, section: groups.section }
    : { key, section: null };
}

/** `s0` -> "", `s0.1.0` -> "Section 2.1", `b.s0.1` -> "b · Section 2". */
function sectionLabel(section: string): string {
  const segments = section.split('.');
  const interior = segments[0] === 's0' ? [] : segments.slice(0, 1);
  const children = segments.slice(interior.length + 1).map((n) => String(Number(n) + 1));
  return [...interior, ...(children.length > 0 ? [`Section ${children.join('.')}`] : [])].join(' · ');
}

/** `spiceRackDivider` / `wine-rack` / `door.leaf` -> "Spice rack divider" / "Wine rack" / "Door leaf". */
function withSpaces(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._-]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Names every Part. Numbers and Section prefixes depend on the Owner's other Parts. */
export function nameParts(owners: NamingOwner[], parts: NamingPart[]): Naming {
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const paths = parts.map((p) => parsePath(p.name));

  const sectionsOf = new Map<string, Set<string>>();
  parts.forEach((p, i) => {
    const section = paths[i]?.section;
    if (section == null) return;
    const set = sectionsOf.get(p.ownerId) ?? new Set<string>();
    set.add(section);
    sectionsOf.set(p.ownerId, set);
  });

  const unknown = new Map<string, string[]>();
  const bases = parts.map((p, i) => {
    const path = paths[i] ?? parsePath(p.name);
    const itemKind = ownerById.get(p.ownerId)?.itemKind;
    if (p.label === undefined && itemKind !== undefined && p.name === itemKind) return '';

    let name = p.label ?? DERIVED[path.key];
    if (name === undefined) {
      name = withSpaces(path.key);
      unknown.set(path.key, [...(unknown.get(path.key) ?? []), p.id]);
    }
    const multiSection = (sectionsOf.get(p.ownerId)?.size ?? 0) > 1;
    const prefix = path.section !== null && multiSection ? sectionLabel(path.section) : '';
    return prefix ? `${prefix} · ${name}` : name;
  });

  // Number a name, 1-based in export order, only when its Owner has several Parts with it.
  const groupOf = (i: number) => `${parts[i]?.ownerId ?? ''}\u0000${bases[i] ?? ''}`;
  const counts = new Map<string, number>();
  bases.forEach((_, i) => counts.set(groupOf(i), (counts.get(groupOf(i)) ?? 0) + 1));
  const seen = new Map<string, number>();

  return {
    parts: parts.map((p, i) => {
      const base = bases[i] ?? '';
      const group = groupOf(i);
      if (base === '' || (counts.get(group) ?? 0) < 2) return { id: p.id, partName: base };
      const n = (seen.get(group) ?? 0) + 1;
      seen.set(group, n);
      return { id: p.id, partName: `${base} ${String(n)}` };
    }),
    unknownKeys: [...unknown].map(([key, partIds]) => ({ key, partIds })),
  };
}

/** `<Owner label> · <Part name>`, or the Owner label alone when the Part name was dropped. */
export function fullPartName(ownerLabel: string, partName: string): string {
  return partName === '' ? ownerLabel : `${ownerLabel} · ${partName}`;
}
