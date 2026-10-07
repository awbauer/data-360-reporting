import type { ScanEstimate } from '@shared/estimate';
import { scanLong, scanShort } from '../lib/estimateText';

/** A short, honest cost hint beside the editor. The tooltip carries the assumptions. */
export function EstimateChip({ estimate }: { estimate: ScanEstimate }) {
  return (
    <span className="est" title={scanLong(estimate)} aria-label={`Estimated cost: ${scanLong(estimate)}`}>
      est. {scanShort(estimate)}
    </span>
  );
}
