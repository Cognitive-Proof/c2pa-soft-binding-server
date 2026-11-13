// Reads the active manifest's label (e.g. "urn:c2pa:<uuid>") straight from a
// C2PA Manifest Store's JUMBF structure, without validating anything. Useful
// as a `parseManifestId` that keeps working when a full C2PA validator would
// reject the manifest for reasons irrelevant to storing it — e.g. a
// soft-binding algorithm that isn't in the C2PA registry yet.
//
// A Manifest Store is a JUMBF superbox ("jumb") whose description box
// ("jumd") has the c2pa type UUID. Its children are manifest superboxes, each
// labelled with the manifest's URN; the active manifest is the last one.

const C2PA_STORE_TYPE = '6332706100110010800000aa00389b71'; // "c2pa"
const MANIFEST_TYPES = new Set([
  '63326d6100110010800000aa00389b71', // "c2ma" standard manifest
  '6332756d00110010800000aa00389b71', // "c2um" update manifest
]);

interface Box {
  type: string;
  start: number; // offset of the box payload
  end: number; // offset just past the box
}

function readBoxes(data: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) throw new Error('Truncated JUMBF box header');
      const largeSize = data.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(end - offset)) throw new Error('JUMBF box exceeds its container');
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) {
      throw new Error('Malformed JUMBF box size');
    }

    boxes.push({ type, start: offset + headerSize, end: offset + size });
    offset += size;
  }

  return boxes;
}

/** Returns the description box's type UUID (hex) and label for a "jumb" superbox. */
function describe(
  data: Buffer,
  superbox: Box,
): { typeUuid: string; label?: string; children: Box[] } {
  const children = readBoxes(data, superbox.start, superbox.end);
  const jumd = children[0];
  if (!jumd || jumd.type !== 'jumd' || jumd.end - jumd.start < 17) {
    throw new Error('JUMBF superbox is missing its description box');
  }

  const typeUuid = data.toString('hex', jumd.start, jumd.start + 16);
  const toggles = data[jumd.start + 16];
  let label: string | undefined;

  if (toggles & 0x02) {
    const labelStart = jumd.start + 17;
    const nul = data.indexOf(0, labelStart);
    if (nul === -1 || nul >= jumd.end) throw new Error('Unterminated JUMBF label');
    label = data.toString('utf8', labelStart, nul);
  }

  return { typeUuid, label, children: children.slice(1) };
}

/**
 * Returns the label of the active (last) manifest in a C2PA Manifest Store,
 * e.g. `urn:c2pa:3fa85f64-5717-4562-b3fc-2c963f66afa6`. Throws if the bytes
 * aren't a C2PA Manifest Store or contain no manifest. Performs no signature,
 * hash or assertion validation.
 */
export function readActiveManifestLabel(data: Buffer): string {
  const [root] = readBoxes(data, 0, data.length);
  if (!root || root.type !== 'jumb') {
    throw new Error('Not a JUMBF superbox');
  }

  const store = describe(data, root);
  if (store.typeUuid !== C2PA_STORE_TYPE) {
    throw new Error('Not a C2PA Manifest Store');
  }

  let active: string | undefined;
  for (const child of store.children) {
    if (child.type !== 'jumb') continue;
    const manifest = describe(data, child);
    if (MANIFEST_TYPES.has(manifest.typeUuid) && manifest.label) {
      active = manifest.label;
    }
  }

  if (!active) {
    throw new Error('No manifest found in this C2PA Manifest Store');
  }
  return active;
}
