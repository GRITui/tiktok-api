import React, { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut } from '../api';
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
  userRole: string;
}

function ShipDialog({ packageId, onClose, onShipSuccess, userRole }: ShipDialogProps) {
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
      <div>
        <div className="modal-overlay" onClick={onClose}></div>
        <div className="modal">
          <div className="spinner" style={{ margin: '20px auto' }}></div>
        </div>
      </div>
    );
  }

  if (!options) {
    return (
      <div>
        <div className="modal-overlay" onClick={onClose}></div>
        <div className="modal">
          <div className="error-message">Failed to load handover options</div>
          <button onClick={onClose} style={{ marginTop: '16px' }}>Close</button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div>
        <div className="modal-overlay" onClick={onClose}></div>
        <div className="modal">
          <div className="modal-title">Ship Result</div>
          <div className="success-message">Package shipped successfully!</div>
          <div style={{ fontSize: '13px', lineHeight: '1.8', marginBottom: '16px' }}>
            <div><strong>Status:</strong> {result.status}</div>
            {result.trackingNumber && <div><strong>Tracking:</strong> {result.trackingNumber}</div>}
            <div><strong>Replayed:</strong> {result.replayed ? 'Yes (duplicate request)' : 'No'}</div>
          </div>
          <button onClick={onClose} style={{ width: '100%' }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                    {new Date(slot.start * 1000).toLocaleTimeString()} - {new Date(slot.end * 1000).toLocaleTimeString()}
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
}

function JobProgress({ jobId, onClose }: JobProgressProps) {
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

  const handleRetryFailed = async () => {
    if (!job) return;
    const failedIds = job.items
      .filter((item) => item.status === 'failed')
      .map((item) => item.targetId);

    if (failedIds.length === 0) return;

    try {
      const result = await apiPost<{ jobId: string }>('/v1/fulfillment/batch-ship', {
        packageIds: failedIds,
      });
      // Navigate or refresh
      onClose();
    } catch (err: any) {
      setError(err.message || 'Retry failed');
    }
  };

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

        <div className="job-status">
          <div><strong>Status:</strong> {job.status}</div>
          <div><strong>Type:</strong> {job.type}</div>
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
              <button style={{ width: '100%' }}>Download {job.type === 'export_orders' ? 'CSV' : 'PDF'}</button>
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
            <button onClick={handleRetryFailed} style={{ marginTop: '12px', width: '100%' }} className="secondary">
              Retry Failed
            </button>
          </>
        )}

        <button onClick={onClose} style={{ marginTop: '12px', width: '100%' }}>Close</button>
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
  const [shipDialog, setShipDialog] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

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

  const handleBatchShip = async () => {
    const packageIds = Array.from(selected);
    if (packageIds.length === 0) return;

    try {
      const result = await apiPost<{ jobId: string }>('/v1/fulfillment/batch-ship', {
        packageIds,
      });
      setJobId(result.jobId);
      setSelected(new Set());
      fetchQueue();
    } catch (err: any) {
      setError(err.message || 'Batch ship failed');
    }
  };

  const handlePrintLabels = async (documentType: string) => {
    const packageIds = Array.from(selected);
    if (packageIds.length === 0) return;

    try {
      const result = await apiPost<{ jobId: string }>('/v1/fulfillment/labels', {
        packageIds,
        documentType,
      });
      setJobId(result.jobId);
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message || 'Print labels failed');
    }
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
        </div>
      </div>

      {selected.size > 0 && userRole !== 'viewer' && (
        <div className="multi-select-actions">
          <div className="multi-select-count">{selected.size} selected</div>
          <button onClick={handleBatchShip} className="secondary">Ship Selected</button>
          <button
            onClick={() => handlePrintLabels('SHIPPING_LABEL')}
            className="secondary"
          >
            Print Shipping Label
          </button>
          <button
            onClick={() => handlePrintLabels('PACKING_SLIP')}
            className="secondary"
          >
            Print Packing Slip
          </button>
          <button
            onClick={() => handlePrintLabels('SHIPPING_LABEL_AND_PACKING_SLIP')}
            className="secondary"
          >
            Print Both
          </button>
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
                    <button onClick={() => setShipDialog(item.packageId)} className="secondary">Ship</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {shipDialog && (
        <ShipDialog
          packageId={shipDialog}
          onClose={() => setShipDialog(null)}
          onShipSuccess={fetchQueue}
          userRole={userRole}
        />
      )}

      {jobId && <JobProgress jobId={jobId} onClose={() => setJobId(null)} />}
    </div>
  );
}
