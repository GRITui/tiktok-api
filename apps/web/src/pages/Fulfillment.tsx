import React, { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut } from '../api';
import { SellerShipDialog, TrackingImportDialog } from '../components/SellerShipping';
import { formatDate, getTimeRemaining, isOverdue, buildQueryString } from '../utils';
import type {
  FulfillmentQueueItem,
  FulfillmentQueuePage,
  HandoverOptions,
  HandoverSlot,
  JobView,
  ShipResult,
} from '@oms/core/types';

interface ShipDialogProps {
  packageId: string;
  onClose: () => void;
  onShipSuccess: () => void;
  /** Offered after a successful ship: TikTok creates the label at ship time. */
  onPrintLabel?: (packageId: string) => void;
  userRole: string;
}

function ShipDialog({ packageId, onClose, onShipSuccess, onPrintLabel, userRole }: ShipDialogProps) {
  const [options, setOptions] = useState<HandoverOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [method, setMethod] = useState<'PICKUP' | 'DROP_OFF' | ''>('');
  const [selectedSlot, setSelectedSlot] = useState<HandoverSlot | null>(null);
  const [shipping, setShipping] = useState(false);
  const [result, setResult] = useState<ShipResult | null>(null);

  const idempotencyKey = React.useRef(crypto.randomUUID());

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const data = await apiGet<HandoverOptions>(`/v1/packages/${packageId}/handover-options`);
        setOptions(data);
        if (data.canPickup) setMethod('PICKUP');
        else if (data.canDropOff) setMethod('DROP_OFF');
      } catch (err: any) {
        setError(err.message || 'Failed to load handover options');
      } finally {
        setLoading(false);
      }
    };
    fetchOptions();
  }, [packageId]);

  const handleSetHandover = async () => {
    if (!method) return;
    try {
      await apiPut(`/v1/packages/${packageId}/handover`, {
        method,
        slot: method === 'PICKUP' ? selectedSlot : undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to set handover');
      throw err;
    }
  };

  const handleShip = async () => {
    setShipping(true);
    setError('');
    try {
      await handleSetHandover();
      const shipResult = await apiPost<ShipResult>(`/v1/packages/${packageId}/ship`, {
        handoverMethod: method,
        pickupSlot: method === 'PICKUP' ? selectedSlot : undefined,
      }, {
        headers: {
          'Idempotency-Key': idempotencyKey.current,
        },
      });
      setResult(shipResult);
      onShipSuccess();
    } catch (err: any) {
      setError(err.message || err.details?.ttsCode || 'Ship failed');
    } finally {
      setShipping(false);
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="spinner" style={{ margin: '20px auto' }}></div>
        </div>
      </div>
    );
  }

  if (!options) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="error-message">Failed to load handover options</div>
          <button onClick={onClose} style={{ marginTop: '16px' }}>Close</button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <div className="modal-title">Ship Result</div>
          <div className="success-message">Package shipped successfully!</div>
          <div style={{ fontSize: '13px', lineHeight: '1.8', marginBottom: '16px' }}>
            <div><strong>Status:</strong> {result.status}</div>
            {result.trackingNumber && <div><strong>Tracking:</strong> {result.trackingNumber}</div>}
            <div><strong>Replayed:</strong> {result.replayed ? 'Yes (duplicate request)' : 'No'}</div>
          </div>
          {onPrintLabel && (
            <button onClick={() => { onPrintLabel(packageId); onClose(); }} style={{ width: '100%', marginBottom: '8px' }}>
              Print shipping label
            </button>
          )}
          <button onClick={onClose} style={{ width: '100%' }} className={onPrintLabel ? 'secondary' : undefined}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Ship Package {packageId}</div>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="method">Handover Method</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as any)} disabled={shipping}>
            <option value="">Select Method</option>
            {options.canPickup && <option value="PICKUP">Pickup</option>}
            {options.canDropOff && <option value="DROP_OFF">Drop Off</option>}
          </select>
        </div>

        {method === 'PICKUP' && options.pickupSlots.length > 0 && (
          <div className="form-group">
            <label>Available Slots</label>
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {options.pickupSlots.map((slot, idx) => (
                <label key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    checked={selectedSlot === slot}
                    onChange={() => setSelectedSlot(slot)}
                    disabled={!slot.available || shipping}
                    style={{ marginRight: '8px' }}
                  />
                  <span>
                    {new Date(slot.start * 1000).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' – '}
                    {new Date(slot.end * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {!slot.available && ' (Unavailable)'}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {method === 'DROP_OFF' && options.dropOffPointUrl && (
          <div style={{ marginBottom: '16px' }}>
            <a href={options.dropOffPointUrl} target="_blank" rel="noopener noreferrer">
              View Drop-off Points
            </a>
          </div>
        )}

        <div className="button-group">
          <button onClick={handleShip} disabled={shipping || !method}>
            {shipping ? 'Shipping...' : 'Ship Package'}
          </button>
          <button onClick={onClose} className="secondary" disabled={shipping}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface JobProgressProps {
  jobId: string;
  onClose: () => void;
  /** Re-run the same kind of job for the failed items. */
  onRetry?: (failedIds: string[]) => void;
  /** After a batch ship: print labels for the packages that shipped. */
  onPrintShipped?: (shippedIds: string[], documentType: DocumentType) => void;
  /** Called once when the job reaches a final state. */
  onFinished?: () => void;
}

type DocumentType = 'SHIPPING_LABEL' | 'PACKING_SLIP' | 'SHIPPING_LABEL_AND_PACKING_SLIP';

const JOB_NAMES: Record<string, string> = {
  batch_ship: 'Bulk ship',
  labels: 'Print labels',
  tracking_import: 'Tracking import',
  order_export: 'Order export',
};

export function JobProgress({ jobId, onClose, onRetry, onPrintShipped, onFinished }: JobProgressProps) {
  const [docType, setDocType] = useState<DocumentType>('SHIPPING_LABEL');
  const [job, setJob] = useState<JobView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const fetchJob = async () => {
      try {
        const data = await apiGet<JobView>(`/v1/jobs/${jobId}`);
        setJob(data);

        if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'partial') {
          if (interval) clearInterval(interval);
          onFinished?.();
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load job');
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
    interval = setInterval(fetchJob, 2000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobId]);

  const failedIds = job ? job.items.filter((i) => i.status === 'failed').map((i) => i.targetId) : [];
  const succeededIds = job ? job.items.filter((i) => i.status === 'succeeded').map((i) => i.targetId) : [];
  const finished = job ? ['succeeded', 'failed', 'partial'].includes(job.status) : false;

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <div className="spinner" style={{ margin: '20px auto' }}></div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="error-message">{error || 'Job not found'}</div>
          <button onClick={onClose} style={{ marginTop: '16px' }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Job Progress</div>

        <div className="job-status" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div><strong>Job:</strong> {JOB_NAMES[job.type] ?? job.type}</div>
          <div><strong>Status:</strong> {job.status}</div>
        </div>

        <div className="progress-container">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(job.succeeded / job.total) * 100}%` }}></div>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {job.succeeded} / {job.total} succeeded
            {job.failed > 0 && `, ${job.failed} failed`}
          </div>
        </div>

        {job.downloadUrl && (
          <div style={{ marginBottom: '16px' }}>
            <a href={job.downloadUrl} download>
              <button style={{ width: '100%' }}>Download {job.type === 'order_export' ? 'CSV' : 'PDF'}</button>
            </a>
          </div>
        )}

        {job.failed > 0 && job.items.filter((i) => i.status === 'failed').length > 0 && (
          <>
            <div className="failed-items-list">
              {job.items
                .filter((i) => i.status === 'failed')
                .map((item) => (
                  <div key={item.targetId} className="failed-item">
                    <div className="failed-item-id">{item.targetId}</div>
                    <div className="failed-item-error">{item.error}</div>
                  </div>
                ))}
            </div>
            {onRetry && finished && (
              <button onClick={() => onRetry(failedIds)} style={{ marginTop: '12px', width: '100%' }} className="secondary">
                Retry {failedIds.length} failed
              </button>
            )}
          </>
        )}

        {onPrintShipped && finished && job.type === 'batch_ship' && succeededIds.length > 0 && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <label htmlFor="job-doc-type" className="visually-hidden">Document</label>
            <select id="job-doc-type" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
              <option value="SHIPPING_LABEL">Shipping label</option>
              <option value="PACKING_SLIP">Packing slip</option>
              <option value="SHIPPING_LABEL_AND_PACKING_SLIP">Label + packing slip</option>
            </select>
            <button onClick={() => onPrintShipped(succeededIds, docType)} style={{ flex: 1 }}>
              Print for {succeededIds.length} shipped
            </button>
          </div>
        )}

        <button onClick={onClose} style={{ marginTop: '12px', width: '100%' }} className="secondary">Close</button>
      </div>
    </div>
  );
}

export function FulfillmentPage({ userRole }: { userRole: string }) {
  const [queue, setQueue] = useState<FulfillmentQueueItem[]>([]);
  const [counts, setCounts] = useState({ overdue: 0, lt24h: 0, later: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overdue' | 'lt24h' | 'later'>('overdue');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shipDialog, setShipDialog] = useState<FulfillmentQueueItem | null>(null);
  const [job, setJob] = useState<{ id: string; kind: 'batch_ship' | 'labels' | 'tracking_import'; documentType?: DocumentType } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Filters
  const [shopId, setShopId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [shippingType, setShippingType] = useState('');
  const [sku, setSku] = useState('');

  const fetchQueue = async () => {
    setLoading(true);
    setError('');
    try {
      const params: any = { sla: activeTab };
      if (shopId) params.shopId = shopId;
      if (warehouseId) params.warehouseId = warehouseId;
      if (shippingType) params.shippingType = shippingType;
      if (sku) params.sku = sku;

      const queryStr = buildQueryString(params);
      const data = await apiGet<FulfillmentQueuePage>(`/v1/fulfillment/queue${queryStr}`);
      setQueue(data.items);
      setCounts(data.counts);
    } catch (err: any) {
      setError(err.message || 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  const startBatchShip = async (packageIds: string[]) => {
    if (packageIds.length === 0) return;
    try {
      const result = await apiPost<{ jobId: string }>('/v1/fulfillment/batch-ship', { packageIds });
      setJob({ id: result.jobId, kind: 'batch_ship' });
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message || 'Batch ship failed');
    }
  };

  /** Labels exist only once a package is shipped, so printing starts from shipped packages. */
  const startLabels = async (packageIds: string[], documentType: DocumentType = 'SHIPPING_LABEL') => {
    if (packageIds.length === 0) return;
    try {
      const result = await apiPost<{ jobId: string }>('/v1/fulfillment/labels', { packageIds, documentType });
      setJob({ id: result.jobId, kind: 'labels', documentType });
    } catch (err: any) {
      setError(err.message || 'Print labels failed');
    }
  };

  const retryJob = (failedIds: string[]) => {
    if (!job) return;
    if (job.kind === 'batch_ship') startBatchShip(failedIds);
    else if (job.kind === 'labels') startLabels(failedIds, job.documentType);
    else setImportOpen(true); // tracking import: fix the rows and upload again
  };

  const toggleSelect = (packageId: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(packageId)) {
      newSelected.delete(packageId);
    } else {
      newSelected.add(packageId);
    }
    setSelected(newSelected);
  };

  useEffect(() => {
    fetchQueue();
  }, [activeTab]);

  const filteredQueue = queue.filter((item) => item.slaBucket === activeTab);

  return (
    <div>
      <h2>Fulfillment Workbench</h2>

      {error && <div className="error-message">{error}</div>}

      <div className="tabs">
        <button
          className={`tab-button ${activeTab === 'overdue' ? 'active' : ''}`}
          onClick={() => setActiveTab('overdue')}
        >
          Overdue ({counts.overdue})
        </button>
        <button
          className={`tab-button ${activeTab === 'lt24h' ? 'active' : ''}`}
          onClick={() => setActiveTab('lt24h')}
        >
          &lt;24h ({counts.lt24h})
        </button>
        <button
          className={`tab-button ${activeTab === 'later' ? 'active' : ''}`}
          onClick={() => setActiveTab('later')}
        >
          Later ({counts.later})
        </button>
      </div>

      <div className="filter-panel">
        <div className="filter-row">
          <div className="form-group">
            <label>Shop ID</label>
            <input value={shopId} onChange={(e) => setShopId(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Warehouse ID</label>
            <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Shipping Type</label>
            <input value={shippingType} onChange={(e) => setShippingType(e.target.value)} />
          </div>
          <div className="form-group">
            <label>SKU</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
        </div>
        <div className="button-group">
          <button onClick={fetchQueue}>Apply Filters</button>
          {userRole !== 'viewer' && (
            <button className="secondary" onClick={() => setImportOpen(true)}>Import tracking CSV</button>
          )}
        </div>
      </div>

      {selected.size > 0 && userRole !== 'viewer' && (
        <div className="multi-select-actions">
          <div className="multi-select-count">{selected.size} selected</div>
          <button onClick={() => startBatchShip(Array.from(selected))} className="secondary">Ship Selected</button>
          <button onClick={() => setSelected(new Set())} className="secondary">Clear</button>
        </div>
      )}

      {loading ? (
        <div className="spinner" style={{ margin: '20px auto' }}></div>
      ) : filteredQueue.length === 0 ? (
        <div className="empty-state">
          <h3>No packages</h3>
          <p>Nothing to ship in this bucket</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selected.size === filteredQueue.length && filteredQueue.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(new Set(filteredQueue.map((item) => item.packageId)));
                    } else {
                      setSelected(new Set());
                    }
                  }}
                  disabled={userRole === 'viewer'}
                />
              </th>
              <th>Package</th>
              <th>Orders</th>
              <th>Shop</th>
              <th>Warehouse</th>
              <th>Status</th>
              <th>Ship By</th>
              <th>SKUs</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredQueue.map((item) => (
              <tr key={item.packageId}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(item.packageId)}
                    onChange={() => toggleSelect(item.packageId)}
                    disabled={userRole === 'viewer'}
                    className="checkbox"
                  />
                </td>
                <td><strong>{item.packageId}</strong></td>
                <td>{item.orderIds.join(', ')}</td>
                <td>{item.shopId}</td>
                <td>{item.warehouseId || 'N/A'}</td>
                <td>{item.status || 'N/A'}</td>
                <td>
                  {item.rtsSlaAt && (
                    <span className={isOverdue(item.rtsSlaAt) ? 'badge overdue' : 'badge lt24h'}>
                      {getTimeRemaining(item.rtsSlaAt)}
                    </span>
                  )}
                </td>
                <td>{item.skus.join(', ')}</td>
                <td>
                  {userRole !== 'viewer' && (
                    <button onClick={() => setShipDialog(item)} className="secondary">
                      {item.shippingType === 'SELLER' ? 'Add tracking' : 'Ship'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shipDialog && shipDialog.shippingType === 'SELLER' && (
        <SellerShipDialog
          packageId={shipDialog.packageId}
          mode="ship"
          onClose={() => setShipDialog(null)}
          onDone={() => fetchQueue()}
        />
      )}

      {shipDialog && shipDialog.shippingType !== 'SELLER' && (
        <ShipDialog
          packageId={shipDialog.packageId}
          onClose={() => setShipDialog(null)}
          onShipSuccess={fetchQueue}
          onPrintLabel={(id) => startLabels([id])}
          userRole={userRole}
        />
      )}

      {importOpen && (
        <TrackingImportDialog
          onClose={() => setImportOpen(false)}
          onStarted={(id) => { setImportOpen(false); setJob({ id, kind: 'tracking_import' }); }}
        />
      )}

      {job && (
        <JobProgress
          key={job.id}
          jobId={job.id}
          onClose={() => setJob(null)}
          onFinished={fetchQueue}
          onRetry={retryJob}
          onPrintShipped={(ids, documentType) => startLabels(ids, documentType)}
        />
      )}
    </div>
  );
}
