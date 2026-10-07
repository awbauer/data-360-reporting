import type { ScanEstimate } from '@shared/estimate';
import { scanLong, scanShort, type RateView } from '../lib/estimateText';

/** A short, honest cost hint beside the editor. The tooltip carries the assumptions. */
export function EstimateChip({ estimate, view }: { estimate: ScanEstimate; view: RateView }) {
  return (
    <span className="est" title={scanLong(estimate, view)} aria-label={`Estimated cost: ${scanLong(estimate, view)}`}>
      est. {scanShort(estimate, view)}
    </span>
  );
}
