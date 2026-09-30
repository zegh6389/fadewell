/**
 * MmjGreen — shared date formatting.
 *
 * The care surfaces all render appointment and audit timestamps the same way;
 * this keeps that one definition instead of three copies that drift.
 */

/** Medium date, short time in the viewer's locale. */
export const formatWhen = (value) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
