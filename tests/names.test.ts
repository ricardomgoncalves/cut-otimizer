import { describe, expect, it } from 'vitest';
import { nameParts, type NamingOwner, type NamingPart } from '../src/core/import/names.ts';

const B3: NamingOwner = { kind: 'cabinet', id: 'c3', label: 'B3' };

const part = (name: string, extra: Partial<NamingPart> = {}): NamingPart => ({
  id: `c3/${name}`,
  name,
  ownerId: 'c3',
  ...extra,
});

/** The Part names of `parts`, all owned by B3 unless given other owners. */
const names = (parts: NamingPart[], owners: NamingOwner[] = [B3]) =>
  nameParts(owners, parts).parts.map((p) => p.partName);

describe('Part names', () => {
  it('derive a plain name from a known Part path', () => {
    expect(names([part('leftSide')])).toEqual(['Left side']);
  });

  it('drop the copy index when the Owner has only one Part of that name', () => {
    expect(names([part('s0.door.leaf[0]'), part('s0.shelf[0]')])).toEqual(['Door', 'Shelf']);
  });

  it('number Parts that share a name, 1-based', () => {
    expect(
      names([part('s0.door.leaf[0]'), part('s0.door.leaf[1]'), part('s0.shelf[0]')]),
    ).toEqual(['Door 1', 'Door 2', 'Shelf']);
  });

  it('number in export order, whatever the nested copy indices', () => {
    expect(
      names([
        part('s0.drawer.side[0,0]'),
        part('s0.drawer.side[0,1]'),
        part('s0.drawer.side[1,0]'),
      ]),
    ).toEqual(['Drawer side 1', 'Drawer side 2', 'Drawer side 3']);
  });

  describe('section prefix', () => {
    it('is hidden when the Cabinet has Parts in one Section only', () => {
      expect(names([part('leftSide'), part('s0.1.shelf[0]'), part('s0.1.shelf[1]')])).toEqual([
        'Left side',
        'Shelf 1',
        'Shelf 2',
      ]);
    });

    it('is shown, 1-based, when the Cabinet has Parts in several Sections', () => {
      expect(
        names([
          part('leftSide'),
          part('s0.door.leaf[0]'),
          part('s0.0.shelf[0]'),
          part('s0.1.shelf[0]'),
          part('s0.1.shelf[1]'),
          part('s0.1.0.divider'),
        ]),
      ).toEqual([
        'Left side',
        'Door',
        'Section 1 · Shelf',
        'Section 2 · Shelf 1',
        'Section 2 · Shelf 2',
        'Section 2.1 · Divider',
      ]);
    });

    it('names the Interior when there are several', () => {
      expect(names([part('a.s0.shelf[0]'), part('b.s0.0.shelf[0]')])).toEqual([
        'a · Shelf',
        'b · Section 1 · Shelf',
      ]);
    });
  });

  describe('unknown keys', () => {
    it('are shown as the path with spaces added, numbered the same way', () => {
      expect(
        names([part('spiceRackDivider[0]'), part('spiceRackDivider[1]'), part('s0.wine-rack')]),
      ).toEqual(['Spice rack divider 1', 'Spice rack divider 2', 'Wine rack']);
    });

    it('are listed once each, with the Parts that have them', () => {
      const { unknownKeys } = nameParts(
        [B3],
        [part('leftSide'), part('spiceRackDivider[0]'), part('spiceRackDivider[1]'), part('s0.rail[1]')],
      );

      expect(unknownKeys).toEqual([
        { key: 'spiceRackDivider', partIds: ['c3/spiceRackDivider[0]', 'c3/spiceRackDivider[1]'] },
        { key: 'rail', partIds: ['c3/s0.rail[1]'] },
      ]);
    });
  });

  describe('the export label', () => {
    it('wins over the derived name when present, numbered the same way', () => {
      expect(
        names([
          part('s0.shelf[0]', { label: 'Glass shelf' }),
          part('s0.shelf[1]', { label: 'Glass shelf' }),
          part('spiceRack', { label: 'Spice rack' }),
        ]),
      ).toEqual(['Glass shelf 1', 'Glass shelf 2', 'Spice rack']);
    });

    it('makes a key known', () => {
      expect(nameParts([B3], [part('spiceRack', { label: 'Spice rack' })]).unknownKeys).toEqual([]);
    });
  });

  describe('Generated Item Parts', () => {
    const toeKick: NamingOwner = {
      kind: 'generatedItem',
      id: 'w1.left.lower.c1/toeKick',
      label: 'Toe Kick B2',
      itemKind: 'toeKick',
    };
    const piece = (n: number): NamingPart => ({
      id: `${toeKick.id}/${String(n)}`,
      name: 'toeKick',
      ownerId: toeKick.id,
    });

    it('have no Part name when it only repeats the kind', () => {
      expect(names([piece(0), piece(1)], [toeKick])).toEqual(['', '']);
    });

    it('show a name that differs from the kind', () => {
      expect(names([{ ...piece(0), name: 'filler' }], [toeKick])).toEqual(['Filler']);
    });
  });

  it('number per Owner', () => {
    const B4: NamingOwner = { kind: 'cabinet', id: 'c4', label: 'B4' };
    expect(
      names([part('s0.shelf[0]'), part('s0.shelf[0]', { id: 'c4/s0.shelf[0]', ownerId: 'c4' })], [B3, B4]),
    ).toEqual(['Shelf', 'Shelf']);
  });
});
